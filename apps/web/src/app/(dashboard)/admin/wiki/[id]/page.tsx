import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import {
  WIKI_PAGE_KIND_LABELS,
  MEMORY_KIND_LABELS,
  MEMORY_EDGE_KIND_LABELS,
  type WikiPageKind,
  type MemoryKind,
  type MemoryEdgeKind,
} from '@prospector/core'
import { WikiPageActions } from './page-actions'

export const metadata = { title: 'Wiki page' }
export const dynamic = 'force-dynamic'

/**
 * /admin/wiki/[id] — page detail. Renders the compiled markdown body,
 * shows backlinks (memory_edges where dst_kind=wiki_page AND
 * dst_id=:id), source atoms (memory_edges where edge_kind=derived_from),
 * and gives admins three actions: re-compile, archive, pin.
 */

interface PageRow {
  id: string
  tenant_id: string
  kind: string
  slug: string
  title: string
  body_md: string
  frontmatter: Record<string, unknown>
  status: string
  confidence: number
  decay_score: number
  prior_alpha: number
  prior_beta: number
  source_atoms: string[]
  source_atoms_hash: string | null
  last_compiled_at: string | null
  compiler_version: string | null
  superseded_by: string | null
  created_at: string
  updated_at: string
}

interface EdgeRow {
  id: string
  src_kind: string
  src_id: string
  dst_kind: string
  dst_id: string
  edge_kind: string
  weight: number
  evidence: Record<string, unknown>
  created_at: string
}

export default async function WikiPageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

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

  const [pageRes, outboundRes, inboundRes, sourceAtomsRes] = await Promise.all([
    supabase
      .from('wiki_pages')
      .select(
        'id, tenant_id, kind, slug, title, body_md, frontmatter, status, confidence, decay_score, prior_alpha, prior_beta, source_atoms, source_atoms_hash, last_compiled_at, compiler_version, superseded_by, created_at, updated_at',
      )
      .eq('id', id)
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle(),
    supabase
      .from('memory_edges')
      .select('id, src_kind, src_id, dst_kind, dst_id, edge_kind, weight, evidence, created_at')
      .eq('tenant_id', profile.tenant_id)
      .eq('src_kind', 'wiki_page')
      .eq('src_id', id),
    supabase
      .from('memory_edges')
      .select('id, src_kind, src_id, dst_kind, dst_id, edge_kind, weight, evidence, created_at')
      .eq('tenant_id', profile.tenant_id)
      .eq('dst_kind', 'wiki_page')
      .eq('dst_id', id),
    // Source atom titles — fetched in one round trip via the
    // source_atoms array on the page row.
    supabase
      .from('tenant_memories')
      .select('id, kind, title, confidence, status')
      .eq('tenant_id', profile.tenant_id),
  ])

  const page = pageRes.data as PageRow | null
  if (!page) notFound()

  const outbound = (outboundRes.data ?? []) as EdgeRow[]
  const inbound = (inboundRes.data ?? []) as EdgeRow[]
  const allAtoms = (sourceAtomsRes.data ?? []) as Array<{
    id: string
    kind: string
    title: string
    confidence: number
    status: string
  }>

  const atomById = new Map(allAtoms.map((a) => [a.id, a]))
  const sourceAtomRows = page.source_atoms.map((aid) => atomById.get(aid)).filter(Boolean)

  // Resolve outbound page links (related_to / cites edges → other pages).
  const linkedPageIds = outbound
    .filter((e) => e.dst_kind === 'wiki_page')
    .map((e) => e.dst_id)
  const { data: linkedPages } = await supabase
    .from('wiki_pages')
    .select('id, kind, slug, title')
    .eq('tenant_id', profile.tenant_id)
    .in('id', linkedPageIds.length > 0 ? linkedPageIds : ['00000000-0000-0000-0000-000000000000'])

  const linkedPageMap = new Map(
    (linkedPages ?? []).map((p) => [p.id, p as { id: string; kind: string; slug: string; title: string }]),
  )

  // Inbound = pages linking IN to this one.
  const inboundPageIds = inbound
    .filter((e) => e.src_kind === 'wiki_page')
    .map((e) => e.src_id)
  const { data: inboundPages } = await supabase
    .from('wiki_pages')
    .select('id, kind, slug, title, status')
    .eq('tenant_id', profile.tenant_id)
    .in('id', inboundPageIds.length > 0 ? inboundPageIds : ['00000000-0000-0000-0000-000000000000'])

  const isAdmin = profile.role === 'admin'
  const contradictionEdges = [...outbound, ...inbound].filter((e) => e.edge_kind === 'contradicts')

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="text-xs">
        <Link href="/admin/wiki" className="text-zinc-500 hover:text-zinc-300">
          ← Back to wiki
        </Link>
      </div>

      <header className="mt-3 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-zinc-500">
            {WIKI_PAGE_KIND_LABELS[page.kind as WikiPageKind] ?? page.kind} ·{' '}
            <span className="font-mono">{page.slug}</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-100">{page.title}</h1>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-500">
            <span className={`rounded px-2 py-0.5 ${statusColor(page.status)}`}>
              {page.status}
            </span>
            <span>confidence {Number(page.confidence).toFixed(2)}</span>
            <span>decay {Number(page.decay_score).toFixed(2)}</span>
            <span>α={page.prior_alpha} β={page.prior_beta}</span>
            {page.last_compiled_at && (
              <span>compiled {new Date(page.last_compiled_at).toLocaleString()}</span>
            )}
            {page.compiler_version && (
              <span className="font-mono">{page.compiler_version}</span>
            )}
          </div>
        </div>
        {isAdmin && (
          <WikiPageActions pageId={page.id} status={page.status} />
        )}
      </header>

      {contradictionEdges.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200">
          ⚠ This page is flagged in {contradictionEdges.length} contradiction
          edge{contradictionEdges.length === 1 ? '' : 's'}. Review the
          conflicted counterpart{contradictionEdges.length === 1 ? '' : 's'}{' '}
          below before relying on this page.
        </div>
      )}

      <section className="mt-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-6">
        <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-300">
          {page.body_md}
        </pre>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-xs uppercase tracking-wide text-zinc-500">
            Source atoms ({sourceAtomRows.length})
          </h2>
          <p className="mt-1 text-[11px] text-zinc-600">
            Atoms this page was compiled from (derived_from edges).
          </p>
          <ul className="mt-3 space-y-1 text-xs">
            {sourceAtomRows.map((a) => (
              <li key={a!.id} className="text-zinc-300">
                <Link href={`/admin/memory`} className="hover:text-emerald-200">
                  <span className="text-zinc-500">
                    {MEMORY_KIND_LABELS[a!.kind as MemoryKind] ?? a!.kind}
                  </span>{' '}
                  · {a!.title.slice(0, 80)}
                </Link>
              </li>
            ))}
            {sourceAtomRows.length === 0 && (
              <li className="text-zinc-500">No source atoms recorded.</li>
            )}
          </ul>
        </div>

        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-xs uppercase tracking-wide text-zinc-500">
            Backlinks ({inbound.length})
          </h2>
          <p className="mt-1 text-[11px] text-zinc-600">
            Pages that link IN to this page.
          </p>
          <ul className="mt-3 space-y-1 text-xs">
            {(inboundPages ?? []).map((p) => (
              <li key={p.id}>
                <Link
                  href={`/admin/wiki/${p.id}`}
                  className="text-zinc-300 hover:text-emerald-200"
                >
                  <span className="text-zinc-500">
                    {WIKI_PAGE_KIND_LABELS[p.kind as WikiPageKind] ?? p.kind}
                  </span>{' '}
                  · {p.title}
                </Link>
              </li>
            ))}
            {(inboundPages ?? []).length === 0 && (
              <li className="text-zinc-500">
                No backlinks. Lint may flag this as orphan.
              </li>
            )}
          </ul>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
        <h2 className="text-xs uppercase tracking-wide text-zinc-500">
          Outbound edges ({outbound.length})
        </h2>
        <p className="mt-1 text-[11px] text-zinc-600">
          Every typed relationship this page asserts. Lint deletes
          related_to edges to slugs that no longer resolve.
        </p>
        <ul className="mt-3 space-y-1 text-xs">
          {outbound.map((e) => {
            const linkedPage =
              e.dst_kind === 'wiki_page' ? linkedPageMap.get(e.dst_id) : null
            return (
              <li key={e.id} className="text-zinc-300">
                <span className="text-zinc-500">
                  {MEMORY_EDGE_KIND_LABELS[e.edge_kind as MemoryEdgeKind] ?? e.edge_kind}
                </span>{' '}
                →{' '}
                {linkedPage ? (
                  <Link
                    href={`/admin/wiki/${linkedPage.id}`}
                    className="hover:text-emerald-200"
                  >
                    {linkedPage.title}
                  </Link>
                ) : (
                  <span className="font-mono">
                    {e.dst_kind}:{e.dst_id.slice(0, 8)}…
                  </span>
                )}
              </li>
            )
          })}
          {outbound.length === 0 && (
            <li className="text-zinc-500">No outbound edges yet.</li>
          )}
        </ul>
      </section>
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

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}
