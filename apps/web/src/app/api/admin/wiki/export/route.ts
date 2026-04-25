import { createClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import {
  emitAgentEvent,
  WIKI_PAGE_KIND_LABELS,
  MEMORY_KIND_LABELS,
  type WikiPageKind,
  type MemoryKind,
} from '@prospector/core'
import { DEFAULT_TENANT_WIKI_SCHEMA } from '@/lib/wiki/schema-template'

/**
 * GET /api/admin/wiki/export — Phase 6 (Section 4.1) of the Two-Level
 * Second Brain.
 *
 * Generates a `.zip` snapshot of the tenant's wiki vault that opens
 * directly in Obsidian. Structure mirrors the developer wiki at
 * `/wiki/` so conventions transfer:
 *
 *   vault-{tenant-slug}-{date}/
 *     CLAUDE.md                    # tenant_wiki_schema.body_md
 *     index.md                     # auto-generated catalog
 *     log.md                       # last 30d of compile/lint events
 *     pages/
 *       {kind}/{slug}.md           # one per wiki_pages row
 *     atoms/
 *       {kind}/{id}.md             # one per tenant_memories row
 *
 * One-way export. The customer (or me, on their behalf during pilots)
 * opens the zip in any Obsidian vault and gets:
 *   - Native [[wikilinks]] resolution (the body_md uses kebab-case
 *     slugs that match the page filenames).
 *   - YAML frontmatter on every page → Dataview queries work.
 *   - Graph view shows the full memory_edges graph because edges
 *     manifest as wikilinks in body_md.
 *
 * Round-tripping back into the DB is out of scope. Customers can
 * edit in Obsidian for personal use; the canonical wiki stays in
 * the SaaS.
 *
 * Auth: admin-only. The fetch uses Bearer token from the browser's
 * session like the other /api/admin/wiki/* endpoints.
 */

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface PageRow {
  id: string
  kind: WikiPageKind
  slug: string
  title: string
  body_md: string
  frontmatter: Record<string, unknown>
  status: string
  confidence: number
  decay_score: number
  source_atoms: string[]
  last_compiled_at: string | null
  compiler_version: string | null
  created_at: string
}

interface AtomRow {
  id: string
  kind: MemoryKind
  scope: Record<string, string | undefined>
  title: string
  body: string
  evidence: { urns?: string[] }
  confidence: number
  status: string
  source_workflow: string
  derived_at: string
  decay_score?: number | null
}

interface LogEventRow {
  event_type: string
  subject_urn: string | null
  payload: Record<string, unknown>
  created_at: string
}

export async function GET(req: Request) {
  const supabase = getServiceSupabase()

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const token = authHeader.slice(7)

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) {
    return new Response(JSON.stringify({ error: 'Profile not found' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (profile.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const tenantId = profile.tenant_id as string

  // --- Load everything in parallel.
  const [tenantRes, schemaRes, pagesRes, atomsRes, logRes] = await Promise.all([
    supabase.from('tenants').select('name, slug').eq('id', tenantId).maybeSingle(),
    supabase
      .from('tenant_wiki_schema')
      .select('body_md, version, updated_at')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('wiki_pages')
      .select(
        'id, kind, slug, title, body_md, frontmatter, status, confidence, decay_score, source_atoms, last_compiled_at, compiler_version, created_at',
      )
      .eq('tenant_id', tenantId)
      .in('status', ['draft', 'published', 'pinned'])
      .limit(1000),
    supabase
      .from('tenant_memories')
      .select(
        'id, kind, scope, title, body, evidence, confidence, status, source_workflow, derived_at, decay_score',
      )
      .eq('tenant_id', tenantId)
      .in('status', ['proposed', 'approved', 'pinned'])
      .limit(2000),
    supabase
      .from('agent_events')
      .select('event_type, subject_urn, payload, created_at')
      .eq('tenant_id', tenantId)
      .in('event_type', [
        'memory_derived',
        'memory_approved',
        'memory_archived',
        'memory_pinned',
        'memory_superseded',
        'wiki_page_compiled',
        'wiki_page_lint_warning',
      ])
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  const tenantSlug = (tenantRes.data?.slug as string | undefined) ?? tenantId.slice(0, 8)
  const dateStamp = new Date().toISOString().slice(0, 10)
  const vaultName = `vault-${slugify(tenantSlug)}-${dateStamp}`
  const schemaBody = (schemaRes.data?.body_md as string | undefined) ?? DEFAULT_TENANT_WIKI_SCHEMA
  const pages = (pagesRes.data ?? []) as PageRow[]
  const atoms = (atomsRes.data ?? []) as AtomRow[]
  const logEvents = (logRes.data ?? []) as LogEventRow[]

  // --- Build the zip.
  const zip = new JSZip()
  const root = zip.folder(vaultName)
  if (!root) {
    return new Response(JSON.stringify({ error: 'zip allocation failed' }), {
      status: 500,
    })
  }

  // CLAUDE.md
  root.file('CLAUDE.md', schemaBody)

  // index.md — catalog of every page + atom count by kind.
  root.file('index.md', renderIndex(pages, atoms))

  // log.md — last 30d of memory + wiki events.
  root.file('log.md', renderLog(logEvents))

  // pages/{kind}/{slug}.md
  const pagesFolder = root.folder('pages')
  if (pagesFolder) {
    for (const page of pages) {
      const kindFolder = pagesFolder.folder(page.kind) ?? pagesFolder
      kindFolder.file(`${page.slug}.md`, renderPageFile(page))
    }
  }

  // atoms/{kind}/{id}.md — one per tenant_memories row, for grep.
  const atomsFolder = root.folder('atoms')
  if (atomsFolder) {
    for (const atom of atoms) {
      const kindFolder = atomsFolder.folder(atom.kind) ?? atomsFolder
      kindFolder.file(`${atom.id}.md`, renderAtomFile(atom))
    }
  }

  // Generate as Blob — Blob is the canonical BodyInit type and works
  // on both Node and Edge runtimes without TypeScript fighting us
  // about Buffer ↔ Uint8Array ↔ BodyInit conversions.
  const blob = await zip.generateAsync({ type: 'blob' })

  // Audit + telemetry. The export contains the tenant's full
  // memory + page corpus; lands as one calibration_ledger row so
  // we have a record of who downloaded what.
  await supabase.from('calibration_ledger').insert({
    tenant_id: tenantId,
    change_type: 'wiki_export',
    target_path: `wiki_pages,tenant_memories,tenant_wiki_schema`,
    before_value: null,
    after_value: {
      pages_exported: pages.length,
      atoms_exported: atoms.length,
      schema_version: schemaRes.data?.version ?? 0,
    },
    observed_lift: null,
    applied_by: user.id,
    notes: `Exported ${pages.length} pages + ${atoms.length} atoms as ${vaultName}.zip`,
  })

  await emitAgentEvent(supabase, {
    tenant_id: tenantId,
    user_id: user.id,
    event_type: 'wiki_page_compiled',
    payload: {
      page_id: 'export',
      kind: 'index_root',
      slug: vaultName,
      action: 'exported',
      pages: pages.length,
      atoms: atoms.length,
    },
  })

  return new Response(blob, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${vaultName}.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderIndex(pages: PageRow[], atoms: AtomRow[]): string {
  const lines: string[] = []
  lines.push('---')
  lines.push('kind: log')
  lines.push('title: Wiki index')
  lines.push(`created: ${new Date().toISOString().slice(0, 10)}`)
  lines.push('---')
  lines.push('')
  lines.push('# Index')
  lines.push('')
  lines.push(
    `Exported snapshot. Pages reflect the canonical SaaS state at export time.`,
  )
  lines.push('')

  // Pages by kind.
  const pagesByKind = new Map<string, PageRow[]>()
  for (const p of pages) {
    const arr = pagesByKind.get(p.kind) ?? []
    arr.push(p)
    pagesByKind.set(p.kind, arr)
  }
  for (const kind of Object.keys(WIKI_PAGE_KIND_LABELS)) {
    const arr = pagesByKind.get(kind)
    if (!arr || arr.length === 0) continue
    lines.push(`## ${WIKI_PAGE_KIND_LABELS[kind as WikiPageKind]} (${arr.length})`)
    lines.push('')
    arr.sort((a, b) => a.slug.localeCompare(b.slug))
    for (const p of arr) {
      lines.push(`- [[${p.slug}]] — ${p.title} (confidence ${p.confidence.toFixed(2)})`)
    }
    lines.push('')
  }

  // Atoms by kind (just counts; the per-atom files live in atoms/).
  lines.push('## Atom counts')
  lines.push('')
  const atomCounts = new Map<string, number>()
  for (const a of atoms) atomCounts.set(a.kind, (atomCounts.get(a.kind) ?? 0) + 1)
  for (const kind of Object.keys(MEMORY_KIND_LABELS)) {
    const count = atomCounts.get(kind) ?? 0
    if (count === 0) continue
    lines.push(`- ${MEMORY_KIND_LABELS[kind as MemoryKind]}: ${count} atoms in atoms/${kind}/`)
  }
  lines.push('')
  lines.push('## See also')
  lines.push('')
  lines.push('- [[CLAUDE]] — the schema this vault was compiled against.')
  lines.push('- [`log.md`](log.md) — last 30 days of memory events.')

  return lines.join('\n')
}

function renderLog(events: LogEventRow[]): string {
  const lines: string[] = []
  lines.push('---')
  lines.push('kind: log')
  lines.push('title: Wiki log')
  lines.push(`created: ${new Date().toISOString().slice(0, 10)}`)
  lines.push('---')
  lines.push('')
  lines.push('# Wiki log')
  lines.push('')
  lines.push(
    'Append-only chronological record of memory + wiki events from the SaaS, last 30 days. Parseable with `grep "^## " log.md`.',
  )
  lines.push('')
  for (const e of events) {
    const date = e.created_at.slice(0, 10)
    const detail =
      typeof e.payload === 'object' && e.payload
        ? Object.entries(e.payload)
            .filter(([k]) => k !== 'memory_id' && k !== 'page_id')
            .slice(0, 3)
            .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v).slice(0, 50)}`)
            .join(' ')
        : ''
    lines.push(`## [${date}] ${e.event_type} | ${detail}`)
    if (e.subject_urn) {
      lines.push(`subject: \`${e.subject_urn}\``)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function renderPageFile(page: PageRow): string {
  // Reconstruct YAML frontmatter from the JSONB. Skip any keys that
  // aren't safe to YAML-serialise.
  const fmLines: string[] = ['---']
  fmLines.push(`kind: ${page.kind}`)
  fmLines.push(`slug: ${page.slug}`)
  fmLines.push(`title: ${escapeYamlValue(page.title)}`)
  fmLines.push(`status: ${page.status}`)
  fmLines.push(`confidence: ${page.confidence}`)
  fmLines.push(`decay_score: ${page.decay_score}`)
  if (page.last_compiled_at) {
    fmLines.push(`last_compiled_at: ${page.last_compiled_at}`)
  }
  if (page.compiler_version) {
    fmLines.push(`compiler_version: ${page.compiler_version}`)
  }
  if (page.source_atoms.length > 0) {
    fmLines.push('source_atoms:')
    for (const id of page.source_atoms.slice(0, 50)) fmLines.push(`  - ${id}`)
  }
  // Surface lint_warnings if present.
  const warnings = (page.frontmatter?.lint_warnings as string[] | undefined) ?? []
  if (warnings.length > 0) {
    fmLines.push('lint_warnings:')
    for (const w of warnings) fmLines.push(`  - ${escapeYamlValue(w)}`)
  }
  const qualityScore = page.frontmatter?.quality_score
  if (typeof qualityScore === 'number') {
    fmLines.push(`quality_score: ${qualityScore}`)
  }
  fmLines.push('---')
  fmLines.push('')
  // The body_md already starts with `# Title` from the compiler.
  fmLines.push(page.body_md)
  return fmLines.join('\n')
}

function renderAtomFile(atom: AtomRow): string {
  const fmLines: string[] = ['---']
  fmLines.push(`kind: ${atom.kind}`)
  fmLines.push(`title: ${escapeYamlValue(atom.title)}`)
  fmLines.push(`status: ${atom.status}`)
  fmLines.push(`confidence: ${atom.confidence}`)
  if (typeof atom.decay_score === 'number') {
    fmLines.push(`decay_score: ${atom.decay_score}`)
  }
  fmLines.push(`source_workflow: ${atom.source_workflow}`)
  fmLines.push(`derived_at: ${atom.derived_at}`)
  if (atom.scope && Object.keys(atom.scope).length > 0) {
    fmLines.push('scope:')
    for (const [k, v] of Object.entries(atom.scope)) {
      if (typeof v === 'string') fmLines.push(`  ${k}: ${escapeYamlValue(v)}`)
    }
  }
  if (atom.evidence?.urns && atom.evidence.urns.length > 0) {
    fmLines.push('evidence_urns:')
    for (const u of atom.evidence.urns.slice(0, 30)) fmLines.push(`  - ${escapeYamlValue(u)}`)
  }
  fmLines.push('---')
  fmLines.push('')
  fmLines.push(`# ${atom.title}`)
  fmLines.push('')
  fmLines.push(atom.body)
  return fmLines.join('\n')
}

function escapeYamlValue(v: string): string {
  // Wrap in double quotes if the value contains anything that breaks
  // YAML (colon, hash, leading whitespace). The simplest approach is
  // to always quote strings, escaping internal double quotes.
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60)
}
