import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { CalibrationRollbackButton } from '@/components/admin/calibration-rollback-button'
import {
  MEMORY_KIND_LABELS,
  WIKI_PAGE_KIND_LABELS,
  type MemoryKind,
  type WikiPageKind,
} from '@prospector/core'

export const metadata = { title: 'Per-tenant adaptation' }
export const dynamic = 'force-dynamic'

/**
 * Per-tenant adaptation ledger — customer-facing view of every adaptation
 * the system has made (prompt overrides, scoring weight changes, tool prior
 * updates, retrieval rankings). Builds trust: customers see exactly how
 * the OS is changing behaviour for their business.
 */
export default async function AdaptationPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
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

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    ledgerRes,
    proposalsRes,
    reportsRes,
    priorsRes,
    snapshotsRes,
    // Phase 6 (Section 1.3) — memory + wiki KPIs.
    recentAtomsRes,
    recentPagesRes,
    memoryEventsRes,
    schemaRes,
    lintWarningsRes,
  ] = await Promise.all([
    supabase
      .from('calibration_ledger')
      .select('id, change_type, target_path, observed_lift, applied_at, notes')
      .eq('tenant_id', profile.tenant_id)
      .order('applied_at', { ascending: false })
      .limit(20),
    supabase
      .from('calibration_proposals')
      .select('id, config_type, created_at, proposed_config, status')
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('improvement_reports')
      .select('id, period_start, period_end, failure_cluster_count, proposed_fixes')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('tool_priors')
      .select('intent_class, tool_id, alpha, beta, sample_count, updated_at')
      .eq('tenant_id', profile.tenant_id)
      .order('sample_count', { ascending: false })
      .limit(20),
    // P0.2 baseline snapshots — weekly KPI trendline so improvement
    // is attributable to specific sprints. Reads only the
    // baseline_snapshot rows so other improvement_reports kinds (the
    // weekly self-improve markdown) keep their own section above.
    supabase
      .from('improvement_reports')
      .select('id, period_end, metrics')
      .eq('tenant_id', profile.tenant_id)
      .eq('kind', 'baseline_snapshot')
      .order('period_end', { ascending: false })
      .limit(8),
    // Phase 6 — atoms derived in the last 7 days, top-3-per-kind by
    // confidence (used in the "what we learned this week" panel).
    supabase
      .from('tenant_memories')
      .select('id, kind, title, confidence, status, derived_at')
      .eq('tenant_id', profile.tenant_id)
      .in('status', ['proposed', 'approved', 'pinned'])
      .gte('derived_at', sevenDaysAgo)
      .order('confidence', { ascending: false })
      .limit(80),
    // Phase 6 — wiki pages compiled in the last 7 days.
    supabase
      .from('wiki_pages')
      .select('id, kind, slug, title, confidence, decay_score, last_compiled_at, status')
      .eq('tenant_id', profile.tenant_id)
      .in('status', ['draft', 'published', 'pinned'])
      .gte('last_compiled_at', sevenDaysAgo)
      .order('confidence', { ascending: false })
      .limit(50),
    // Phase 6 — memory + wiki event counts in the 7-day window for
    // the citation-rate signal.
    supabase
      .from('agent_events')
      .select('event_type', { head: false })
      .eq('tenant_id', profile.tenant_id)
      .in('event_type', [
        'memory_injected',
        'memory_cited',
        'wiki_page_injected',
        'wiki_page_cited',
        'wiki_page_lint_warning',
      ])
      .gte('created_at', sevenDaysAgo)
      .limit(2000),
    // Phase 6 — schema row for the auto-revisions stat.
    supabase
      .from('tenant_wiki_schema')
      .select('version, auto_revisions, updated_at')
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle(),
    // Phase 6 — open lint warnings (orphan + broken_wikilink + decay_archived).
    supabase
      .from('agent_events')
      .select('payload', { head: false })
      .eq('tenant_id', profile.tenant_id)
      .eq('event_type', 'wiki_page_lint_warning')
      .gte('created_at', sevenDaysAgo)
      .limit(200),
  ])

  // Aggregate Phase 6 KPIs.
  const recentAtoms = (recentAtomsRes.data ?? []) as Array<{
    id: string
    kind: string
    title: string
    confidence: number
    status: string
    derived_at: string
  }>
  const recentPages = (recentPagesRes.data ?? []) as Array<{
    id: string
    kind: string
    slug: string
    title: string
    confidence: number
    decay_score: number
    last_compiled_at: string
    status: string
  }>
  const memoryEvents = (memoryEventsRes.data ?? []) as Array<{ event_type: string }>
  const lintWarnings = (lintWarningsRes.data ?? []) as Array<{
    payload: Record<string, unknown>
  }>

  const eventCounts: Record<string, number> = {
    memory_injected: 0,
    memory_cited: 0,
    wiki_page_injected: 0,
    wiki_page_cited: 0,
  }
  for (const e of memoryEvents) {
    if (e.event_type in eventCounts) eventCounts[e.event_type] += 1
  }
  const memCitationRate =
    eventCounts.memory_injected > 0
      ? eventCounts.memory_cited / eventCounts.memory_injected
      : null
  const pageCitationRate =
    eventCounts.wiki_page_injected > 0
      ? eventCounts.wiki_page_cited / eventCounts.wiki_page_injected
      : null

  // Top-3 atoms per kind by confidence (newest within 7d window).
  const atomsByKind = new Map<string, typeof recentAtoms>()
  for (const a of recentAtoms) {
    const arr = atomsByKind.get(a.kind) ?? []
    arr.push(a)
    atomsByKind.set(a.kind, arr)
  }
  const pagesByKind = new Map<string, typeof recentPages>()
  for (const p of recentPages) {
    const arr = pagesByKind.get(p.kind) ?? []
    arr.push(p)
    pagesByKind.set(p.kind, arr)
  }

  const lintWarningCounts: Record<string, number> = {}
  for (const w of lintWarnings) {
    const t = (w.payload?.warning_type as string | undefined) ?? 'unknown'
    lintWarningCounts[t] = (lintWarningCounts[t] ?? 0) + 1
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Per-tenant adaptation</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Everything the OS has learned about your business. Every change is auditable, every
        adaptation reversible via the calibration ledger.
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-200">Calibration ledger</h2>
        {(ledgerRes.data ?? []).length > 0 ? (
          <div className="mt-2 overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left">Applied</th>
                  <th className="px-3 py-2 text-left">Change</th>
                  <th className="px-3 py-2 text-left">Target</th>
                  <th className="px-3 py-2 text-right">Lift</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {(ledgerRes.data ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-zinc-800">
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {r.applied_at ? new Date(r.applied_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-2">{r.change_type}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-400">{r.target_path}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-300">
                      {r.observed_lift != null ? `${(Number(r.observed_lift) * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <CalibrationRollbackButton ledgerId={r.id} changeType={r.change_type} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs text-zinc-500">No adaptations applied yet. This populates once the self-improvement loop runs.</p>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">What we learned this week</h2>
          <span className="text-[11px] text-zinc-500">
            7-day window · {recentAtoms.length} atom{recentAtoms.length === 1 ? '' : 's'} ·{' '}
            {recentPages.length} page{recentPages.length === 1 ? '' : 's'} compiled
          </span>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          Atoms mined and wiki pages compiled in the last 7 days, plus the bandit's
          impression / citation signal. Phase 6 (Two-Level Second Brain).
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label="memory_injected"
            value={eventCounts.memory_injected}
            sublabel="atoms surfaced to the prompt"
          />
          <KpiCard
            label="memory_cited"
            value={eventCounts.memory_cited}
            sublabel={
              memCitationRate !== null
                ? `${(memCitationRate * 100).toFixed(0)}% citation rate`
                : 'no impressions yet'
            }
          />
          <KpiCard
            label="wiki_page_injected"
            value={eventCounts.wiki_page_injected}
            sublabel="pages surfaced to the prompt"
          />
          <KpiCard
            label="wiki_page_cited"
            value={eventCounts.wiki_page_cited}
            sublabel={
              pageCitationRate !== null
                ? `${(pageCitationRate * 100).toFixed(0)}% citation rate`
                : 'no impressions yet'
            }
          />
        </div>

        {(Object.keys(lintWarningCounts).length > 0 ||
          (schemaRes.data?.auto_revisions ?? 0) > 0) && (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            {Object.entries(lintWarningCounts).map(([type, count]) => (
              <Link
                key={type}
                href={`/admin/wiki?lint=${encodeURIComponent(type)}`}
                className="rounded border border-amber-900/60 bg-amber-950/20 px-2 py-0.5 text-amber-300 hover:bg-amber-950/40"
              >
                {type.replace(/_/g, ' ')}: {count}
              </Link>
            ))}
            {(schemaRes.data?.auto_revisions ?? 0) > 0 && (
              <Link
                href="/admin/wiki/schema"
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
              >
                schema auto-revisions: {schemaRes.data?.auto_revisions ?? 0}
              </Link>
            )}
          </div>
        )}

        {atomsByKind.size > 0 && (
          <div className="mt-4">
            <h3 className="text-[11px] uppercase tracking-wide text-zinc-500">
              New atoms by kind (top 3 per kind by confidence)
            </h3>
            <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
              {Array.from(atomsByKind.entries()).map(([kind, rows]) => (
                <div
                  key={kind}
                  className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3"
                >
                  <div className="flex items-baseline justify-between">
                    <div className="text-xs font-semibold text-zinc-300">
                      {MEMORY_KIND_LABELS[kind as MemoryKind] ?? kind}
                    </div>
                    <Link
                      href={`/admin/memory?status=proposed&kind=${encodeURIComponent(kind)}`}
                      className="text-[11px] text-zinc-500 hover:text-zinc-300"
                    >
                      {rows.length} new →
                    </Link>
                  </div>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-400">
                    {rows.slice(0, 3).map((r) => (
                      <li key={r.id}>
                        <span className="text-zinc-600">
                          [{r.confidence.toFixed(2)}]
                        </span>{' '}
                        {r.title.slice(0, 80)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {pagesByKind.size > 0 && (
          <div className="mt-4">
            <h3 className="text-[11px] uppercase tracking-wide text-zinc-500">
              Newly compiled pages by kind
            </h3>
            <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
              {Array.from(pagesByKind.entries()).map(([kind, rows]) => (
                <div
                  key={kind}
                  className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3"
                >
                  <div className="flex items-baseline justify-between">
                    <div className="text-xs font-semibold text-zinc-300">
                      {WIKI_PAGE_KIND_LABELS[kind as WikiPageKind] ?? kind}
                    </div>
                    <Link
                      href={`/admin/wiki?kind=${encodeURIComponent(kind)}`}
                      className="text-[11px] text-zinc-500 hover:text-zinc-300"
                    >
                      {rows.length} compiled →
                    </Link>
                  </div>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-400">
                    {rows.slice(0, 3).map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`/admin/wiki/${r.id}`}
                          className="hover:text-emerald-300"
                        >
                          <span className="text-zinc-600">
                            [{r.confidence.toFixed(2)}]
                          </span>{' '}
                          {r.title.slice(0, 80)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {atomsByKind.size === 0 && pagesByKind.size === 0 && (
          <p className="mt-3 text-xs text-zinc-500">
            No new atoms or pages this week. Mining workflows run nightly at
            02:00 UTC; check back tomorrow.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-200">Pending proposals ({proposalsRes.data?.length ?? 0})</h2>
        {(proposalsRes.data ?? []).length > 0 ? (
          <ul className="mt-2 space-y-2">
            {(proposalsRes.data ?? []).map((p) => (
              <li key={p.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-100 capitalize">
                    {p.config_type} weights
                  </span>
                  <span className="text-xs text-zinc-500">{new Date(p.created_at).toLocaleDateString()}</span>
                </div>
                <Link href="/admin/calibration" className="mt-1 inline-block text-xs text-sky-300 hover:underline">
                  Review →
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-zinc-500">
            No pending proposals. The scoring calibration workflow runs daily and proposes
            weight updates once 20+ closed deals are available.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-200">North-star metrics trend (weekly)</h2>
        <p className="mt-1 text-[11px] text-zinc-500">
          Captured every Monday by the <code className="rounded bg-zinc-900 px-1 text-[10px]">baseline_snapshot</code>{' '}
          workflow. Each row is sourced from the event log + workflow_runs — zero hardcoded numbers.
        </p>
        {(snapshotsRes.data ?? []).length > 0 ? (
          <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left">Week ending</th>
                  <th className="px-3 py-2 text-right">$/rep/30d</th>
                  <th className="px-3 py-2 text-right">Cited %</th>
                  <th className="px-3 py-2 text-right">Thumbs-up %</th>
                  <th className="px-3 py-2 text-right">Slice samples</th>
                  <th className="px-3 py-2 text-right">Eval cases</th>
                  <th className="px-3 py-2 text-right">Halluc. signals</th>
                  <th className="px-3 py-2 text-right">Prompt diffs/30d</th>
                  <th className="px-3 py-2 text-right">First-run p50</th>
                </tr>
              </thead>
              <tbody>
                {(snapshotsRes.data ?? []).map((s) => {
                  const m = (s.metrics ?? {}) as {
                    per_rep_cost_30d_usd?: number
                    cited_answer_rate?: number
                    thumbs_up_rate?: number
                    slice_priors_sample_count?: number
                    eval_cases_accepted?: number
                    hallucinated_signals_30d?: number
                    prompt_diffs_30d?: number
                    first_run_completed_30d?: number
                    first_run_p50_elapsed_ms?: number | null
                  }
                  const p50 = m.first_run_p50_elapsed_ms
                  return (
                    <tr key={s.id} className="border-t border-zinc-800">
                      <td className="px-3 py-2 text-xs text-zinc-500">
                        {s.period_end ? new Date(s.period_end).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        ${(m.per_rep_cost_30d_usd ?? 0).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {((m.cited_answer_rate ?? 0) * 100).toFixed(0)}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {((m.thumbs_up_rate ?? 0) * 100).toFixed(0)}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.slice_priors_sample_count ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.eval_cases_accepted ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.hallucinated_signals_30d ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.prompt_diffs_30d ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[11px] text-zinc-400">
                        {p50 != null ? `${(p50 / 1000).toFixed(1)}s` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs text-zinc-500">
            No snapshots yet. The first row lands within 24 hours of the next nightly cron.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-200">Recent improvement reports</h2>
        <ul className="mt-2 space-y-2">
          {(reportsRes.data ?? []).map((r) => (
            <li key={r.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-200">
                  {new Date(r.period_start).toLocaleDateString()} — {new Date(r.period_end).toLocaleDateString()}
                </span>
                <span className="text-xs text-zinc-500">
                  {r.failure_cluster_count} failure clusters · {(r.proposed_fixes as unknown[] | null)?.length ?? 0} proposed fixes
                </span>
              </div>
            </li>
          ))}
          {(!reportsRes.data || reportsRes.data.length === 0) && (
            <p className="text-xs text-zinc-500">No improvement reports yet. Runs nightly once the OS has 7 days of data.</p>
          )}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-200">Tool priors (Thompson bandit)</h2>
        {(priorsRes.data ?? []).length > 0 ? (
          <div className="mt-2 overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left">Intent</th>
                  <th className="px-3 py-2 text-left">Tool</th>
                  <th className="px-3 py-2 text-right">α</th>
                  <th className="px-3 py-2 text-right">β</th>
                  <th className="px-3 py-2 text-right">Samples</th>
                  <th className="px-3 py-2 text-right">E[success]</th>
                </tr>
              </thead>
              <tbody>
                {(priorsRes.data ?? []).map((r) => {
                  const a = Number(r.alpha) || 1
                  const b = Number(r.beta) || 1
                  return (
                    <tr key={`${r.intent_class}:${r.tool_id}`} className="border-t border-zinc-800">
                      <td className="px-3 py-2 text-zinc-300">{r.intent_class}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.tool_id}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.sample_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{((a / (a + b)) * 100).toFixed(0)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs text-zinc-500">No tool priors yet. Populated as users feed back on responses.</p>
        )}
      </section>
    </div>
  )
}

/**
 * Compact KPI stat card. Used by the Phase 6 "What we learned this
 * week" section to surface memory + wiki injection / citation counts
 * at a glance.
 */
function KpiCard({
  label,
  value,
  sublabel,
}: {
  label: string
  value: number
  sublabel: string
}) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-zinc-100 tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{sublabel}</div>
    </div>
  )
}
