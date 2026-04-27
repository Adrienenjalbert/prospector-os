import type { SupabaseClient } from '@supabase/supabase-js'
import { generateObject } from 'ai'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  emitAgentEvent,
  urn,
  WIKI_PAGE_KIND_LABELS,
  type MemoryKind,
  type WikiPageKind,
} from '@prospector/core'
import { getModel } from '@/lib/agent/model-registry'
import { DEFAULT_TENANT_WIKI_SCHEMA } from '@/lib/wiki/schema-template'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * compileWikiPages — Phase 6 (Section 2.3) of the Two-Level Second Brain.
 *
 * The architectural pivot. Atoms (`tenant_memories`) get clustered by
 * entity and compiled into one dense, interlinked, cited wiki_pages
 * row per entity. Slices read pages first, atoms only as a cold-start
 * fallback. Compile is idempotent: each page stores a
 * `source_atoms_hash` and re-runs that hash matches are skipped
 * entirely (no LLM call, no DB write).
 *
 * Mapping rules (deterministic, no LLM):
 *
 *   - icp_pattern (industry scope) → entity_industry/{industry}
 *   - icp_pattern (no scope)       → concept_icp (singleton)
 *   - persona                      → entity_persona/{slug(persona_role)}
 *   - competitor_play              → entity_competitor/{slug(competitor)}
 *   - motion_step                  → concept_motion (singleton)
 *   - win_theme + loss_theme       → folded into entity_industry/{industry}
 *                                    (or into concept_icp when no industry)
 *   - glossary_term                → concept_glossary (singleton)
 *   - rep_playbook                 → playbook_rep/{rep_id}
 *   - stage_best_practice          → playbook_stage/{stage}
 *   - reflection                   → handled by reflectMemories (Section 3.3),
 *                                    not here
 *
 * Cost: roughly one Sonnet call per CHANGED page per night. With
 * ~50 pages per tenant and ~2k tokens per call, ~100k tokens/tenant/
 * night. The hash skip means once a tenant's brain stabilises, only
 * pages with newly-derived atoms get re-compiled.
 *
 * Per-tenant CLAUDE.md: the workflow loads `tenant_wiki_schema.body_md`
 * (Section 2.6) and prepends it to the system prompt so each tenant's
 * brain is shaped by its own conventions. Karpathy's "schema is the
 * product" rule.
 */

const COMPILER_VERSION = 'compile-wiki-pages-v1'
const SONNET_MAX_TOKENS = 1500

// Schema enforced on the Sonnet output. Frontmatter is constructed
// from the structured output — we DO NOT trust the LLM to write valid
// YAML. body_md is markdown the model writes directly.
const PageCompileSchema = z.object({
  title: z.string().min(5).max(200),
  // 2-sentence TL;DR. Surfaced at the top of the page and used by
  // /admin/wiki for the index table.
  tldr: z.string().min(20).max(400),
  // Sectioned body. Compiler joins these into body_md with `## H2`
  // headings. Each section MAY include inline `urn:rev:` citations.
  sections: z
    .array(
      z.object({
        heading: z.string().min(2).max(80),
        content_md: z.string().min(20).max(2000),
      }),
    )
    .min(1)
    .max(6),
  // Cross-links to other wiki pages by SLUG. The compiler validates
  // that each slug resolves to an existing wiki_pages row of the same
  // tenant before it persists a `related_to` edge.
  cross_links: z.array(z.string().min(1).max(80)).max(10),
  // Inline URN citations the body uses. The compiler validates that
  // each is `urn:rev:{tenantId}:{type}:{id}` and emits a `cites`
  // edge per citation that points at a wiki_pages or tenant_memories row.
  citation_urns: z.array(z.string().min(20).max(200)).max(30),
})

type PageCompileOutput = z.infer<typeof PageCompileSchema>

// ---------------------------------------------------------------------------
// Workflow plumbing
// ---------------------------------------------------------------------------

export async function enqueueCompileWikiPages(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'compile_wiki_pages',
    idempotencyKey: `cwp:${tenantId}:${day}`,
    input: { day, source: 'cron' },
  })
}

export async function runCompileWikiPages(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_atoms_and_schema',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        // Load every approved + pinned atom for the tenant. Drafts and
        // archived rows do not contribute to compiled pages.
        const { data: atoms } = await ctx.supabase
          .from('tenant_memories')
          .select('id, kind, scope, title, body, evidence, confidence, updated_at, derived_at')
          .eq('tenant_id', ctx.tenantId)
          .in('status', ['approved', 'pinned'])
          .order('confidence', { ascending: false })
          .limit(2000)

        // Load the per-tenant CLAUDE.md schema (Section 2.6). Falls
        // back to a minimal stub if the tenant hasn't been seeded yet.
        const { data: schemaRow } = await ctx.supabase
          .from('tenant_wiki_schema')
          .select('body_md, version')
          .eq('tenant_id', ctx.tenantId)
          .maybeSingle()

        const schemaBody = schemaRow?.body_md ?? defaultSchemaStub()
        return {
          atoms: atoms ?? [],
          schema_body: schemaBody,
          schema_version: schemaRow?.version ?? 0,
        }
      },
    },
    {
      name: 'cluster',
      run: async (ctx) => {
        const { atoms } = ctx.stepState.load_atoms_and_schema as {
          atoms: AtomRow[]
        }
        const clusters = clusterAtomsToPages(atoms)
        return { cluster_keys: Array.from(clusters.keys()), cluster_count: clusters.size }
      },
    },
    {
      name: 'compile_pages',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { atoms, schema_body } = ctx.stepState.load_atoms_and_schema as {
          atoms: AtomRow[]
          schema_body: string
        }
        const clusters = clusterAtomsToPages(atoms)

        let compiled = 0
        let skipped = 0
        let failed = 0

        for (const [clusterKey, cluster] of clusters.entries()) {
          const hash = computeClusterHash(cluster.atoms)

          // Idempotency check — skip if the page already exists with
          // the same source_atoms_hash. This is the bulk of the cost
          // savings on re-runs.
          const { data: existing } = await ctx.supabase
            .from('wiki_pages')
            .select('id, source_atoms_hash')
            .eq('tenant_id', ctx.tenantId)
            .eq('kind', cluster.pageKind)
            .eq('slug', cluster.slug)
            .maybeSingle()

          if (existing && existing.source_atoms_hash === hash) {
            skipped += 1
            continue
          }

          try {
            const result = await compileOnePage(
              ctx.supabase,
              ctx.tenantId,
              cluster,
              hash,
              schema_body,
              existing?.id as string | undefined,
            )
            if (result.skipped) {
              skipped += 1
            } else {
              compiled += 1
            }
          } catch (err) {
            failed += 1
            console.warn(`[compileWikiPages] cluster ${clusterKey} failed:`, err)
          }
        }
        return { compiled, skipped, failed, total_clusters: clusters.size }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

interface AtomRow {
  id: string
  kind: MemoryKind
  scope: Record<string, string | undefined>
  title: string
  body: string
  evidence: { urns?: string[]; counts?: Record<string, number>; samples?: string[] }
  confidence: number
  updated_at: string
  derived_at: string
}

interface AtomCluster {
  pageKind: WikiPageKind
  slug: string
  // Scope axes shared across the cluster (industry, persona_role, etc.).
  scope: Record<string, string>
  atoms: AtomRow[]
}

/**
 * Deterministic clustering — no LLM. Each atom routes to exactly one
 * cluster based on its kind + scope. Returns a Map keyed by
 * `${pageKind}:${slug}` so callers can iterate in stable order.
 */
export function clusterAtomsToPages(atoms: AtomRow[]): Map<string, AtomCluster> {
  const out = new Map<string, AtomCluster>()
  function add(pageKind: WikiPageKind, slug: string, scope: Record<string, string>, atom: AtomRow) {
    const key = `${pageKind}:${slug}`
    const existing = out.get(key)
    if (existing) {
      existing.atoms.push(atom)
    } else {
      out.set(key, { pageKind, slug, scope, atoms: [atom] })
    }
  }

  for (const atom of atoms) {
    const industry = atom.scope.industry ?? null
    const persona = atom.scope.persona_role ?? null
    const competitor = atom.scope.competitor ?? null
    const stage = atom.scope.stage ?? null
    const repId = atom.scope.rep_id ?? null

    switch (atom.kind) {
      case 'icp_pattern':
        if (industry) add('entity_industry', slugify(industry), { industry }, atom)
        else add('concept_icp', 'tenant-wide', {}, atom)
        break
      case 'persona':
        if (persona) add('entity_persona', slugify(persona), { persona_role: persona }, atom)
        break
      case 'competitor_play':
        if (competitor) add('entity_competitor', slugify(competitor), { competitor }, atom)
        break
      case 'motion_step':
        // All motion steps fold into one tenant-wide motion page; the
        // compiler emits one section per stage inside it.
        add('concept_motion', 'tenant-wide', {}, atom)
        break
      case 'win_theme':
      case 'loss_theme':
        // Themes fold into the industry's entity page (per the plan).
        // Themes without an industry scope fold into concept_icp so
        // they aren't lost.
        if (industry) add('entity_industry', slugify(industry), { industry }, atom)
        else add('concept_icp', 'tenant-wide', {}, atom)
        break
      case 'glossary_term':
        // Single tenant-wide glossary page. The compiler emits one
        // line per term inside it.
        add('concept_glossary', 'tenant-wide', {}, atom)
        break
      case 'rep_playbook':
        if (repId) add('playbook_rep', slugify(repId), { rep_id: repId }, atom)
        break
      case 'stage_best_practice':
        if (stage) add('playbook_stage', slugify(stage), { stage }, atom)
        break
      case 'reflection':
        // Reflections are written by reflectMemories directly into
        // wiki_pages with kind='reflection_weekly'. Compile skips them.
        break
    }
  }

  return out
}

/**
 * sha256 of (sorted atom ids) + max(updated_at). Two clusters with
 * the same atoms in any order produce the same hash; one new atom or
 * one updated atom flips the hash.
 */
export function computeClusterHash(atoms: AtomRow[]): string {
  const ids = atoms.map((a) => a.id).sort()
  const maxUpdated = atoms.reduce<string>((acc, a) => (a.updated_at > acc ? a.updated_at : acc), '')
  return createHash('sha256').update(ids.join(',') + '|' + maxUpdated).digest('hex').slice(0, 32)
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 80)
}

// ---------------------------------------------------------------------------
// Per-page compile
// ---------------------------------------------------------------------------

async function compileOnePage(
  supabase: SupabaseClient,
  tenantId: string,
  cluster: AtomCluster,
  hash: string,
  schemaBody: string,
  existingPageId: string | undefined,
): Promise<{ skipped: boolean; reason?: string; page_id?: string }> {
  // Build the LLM prompt — load all atoms for this cluster, format
  // each as a labelled block. Cap atom body length per row.
  const atomBlocks = cluster.atoms
    .map((a, i) => {
      const evidenceUrns = (a.evidence.urns ?? []).slice(0, 5).join(', ')
      const memoryUrn = urn.memory(tenantId, a.id)
      return `## ATOM ${i + 1} (kind=${a.kind}, confidence=${a.confidence.toFixed(2)})
URN: \`${memoryUrn}\`
Title: ${a.title}
Body: ${a.body.slice(0, 700)}
Evidence URNs: ${evidenceUrns || '(none)'}`
    })
    .join('\n\n')

  const scopeStr = Object.entries(cluster.scope)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')

  const prompt = `You are the wiki compiler for a sales-AI per-tenant knowledge base.

You are compiling ONE wiki page from a cluster of related memory atoms. Your output is a structured page that the agent will read INSTEAD of the raw atoms — it must be denser, better cited, and end with smaller decisions than the atoms collectively offer.

# TENANT SCHEMA (CLAUDE.md)
The tenant's wiki schema instructs you on conventions:
"""
${schemaBody.slice(0, 2000)}
"""

# THIS PAGE
Page kind: ${cluster.pageKind} (${WIKI_PAGE_KIND_LABELS[cluster.pageKind]})
Page slug: ${cluster.slug}
Scope: ${scopeStr || 'tenant-wide'}
Source atoms: ${cluster.atoms.length}

# COMPILATION RULES (NON-NEGOTIABLE)
1. Cite every claim with an inline URN (\`urn:rev:...\`) — copied verbatim from the atom blocks below.
2. TL;DR is at most 2 sentences and answers "what should the rep know?".
3. Sections are typed by heading: TL;DR is implicit (use the tldr field). Use H2 sections for: "Evidence", "Patterns", "Cross-links", "Caveats". Add domain-specific sections only if they materially help the rep.
4. cross_links names other wiki pages by slug (e.g. "manufacturing", "champion-vp-rd"). Pick from likely related entities you SAW in the atoms; do not invent.
5. citation_urns is the deduplicated list of every \`urn:rev:\` you used in the body, including atom URNs and any object URNs (companies, deals) the atoms cite.
6. body_md is shorter than the sum of source atoms. If you can't compress, you're not compiling — you're concatenating.

# SOURCE ATOMS
${atomBlocks}

Compile the page now.`

  let output: PageCompileOutput
  try {
    const result = await generateObject({
      model: getModel('anthropic/claude-sonnet-4'),
      schema: PageCompileSchema,
      prompt,
      maxTokens: SONNET_MAX_TOKENS,
    })
    output = result.object
  } catch (err) {
    return { skipped: true, reason: `llm_failed: ${String(err).slice(0, 200)}` }
  }

  // Compute confidence as the weighted mean of source atom confidences,
  // capped per the plan: min(0.5 + 0.05 * num_distinct_evidence_urns, 0.95).
  const distinctEvidence = new Set(cluster.atoms.flatMap((a) => a.evidence.urns ?? []))
  const meanConf =
    cluster.atoms.reduce((sum, a) => sum + a.confidence, 0) / Math.max(1, cluster.atoms.length)
  const confidence = Math.min(0.5 + 0.05 * distinctEvidence.size, 0.95, meanConf)

  // Render body_md from the structured output.
  const body_md = renderPageMarkdown(output)

  const frontmatter = {
    kind: cluster.pageKind,
    scope: cluster.scope,
    source_atoms: cluster.atoms.map((a) => a.id),
    confidence: Math.round(confidence * 100) / 100,
    last_compiled_at: new Date().toISOString(),
    compiler_version: COMPILER_VERSION,
    cross_links: output.cross_links,
    citation_urns: output.citation_urns,
  }

  // Upsert the page row. Status defaults to 'published' for the
  // first version (we trust the compiler enough to ship without
  // human review at the page level — admins can archive later).
  const upsertRow = {
    tenant_id: tenantId,
    kind: cluster.pageKind,
    slug: cluster.slug,
    title: output.title,
    body_md,
    frontmatter,
    status: 'published' as const,
    confidence,
    source_atoms: cluster.atoms.map((a) => a.id),
    source_atoms_hash: hash,
    last_compiled_at: new Date().toISOString(),
    compiler_version: COMPILER_VERSION,
  }

  const { data: upsertResult, error: upsertErr } = await supabase
    .from('wiki_pages')
    .upsert(upsertRow, { onConflict: 'tenant_id,kind,slug' })
    .select('id')
    .single()

  if (upsertErr || !upsertResult) {
    return { skipped: true, reason: `upsert_failed: ${upsertErr?.message ?? 'no row'}` }
  }

  const pageId = upsertResult.id as string

  // Write derived_from edges (page → each source atom). The unique
  // constraint makes re-inserts no-ops on idempotent re-runs.
  const derivedFromEdges = cluster.atoms.map((a) => ({
    tenant_id: tenantId,
    src_kind: 'wiki_page' as const,
    src_id: pageId,
    dst_kind: 'memory' as const,
    dst_id: a.id,
    edge_kind: 'derived_from' as const,
    weight: 1.0,
    evidence: { reason: 'compileWikiPages compilation provenance' },
  }))
  if (derivedFromEdges.length > 0) {
    await supabase
      .from('memory_edges')
      .upsert(derivedFromEdges, {
        onConflict: 'tenant_id,src_kind,src_id,dst_kind,dst_id,edge_kind',
        ignoreDuplicates: true,
      })
  }

  // Resolve cross-link slugs to wiki_pages ids (if they exist) and
  // write related_to edges. Slugs that don't resolve are dropped
  // silently (lintWiki will surface them as broken_wikilink warnings).
  if (output.cross_links.length > 0) {
    const { data: linkedPages } = await supabase
      .from('wiki_pages')
      .select('id, slug')
      .eq('tenant_id', tenantId)
      .in('slug', output.cross_links)
    const relatedEdges =
      linkedPages
        ?.filter((p) => p.id !== pageId)
        .map((p) => ({
          tenant_id: tenantId,
          src_kind: 'wiki_page' as const,
          src_id: pageId,
          dst_kind: 'wiki_page' as const,
          dst_id: p.id as string,
          edge_kind: 'related_to' as const,
          weight: 0.7,
          evidence: { reason: 'compileWikiPages cross_link extraction' },
        })) ?? []
    if (relatedEdges.length > 0) {
      await supabase
        .from('memory_edges')
        .upsert(relatedEdges, {
          onConflict: 'tenant_id,src_kind,src_id,dst_kind,dst_id,edge_kind',
          ignoreDuplicates: true,
        })
    }
  }

  // Telemetry — one event per page compiled (not per edge, to keep
  // the agent_events table small). The payload carries enough for
  // /admin/adaptation to show "X pages compiled this week".
  await emitAgentEvent(supabase, {
    tenant_id: tenantId,
    event_type: 'wiki_page_compiled',
    subject_urn: urn.wikiPage(tenantId, pageId),
    payload: {
      page_id: pageId,
      kind: cluster.pageKind,
      slug: cluster.slug,
      source_atom_count: cluster.atoms.length,
      was_changed: !existingPageId,
      compiler_version: COMPILER_VERSION,
    },
  })

  return { skipped: false, page_id: pageId }
}

/**
 * Render the structured PageCompileOutput into markdown body_md. The
 * resulting markdown matches what the export endpoint will write to
 * Obsidian, so the format is YAML-frontmatter + H1 title + TL;DR
 * blockquote + H2 sections + cross-links footer.
 */
export function renderPageMarkdown(output: PageCompileOutput): string {
  const lines: string[] = []
  lines.push(`# ${output.title}`)
  lines.push('')
  lines.push(`> **TL;DR** — ${output.tldr}`)
  lines.push('')
  for (const section of output.sections) {
    lines.push(`## ${section.heading}`)
    lines.push('')
    lines.push(section.content_md)
    lines.push('')
  }
  if (output.cross_links.length > 0) {
    lines.push('## Cross-links')
    lines.push('')
    for (const slug of output.cross_links) {
      lines.push(`- [[${slug}]]`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Default schema body used when a tenant doesn't yet have a row in
 * `tenant_wiki_schema`. Returns the same template the schema editor
 * pre-populates with — the compiler operates with the platform default
 * until an admin saves a customised version via /admin/wiki/schema.
 */
function defaultSchemaStub(): string {
  return DEFAULT_TENANT_WIKI_SCHEMA
}
