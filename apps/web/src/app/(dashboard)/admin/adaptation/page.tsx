import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { CalibrationRollbackButton } from '@/components/admin/calibration-rollback-button'
import {
  MEMORY_KIND_LABELS,
  WIKI_PAGE_KIND_LABELS,
  TRIGGER_PATTERN_LABELS,
  type MemoryKind,
  type WikiPageKind,
  type TriggerPattern,
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
  // Server component renders once per request — the React purity rule
  // is a false positive here (it's calibrated for client components
  // that re-render). The codebase has 22 pre-existing instances of
  // this pattern; we follow the convention here rather than hoist.
  // eslint-disable-next-line react-hooks/purity
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

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
    // Sprint 6 (Mission–Reality Gap roadmap) — 30-day cited-answer
    // rate trend. MISSION §14 sets the target ≥ 95%; this panel
    // makes the trend visible (not just the weekly snapshot in the
    // table below).
    citedAnswerEventsRes,
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
    // Sprint 6 — every response_finished event in the last 30 days
    // with its citation_count payload. The page reduces this
    // client-side into per-day rates, then renders a sparkline +
    // 30-day aggregate. Pulling occurred_at + payload (not
    // created_at) so a slow telemetry write doesn't shift a row
    // out of the window inconsistently.
    supabase
      .from('agent_events')
      .select('payload, occurred_at')
      .eq('tenant_id', profile.tenant_id)
      .eq('event_type', 'response_finished')
      .gte('occurred_at', thirtyDaysAgo)
      .limit(5000),
  ])

  // Phase 7 KPIs — triggers + bridges this week. Run as a separate
  // batch so the Phase 6 await does not block on the new tables (which
  // may not exist on tenants pre-migration 024).
  const [triggersRes, bridgeEdgesRes, triggerEventsRes] = await Promise.all([
    supabase
      .from('triggers')
      .select('id, pattern, status, trigger_score, detected_at, acted_at')
      .eq('tenant_id', profile.tenant_id)
      .gte('detected_at', sevenDaysAgo)
      .limit(2000),
    supabase
      .from('memory_edges')
      .select('id, edge_kind, src_kind, dst_kind, created_at')
      .eq('tenant_id', profile.tenant_id)
      .in('edge_kind', ['bridges_to', 'coworked_with', 'alumni_of'])
      .gte('created_at', sevenDaysAgo)
      .limit(2000),
    supabase
      .from('agent_events')
      .select('event_type', { head: false })
      .eq('tenant_id', profile.tenant_id)
      .in('event_type', [
        'trigger_detected',
        'trigger_injected',
        'trigger_cited',
        'trigger_acted',
        'trigger_dismissed',
        'trigger_expired',
        'bridge_detected',
      ])
      .gte('created_at', sevenDaysAgo)
      .limit(2000),
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

  // Phase 7 — trigger + bridge KPIs.
  const triggers = (triggersRes.data ?? []) as Array<{
    id: string
    pattern: string
    status: string
    trigger_score: number
    detected_at: string
    acted_at: string | null
  }>
  const bridgeEdges = (bridgeEdgesRes.data ?? []) as Array<{
    id: string
    edge_kind: string
    src_kind: string
    dst_kind: string
    created_at: string
  }>
  const triggerEvents = (triggerEventsRes.data ?? []) as Array<{ event_type: string }>

  const triggerEventCounts: Record<string, number> = {
    trigger_detected: 0,
    trigger_cited: 0,
    trigger_acted: 0,
    trigger_dismissed: 0,
    trigger_expired: 0,
    bridge_detected: 0,
  }
  for (const e of triggerEvents) {
    if (e.event_type in triggerEventCounts) triggerEventCounts[e.event_type] += 1
  }

  // Per-pattern roll-up: detected/acted/dismissed/expired counts.
  const triggerByPattern = new Map<
    string,
    { detected: number; acted: number; dismissed: number; expired: number; open: number }
  >()
  for (const t of triggers) {
    const slot = triggerByPattern.get(t.pattern) ?? {
      detected: 0,
      acted: 0,
      dismissed: 0,
      expired: 0,
      open: 0,
    }
    slot.detected += 1
    if (t.status === 'acted') slot.acted += 1
    else if (t.status === 'dismissed') slot.dismissed += 1
    else if (t.status === 'expired') slot.expired += 1
    else if (t.status === 'open') slot.open += 1
    triggerByPattern.set(t.pattern, slot)
  }
  const triggerPatternRows = Array.from(triggerByPattern.entries())
    .map(([pattern, stats]) => ({
      pattern,
      ...stats,
      conversion: stats.detected > 0 ? stats.acted / stats.detected : 0,
    }))
    .sort((a, b) => b.detected - a.detected)

  const bridgeYieldCounts: Record<string, number> = {}
  for (const e of bridgeEdges) {
    bridgeYieldCounts[e.edge_kind] = (bridgeYieldCounts[e.edge_kind] ?? 0) + 1
  }

  // Sprint 6 — 30-day cited-answer rate trend. Bucket each
  // response_finished event by occurred_at day; rate per day = (rows
  // with citation_count > 0) ÷ total rows that day. The MISSION §14
  // target is ≥ 95% — anything below renders a red "below target"
  // badge so a regressing tenant is immediately visible.
  type CitedRow = { payload: { citation_count?: number } | null; occurred_at: string }
  const citedRows = (citedAnswerEventsRes.data ?? []) as CitedRow[]
  const citedByDay = new Map<string, { total: number; cited: number }>()
  for (const row of citedRows) {
    const day = (row.occurred_at ?? '').slice(0, 10)
    if (!day) continue
    const slot = citedByDay.get(day) ?? { total: 0, cited: 0 }
    slot.total += 1
    if ((row.payload?.citation_count ?? 0) > 0) slot.cited += 1
    citedByDay.set(day, slot)
  }
  const citedSparkline: Array<{ day: string; rate: number; total: number }> = []
  // Server-component loop — same once-per-request justification as above.
  // eslint-disable-next-line react-hooks/purity
  const renderEpoch = Date.now()
  for (let d = 29; d >= 0; d--) {
    const day = new Date(renderEpoch - d * 86400000).toISOString().slice(0, 10)
    const slot = citedByDay.get(day) ?? { total: 0, cited: 0 }
    citedSparkline.push({
      day,
      total: slot.total,
      rate: slot.total > 0 ? slot.cited / slot.total : 0,
    })
  }
  const citedTotalsAggregate = citedRows.reduce(
    (acc, r) => ({
      total: acc.total + 1,
      cited: acc.cited + ((r.payload?.citation_count ?? 0) > 0 ? 1 : 0),
    }),
    { total: 0, cited: 0 },
  )
  const citedRate30d =
    citedTotalsAggregate.total > 0
      ? citedTotalsAggregate.cited / citedTotalsAggregate.total
      : null
  const citedTargetMet = citedRate30d !== null && citedRate30d >= 0.95

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Per-tenant adaptation</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Everything the OS has learned about your business. Every change is auditable, every
        adaptation reversible via the calibration ledger.
      </p>

      <section className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">
            Cited-answer rate (30d)
          </h2>
          {citedRate30d !== null && (
            <span
              className={`rounded px-2 py-0.5 text-[11px] ${
                citedTargetMet
                  ? 'border border-emerald-700/40 bg-emerald-950/30 text-emerald-300'
                  : 'border border-rose-700/40 bg-rose-950/30 text-rose-300'
              }`}
            >
              {(citedRate30d * 100).toFixed(1)}% ·{' '}
              {citedTargetMet ? 'meets ≥ 95% target' : 'below ≥ 95% target'}
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          MISSION §14 sets the target ≥ 95%. Per-day rate = responses with at
          least one citation ÷ total responses. Sources:{' '}
          <code className="rounded bg-zinc-900 px-1 text-[10px]">
            agent_events.payload.citation_count
          </code>{' '}
          on <code className="rounded bg-zinc-900 px-1 text-[10px]">response_finished</code>.
        </p>
        {citedRows.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-500">
            No agent responses in the last 30 days. The chart populates once
            the dashboard chat or Slack mentions/DMs run.
          </p>
        ) : (
          <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <CitedRateSparkline days={citedSparkline} />
            <p className="mt-2 text-[11px] text-zinc-500">
              {citedTotalsAggregate.cited}/{citedTotalsAggregate.total} responses cited at
              least one source in the last 30 days.
            </p>
          </div>
        )}
      </section>

      <section className="mt-8">
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

      {/* Phase 7 — composite triggers + bridge KPIs (Section 8). */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">
            Triggers + bridges this week
          </h2>
          <Link
            href="/admin/triggers"
            className="text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            Open /admin/triggers →
          </Link>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          Composite triggers detected vs acted, plus connection-miner
          bridge yield (Phase 7).
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label="trigger_detected"
            value={triggerEventCounts.trigger_detected}
            sublabel="open + lifecycled this week"
          />
          <KpiCard
            label="trigger_acted"
            value={triggerEventCounts.trigger_acted}
            sublabel={
              triggerEventCounts.trigger_detected > 0
                ? `${(
                    (triggerEventCounts.trigger_acted /
                      triggerEventCounts.trigger_detected) *
                    100
                  ).toFixed(0)}% conversion`
                : 'no detections yet'
            }
          />
          <KpiCard
            label="trigger_cited"
            value={triggerEventCounts.trigger_cited}
            sublabel="agent surfaced + cited"
          />
          <KpiCard
            label="bridge_detected"
            value={triggerEventCounts.bridge_detected}
            sublabel={`${bridgeEdges.length} edges total this week`}
          />
        </div>

        {triggerPatternRows.length > 0 && (
          <div className="mt-4">
            <h3 className="text-[11px] uppercase tracking-wide text-zinc-500">
              Per-pattern conversion (detected → acted)
            </h3>
            <div className="mt-2 overflow-hidden rounded-md border border-zinc-800">
              <table className="min-w-full divide-y divide-zinc-800 text-xs">
                <thead className="bg-zinc-900/40 text-left text-[10px] uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Pattern</th>
                    <th className="px-3 py-2 text-right font-medium">Detected</th>
                    <th className="px-3 py-2 text-right font-medium">Acted</th>
                    <th className="px-3 py-2 text-right font-medium">Dismissed</th>
                    <th className="px-3 py-2 text-right font-medium">Expired</th>
                    <th className="px-3 py-2 text-right font-medium">Open</th>
                    <th className="px-3 py-2 text-right font-medium">Conv.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
                  {triggerPatternRows.map((row) => (
                    <tr key={row.pattern}>
                      <td className="px-3 py-2 text-zinc-300">
                        {TRIGGER_PATTERN_LABELS[row.pattern as TriggerPattern] ?? row.pattern}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.detected}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-300">
                        {row.acted}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                        {row.dismissed}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                        {row.expired}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-300">
                        {row.open}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {(row.conversion * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {Object.keys(bridgeYieldCounts).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            {Object.entries(bridgeYieldCounts).map(([kind, count]) => (
              <span
                key={kind}
                className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-400"
              >
                {kind.replace(/_/g, ' ')}: {count}
              </span>
            ))}
          </div>
        )}

        {triggerPatternRows.length === 0 && bridgeEdges.length === 0 && (
          <p className="mt-3 text-xs text-zinc-500">
            No triggers or bridges this week. Phase 7 workflows run nightly;
            connection miners need ~1 week of contact enrichment data before
            bridges accumulate.
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

/**
 * Inline-SVG cited-answer rate sparkline (Sprint 6). Same dep-free
 * approach as the cost sparkline on /admin/roi. Threshold line at
 * 95% (MISSION §14) drawn so dips below target are visually obvious.
 */
function CitedRateSparkline({
  days,
}: {
  days: Array<{ day: string; rate: number; total: number }>
}) {
  const w = 600
  const h = 100
  const pad = 4
  // Y axis: 0 to 1 (rate). Threshold line lives at 0.95.
  const yFor = (r: number) => h - pad - r * (h - pad * 2)
  const stepX = days.length > 1 ? (w - pad * 2) / (days.length - 1) : 0
  const points = days.map((d, i) => ({
    x: pad + i * stepX,
    y: yFor(d.rate),
  }))
  const lineD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')

  const last = days[days.length - 1]
  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-24 w-full"
        role="img"
        aria-label="Cited-answer rate per day, last 30 days"
      >
        {/* 95% target line */}
        <line
          x1={pad}
          x2={w - pad}
          y1={yFor(0.95)}
          y2={yFor(0.95)}
          stroke="currentColor"
          strokeDasharray="3 3"
          className="text-emerald-700/50"
        />
        <text
          x={w - pad}
          y={yFor(0.95) - 3}
          fontSize="9"
          textAnchor="end"
          fill="currentColor"
          className="fill-emerald-500/70"
        >
          95% target
        </text>
        <path
          d={lineD}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-sky-300"
        />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500">
        <span>{days[0]?.day}</span>
        <span className="font-mono tabular-nums">
          today: {(last?.rate ?? 0) * 100 < 1
            ? '0%'
            : `${((last?.rate ?? 0) * 100).toFixed(0)}%`}{' '}
          ({last?.total ?? 0} responses)
        </span>
        <span>{last?.day}</span>
      </div>
    </div>
  )
}
