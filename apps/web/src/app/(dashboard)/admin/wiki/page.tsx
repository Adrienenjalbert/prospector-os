import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { WIKI_PAGE_KIND_LABELS, type WikiPageKind } from '@prospector/core'
import { WikiExportButton } from './export-button'

export const metadata = { title: 'Tenant wiki' }
export const dynamic = 'force-dynamic'

/**
 * /admin/wiki — Phase 6 (Section 2.5) of the Two-Level Second Brain.
 *
 * The customer-facing index of the per-tenant wiki. The compileWikiPages
 * workflow writes one wiki_pages row per entity / concept / playbook
 * nightly; this page surfaces them with status, confidence, decay, and
 * citation count so admins can see what the brain knows AND what's
 * stale, conflicted, or orphaned.
 *
 * Three sub-views (separate routes):
 *   /admin/wiki         — this page (index)
 *   /admin/wiki/[id]    — page detail with rendered body, backlinks,
 *                          source atoms, recompile button
 *   /admin/wiki/schema  — the per-tenant CLAUDE.md (Section 2.6)
 *
 * Filter chips: by kind, by status, conflict-flagged. The conflict
 * filter surfaces pairs flagged by lintWiki (Section 3.2) /
 * consolidateMemories (Section 3.1).
 */

interface AdminWikiRow {
  id: string
  kind: string
  slug: string
  title: string
  status: string
  confidence: number
  decay_score: number
  source_atoms: string[]
  last_compiled_at: string | null
  superseded_by: string | null
  created_at: string
  updated_at: string
}

interface SearchParams {
  kind?: string
  status?: string
  lint?: string
}

export default async function AdminWikiPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id) redirect('/login')
  if (!['admin', 'revops', 'manager'].includes(profile.role ?? '')) {
    redirect('/inbox')
  }

  const filters = await searchParams

  // Build the query incrementally so the same code path covers all
  // filter combinations.
  let query = supabase
    .from('wiki_pages')
    .select(
      'id, kind, slug, title, status, confidence, decay_score, source_atoms, last_compiled_at, superseded_by, created_at, updated_at',
    )
    .eq('tenant_id', profile.tenant_id)
    .order('status', { ascending: true })
    .order('last_compiled_at', { ascending: false, nullsFirst: false })
    .limit(300)

  if (filters.kind && filters.kind !== 'all') {
    query = query.eq('kind', filters.kind)
  }
  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  } else {
    // Default — hide superseded and archived unless the user opts in.
    query = query.in('status', ['draft', 'published', 'pinned'])
  }

  // Run the page query + a contradiction-edge query in parallel. The
  // contradiction query is gated on the lint=contradiction filter (or
  // surfaced as a counter when no filter is set).
  const [pagesRes, contradictionEdgesRes, schemaRes] = await Promise.all([
    query,
    supabase
      .from('memory_edges')
      .select('id, src_id, dst_id, src_kind, dst_kind, evidence, created_at')
      .eq('tenant_id', profile.tenant_id)
      .eq('edge_kind', 'contradicts')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('tenant_wiki_schema')
      .select('version, updated_at, auto_revisions')
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle(),
  ])

  const pages = (pagesRes.data ?? []) as AdminWikiRow[]
  const contradictions = contradictionEdgesRes.data ?? []
  const schemaMeta = schemaRes.data ?? null

  // If the user filtered by conflict, narrow pages to those mentioned
  // in any contradiction edge.
  let visiblePages = pages
  if (filters.lint === 'contradiction') {
    const conflictedIds = new Set<string>()
    for (const e of contradictions as Array<{
      src_kind: string
      src_id: string
      dst_kind: string
      dst_id: string
    }>) {
      if (e.src_kind === 'wiki_page') conflictedIds.add(e.src_id)
      if (e.dst_kind === 'wiki_page') conflictedIds.add(e.dst_id)
    }
    visiblePages = pages.filter((p) => conflictedIds.has(p.id))
  }

  const kinds = Object.keys(WIKI_PAGE_KIND_LABELS) as WikiPageKind[]
  const kindCounts: Record<string, number> = {}
  for (const p of pages) kindCounts[p.kind] = (kindCounts[p.kind] ?? 0) + 1

  const statuses = ['draft', 'published', 'pinned', 'archived', 'superseded'] as const

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Tenant wiki</h1>
          <p className="mt-1 text-sm text-zinc-500">
            The compiled second brain of your tenant. Each page is derived
            nightly from {kinds.length} kinds of memory atoms by{' '}
            <span className="font-mono text-xs text-zinc-400">compileWikiPages</span>.
            Slices read pages first, atoms only as a fallback. Every claim
            on a page cites a source.
          </p>
        </div>
        <div className="flex items-start gap-2">
          {profile.role === 'admin' && <WikiExportButton />}
          <Link
            href="/admin/wiki/graph"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Graph view
          </Link>
          <Link
            href="/admin/wiki/schema"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Schema editor
            {schemaMeta && (
              <span className="ml-2 text-[11px] text-zinc-500">
                v{schemaMeta.version} · {schemaMeta.auto_revisions} auto-revisions
              </span>
            )}
          </Link>
        </div>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kinds.map((kind) => {
          const count = kindCounts[kind] ?? 0
          const isActive = filters.kind === kind
          const href = isActive
            ? '/admin/wiki'
            : `/admin/wiki?kind=${encodeURIComponent(kind)}`
          return (
            <Link
              key={kind}
              href={href}
              className={`rounded-md border px-3 py-2 text-left transition ${
                isActive
                  ? 'border-emerald-500 bg-emerald-950/40'
                  : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
              }`}
            >
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                {WIKI_PAGE_KIND_LABELS[kind]}
              </div>
              <div className="mt-1 text-lg font-semibold text-zinc-100 tabular-nums">
                {count}
              </div>
            </Link>
          )
        })}
      </section>

      <section className="mt-6 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-500">Status:</span>
        <Link
          href={
            filters.kind
              ? `/admin/wiki?kind=${encodeURIComponent(filters.kind)}`
              : '/admin/wiki'
          }
          className={`rounded-full border px-2 py-0.5 ${
            !filters.status || filters.status === 'all'
              ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200'
              : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          Active (draft + published + pinned)
        </Link>
        {statuses.map((s) => {
          const params = new URLSearchParams()
          if (filters.kind) params.set('kind', filters.kind)
          params.set('status', s)
          return (
            <Link
              key={s}
              href={`/admin/wiki?${params.toString()}`}
              className={`rounded-full border px-2 py-0.5 ${
                filters.status === s
                  ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200'
                  : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              {s}
            </Link>
          )
        })}
        {contradictions.length > 0 && (
          <Link
            href="/admin/wiki?lint=contradiction"
            className={`ml-2 rounded-full border px-2 py-0.5 ${
              filters.lint === 'contradiction'
                ? 'border-amber-500 bg-amber-950/40 text-amber-200'
                : 'border-amber-800 bg-amber-950/20 text-amber-300 hover:bg-amber-950/40'
            }`}
          >
            ⚠ {contradictions.length} contradiction{contradictions.length === 1 ? '' : 's'}
          </Link>
        )}
      </section>

      <section className="mt-6 overflow-hidden rounded-md border border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-800 text-sm">
          <thead className="bg-zinc-900/40 text-left text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Confidence</th>
              <th className="px-3 py-2 text-right font-medium">Decay</th>
              <th className="px-3 py-2 text-right font-medium">Atoms</th>
              <th className="px-3 py-2 font-medium">Compiled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
            {visiblePages.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-zinc-500">
                  {pages.length === 0
                    ? 'No wiki pages yet. The first compileWikiPages run lands tonight at 02:00 UTC.'
                    : 'No pages match the current filters.'}
                </td>
              </tr>
            )}
            {visiblePages.map((p) => (
              <tr key={p.id} className="hover:bg-zinc-900/40">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/wiki/${p.id}`}
                    className="text-zinc-100 hover:text-emerald-200"
                  >
                    {p.title}
                  </Link>
                  <div className="text-[10px] text-zinc-600 font-mono">
                    {p.slug}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-zinc-400">
                  {WIKI_PAGE_KIND_LABELS[p.kind as WikiPageKind] ?? p.kind}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${statusColor(
                      p.status,
                    )}`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                  {Number(p.confidence).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                  {Number(p.decay_score).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                  {p.source_atoms?.length ?? 0}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500">
                  {p.last_compiled_at
                    ? new Date(p.last_compiled_at).toLocaleString()
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {filters.lint === 'contradiction' && contradictions.length > 0 && (
        <section className="mt-6 rounded-md border border-amber-900/40 bg-amber-950/20 p-4">
          <h2 className="text-sm font-semibold text-amber-300">Contradictions inbox</h2>
          <p className="mt-1 text-xs text-amber-400/80">
            Pairs flagged by <span className="font-mono">consolidateMemories</span> and{' '}
            <span className="font-mono">lintWiki</span> as semantically opposite.
            Review each pair, then archive the loser via{' '}
            <span className="font-mono">/admin/memory</span> (atoms) or the page detail
            (pages). Never auto-resolved.
          </p>
          <ul className="mt-3 space-y-2 text-xs">
            {contradictions.map((e) => {
              const evidence = (e.evidence ?? {}) as { reason?: string }
              return (
                <li key={e.id} className="rounded border border-amber-900/40 bg-zinc-950/40 p-2">
                  <div className="font-mono text-zinc-400">
                    {String(e.src_kind)}:{String(e.src_id).slice(0, 8)}… ↔{' '}
                    {String(e.dst_kind)}:{String(e.dst_id).slice(0, 8)}…
                  </div>
                  {evidence.reason && (
                    <div className="mt-1 text-zinc-300">{evidence.reason}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

function statusColor(status: string): string {
  switch (status) {
    case 'pinned':
      return 'bg-emerald-950 text-emerald-300'
    case 'published':
      return 'bg-zinc-900 text-zinc-300'
    case 'draft':
      return 'bg-amber-950 text-amber-300'
    case 'archived':
      return 'bg-zinc-900 text-zinc-500'
    case 'superseded':
      return 'bg-zinc-900 text-zinc-600 line-through'
    default:
      return 'bg-zinc-900 text-zinc-400'
  }
}
