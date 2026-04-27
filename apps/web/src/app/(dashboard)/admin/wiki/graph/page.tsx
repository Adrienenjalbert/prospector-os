import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { TRIGGER_PATTERN_LABELS, type TriggerPattern } from '@prospector/core'

export const metadata = { title: 'Wiki graph' }
export const dynamic = 'force-dynamic'

/**
 * /admin/wiki/graph — Phase 7 (Section 6.2) extension of the
 * Phase 6 wiki UI.
 *
 * Now that memory_edges spans the canonical ontology (Phase 7
 * §3.1), the graph isn't just pages-to-pages — it's the relationship
 * constellation. This page renders:
 *
 *   1. Top 30 companies by inbound bridges_to count, with bridging
 *      contact + source-company breakdown
 *   2. Open trigger overlay per company (the "hot marker" — every
 *      company with an open trigger gets a red badge + the
 *      strongest trigger's pattern + score)
 *
 * v1 is a tabular representation, not a force-directed graph. A
 * proper force-directed view requires `react-force-graph-2d` (~30kb
 * gzipped) as a dependency; the table form is decision-dense
 * enough for v1 and ships without the dep. Phase 7.5 can swap to
 * the graph lib once the table proves the data model is right.
 */

interface OpenTriggerForGraph {
  id: string
  pattern: string
  trigger_score: number
  rationale: string
}

interface CompanyRow {
  id: string
  name: string
  inbound_bridge_count: number
  source_companies: Array<{ id: string; name: string | null }>
  open_triggers: OpenTriggerForGraph[]
}

export default async function WikiGraphPage() {
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

  // Pull the inbound-bridge edges + open triggers in parallel.
  const [edgesRes, triggersRes] = await Promise.all([
    supabase
      .from('memory_edges')
      .select('id, src_id, dst_id')
      .eq('tenant_id', profile.tenant_id)
      .eq('edge_kind', 'bridges_to')
      .eq('src_kind', 'company')
      .eq('dst_kind', 'company')
      .limit(5000),
    supabase
      .from('triggers')
      .select('id, company_id, pattern, trigger_score, rationale')
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'open')
      .order('trigger_score', { ascending: false })
      .limit(500),
  ])

  const edges = (edgesRes.data ?? []) as Array<{ id: string; src_id: string; dst_id: string }>
  const openTriggers = (triggersRes.data ?? []) as Array<{
    id: string
    company_id: string | null
    pattern: string
    trigger_score: number
    rationale: string
  }>

  // Build per-company aggregates.
  const inboundByCompany = new Map<string, Set<string>>()
  for (const e of edges) {
    if (e.src_id === e.dst_id) continue
    const arr = inboundByCompany.get(e.dst_id) ?? new Set()
    arr.add(e.src_id)
    inboundByCompany.set(e.dst_id, arr)
  }
  const triggersByCompany = new Map<string, typeof openTriggers>()
  for (const t of openTriggers) {
    if (!t.company_id) continue
    const arr = triggersByCompany.get(t.company_id) ?? []
    arr.push(t)
    triggersByCompany.set(t.company_id, arr)
  }

  // Top 30 by inbound bridge count.
  const sortedCompanyIds = Array.from(inboundByCompany.entries())
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 30)
    .map(([id]) => id)

  // Hydrate names — both target companies and bridging source companies.
  const allCompanyIds = new Set<string>(sortedCompanyIds)
  for (const id of sortedCompanyIds) {
    for (const src of inboundByCompany.get(id) ?? []) allCompanyIds.add(src)
  }
  for (const t of openTriggers) {
    if (t.company_id) allCompanyIds.add(t.company_id)
  }
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name')
    .eq('tenant_id', profile.tenant_id)
    .in('id', Array.from(allCompanyIds))
  const companyById = new Map((companies ?? []).map((c) => [c.id as string, c.name as string]))

  const rows: CompanyRow[] = sortedCompanyIds.map((cid) => {
    const sources = Array.from(inboundByCompany.get(cid) ?? []).slice(0, 6)
    return {
      id: cid,
      name: companyById.get(cid) ?? cid.slice(0, 8),
      inbound_bridge_count: inboundByCompany.get(cid)?.size ?? 0,
      source_companies: sources.map((sid) => ({
        id: sid,
        name: companyById.get(sid) ?? null,
      })),
      open_triggers: triggersByCompany.get(cid) ?? [],
    }
  })

  // Companies with open triggers but no bridges — also surface
  // these so the rep sees ALL hot accounts regardless of warm-path
  // density. Cap at 10.
  const triggerOnlyCompanyIds = Array.from(triggersByCompany.keys())
    .filter((id) => !inboundByCompany.has(id))
    .slice(0, 10)
  const triggerOnlyRows: CompanyRow[] = triggerOnlyCompanyIds.map((cid) => ({
    id: cid,
    name: companyById.get(cid) ?? cid.slice(0, 8),
    inbound_bridge_count: 0,
    source_companies: [],
    open_triggers: triggersByCompany.get(cid) ?? [],
  }))

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="text-xs">
        <Link href="/admin/wiki" className="text-zinc-500 hover:text-zinc-300">
          ← Back to wiki
        </Link>
      </div>

      <h1 className="mt-3 text-2xl font-semibold text-zinc-100">Wiki graph</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Companies in your CRM ranked by inbound warm-path bridges
        (Phase 7 §3.1). Companies with an open composite trigger get a
        red zap badge — these are the "act now" intersections of warm
        path + buying signal.
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-200">
          Top accounts by warm-path density
        </h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">
            No bridge edges yet — connection miners run nightly. Check back
            tomorrow.
          </p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-md border border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-800 text-sm">
              <thead className="bg-zinc-900/40 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 text-right font-medium">Bridges</th>
                  <th className="px-3 py-2 font-medium">Source customers</th>
                  <th className="px-3 py-2 font-medium">Open triggers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
                {rows.map((r) => (
                  <CompanyGraphRow key={r.id} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {triggerOnlyRows.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-zinc-200">
            Hot accounts without warm paths
          </h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            Open trigger but no inbound bridges — cold-outreach territory
            (or build the bridge via a champion-alumni move).
          </p>
          <div className="mt-2 overflow-hidden rounded-md border border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-800 text-sm">
              <thead className="bg-zinc-900/40 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Open triggers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
                {triggerOnlyRows.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-900/40">
                    <td className="px-3 py-2 text-zinc-200">{r.name}</td>
                    <td className="px-3 py-2 text-xs">
                      <TriggerBadgeList triggers={r.open_triggers} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function CompanyGraphRow({ row }: { row: CompanyRow }) {
  const hasOpen = row.open_triggers.length > 0
  return (
    <tr className="align-top hover:bg-zinc-900/40">
      <td className="px-3 py-2 text-zinc-200">
        <Link href={`/objects/companies/${row.id}`} className="hover:text-emerald-200">
          {row.name}
        </Link>
        {hasOpen && (
          <span
            className="ml-2 inline-flex items-center rounded bg-rose-950 px-1.5 py-0.5 text-[10px] uppercase text-rose-300"
            title={`${row.open_triggers.length} open trigger${row.open_triggers.length === 1 ? '' : 's'}`}
          >
            HOT
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-zinc-300">
        {row.inbound_bridge_count}
      </td>
      <td className="px-3 py-2 text-xs text-zinc-400">
        {row.source_companies.length === 0 ? (
          <span className="text-zinc-600">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.source_companies.map((s) => (
              <Link
                key={s.id}
                href={`/objects/companies/${s.id}`}
                className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:border-zinc-700"
              >
                {s.name ?? s.id.slice(0, 8)}
              </Link>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        <TriggerBadgeList triggers={row.open_triggers} />
      </td>
    </tr>
  )
}

function TriggerBadgeList({
  triggers,
}: {
  triggers: OpenTriggerForGraph[]
}) {
  if (triggers.length === 0) return <span className="text-zinc-600">—</span>
  return (
    <div className="flex flex-col gap-1">
      {triggers.slice(0, 3).map((t) => (
        <Link
          key={t.id}
          href={`/admin/triggers?pattern=${encodeURIComponent(t.pattern)}`}
          className="rounded border border-rose-900/60 bg-rose-950/30 px-1.5 py-0.5 text-[10px] text-rose-200 hover:bg-rose-950/50"
          title={t.rationale}
        >
          {TRIGGER_PATTERN_LABELS[t.pattern as TriggerPattern] ?? t.pattern} ·{' '}
          {t.trigger_score.toFixed(2)}
        </Link>
      ))}
    </div>
  )
}
