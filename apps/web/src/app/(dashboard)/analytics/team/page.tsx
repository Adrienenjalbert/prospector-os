import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'

export const metadata = { title: 'Team — Analytics' }
export const dynamic = 'force-dynamic'

/**
 * Sprint 4 (Mission–Reality Gap roadmap): replaces the placeholder
 * `analytics/team/page.tsx` with four real panels. The page reads
 * the most recent row per rep from `team_metrics` (written nightly
 * by the team-aggregation workflow), and renders:
 *
 *   1. Attainment leaderboard      — quota vs won-this-quarter
 *   2. Pipeline coverage           — open weighted pipeline ÷ gap-to-quota
 *   3. Stalled deals heatmap       — count by rep
 *   4. Forecast roll-up            — sum of bootstrap CIs across reps
 *
 * MISSION §9.8: empty-state per panel, not fake numbers. A panel
 * without data shows a "data not yet available" card and points the
 * manager at where the data will come from.
 */

interface TeamMetricRow {
  rep_id: string
  quota_quarterly: number | null
  attainment_quarterly: number | null
  pipeline_coverage: number | null
  weighted_pipeline: number | null
  stalled_deal_count: number | null
  forecast_low: number | null
  forecast_mid: number | null
  forecast_high: number | null
  generated_at: string | null
  metric_date: string | null
}

interface RepRow {
  id: string
  name: string
  active: boolean | null
}

function formatGBP(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `£${Math.round(n / 1_000)}K`
  return `£${Math.round(n).toLocaleString()}`
}

function formatPercent(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${Math.round(n * 100)}%`
}

function formatRatio(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${n.toFixed(1)}×`
}

export default async function TeamPage() {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let userRole = 'rep'
  let tenantId: string | null = null

  if (user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, tenant_id')
      .eq('id', user.id)
      .single()
    userRole = profile?.role ?? 'rep'
    tenantId = profile?.tenant_id ?? null
  }

  if (!['manager', 'admin', 'revops'].includes(userRole)) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Team</h1>
        <p className="mt-4 text-zinc-500">
          Team performance is available for managers and above.
        </p>
      </div>
    )
  }

  if (!tenantId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Team</h1>
        <p className="mt-4 text-zinc-500">No tenant resolved. Contact your admin.</p>
      </div>
    )
  }

  // Pull the most recent metric_date per rep. Postgres lacks a
  // straightforward DISTINCT ON in PostgREST so we fetch the last 14
  // days and reduce to the latest per rep client-side. Cheap because
  // the table is per-day per-rep — at most 14 × N rows.
  //
  // Server-component renders once per request — the React purity rule
  // is a false positive (it's calibrated for client components that
  // re-render). Pattern matches 22 pre-existing instances elsewhere
  // in the dashboard.
  // eslint-disable-next-line react-hooks/purity
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000)
    .toISOString()
    .slice(0, 10)
  const [metricsRes, repsRes] = await Promise.all([
    supabase
      .from('team_metrics')
      .select(
        'rep_id, quota_quarterly, attainment_quarterly, pipeline_coverage, weighted_pipeline, stalled_deal_count, forecast_low, forecast_mid, forecast_high, generated_at, metric_date',
      )
      .eq('tenant_id', tenantId)
      .gte('metric_date', fourteenDaysAgo)
      .order('metric_date', { ascending: false }),
    supabase
      .from('rep_profiles')
      .select('id, name, active')
      .eq('tenant_id', tenantId)
      .eq('active', true),
  ])

  const reps = (repsRes.data ?? []) as RepRow[]
  const repNameById = new Map(reps.map((r) => [r.id, r.name]))

  const latestPerRep = new Map<string, TeamMetricRow>()
  for (const m of (metricsRes.data ?? []) as TeamMetricRow[]) {
    if (!latestPerRep.has(m.rep_id)) latestPerRep.set(m.rep_id, m)
  }

  const rows = Array.from(latestPerRep.values()).map((m) => ({
    ...m,
    name: repNameById.get(m.rep_id) ?? '(unknown rep)',
  }))

  const hasAnyData = rows.length > 0
  const lastGeneratedAt = rows
    .map((r) => r.generated_at)
    .filter((d): d is string => d != null)
    .sort()
    .at(-1)

  const attainmentRows = rows.filter((r) => r.attainment_quarterly != null)
  const coverageRows = rows.filter((r) => r.pipeline_coverage != null)
  const stallRows = rows.filter((r) => (r.stalled_deal_count ?? 0) > 0)
  const forecastRows = rows.filter(
    (r) => r.forecast_low != null && r.forecast_mid != null && r.forecast_high != null,
  )

  const totalForecast = forecastRows.reduce(
    (acc, r) => ({
      low: acc.low + Number(r.forecast_low ?? 0),
      mid: acc.mid + Number(r.forecast_mid ?? 0),
      high: acc.high + Number(r.forecast_high ?? 0),
    }),
    { low: 0, mid: 0, high: 0 },
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Team Performance</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Per-rep attainment, pipeline coverage, stalled deals and forecast — refreshed nightly.
          </p>
        </div>
        {lastGeneratedAt && (
          <p className="text-xs text-zinc-500">
            As of {new Date(lastGeneratedAt).toLocaleString()}
          </p>
        )}
      </div>

      {!hasAnyData && <NoDataYet />}

      {hasAnyData && (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AttainmentLeaderboard rows={attainmentRows.map(toLeaderRow)} />
          <PipelineCoveragePanel rows={coverageRows.map(toCoverageRow)} />
          <StalledHeatmap rows={stallRows.map(toStallRow)} />
          <ForecastRollup totalForecast={totalForecast} repCount={forecastRows.length} />
        </div>
      )}
    </div>
  )
}

function toLeaderRow(r: TeamMetricRow & { name: string }) {
  return {
    name: r.name,
    quota: r.quota_quarterly,
    attainment: r.attainment_quarterly,
  }
}

function toCoverageRow(r: TeamMetricRow & { name: string }) {
  return {
    name: r.name,
    coverage: r.pipeline_coverage,
    weightedPipeline: r.weighted_pipeline,
  }
}

function toStallRow(r: TeamMetricRow & { name: string }) {
  return {
    name: r.name,
    stalls: r.stalled_deal_count ?? 0,
  }
}

function NoDataYet() {
  return (
    <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-6">
      <p className="text-sm text-zinc-300">
        No team snapshot has run yet for this tenant. The nightly{' '}
        <code className="text-zinc-200">team_aggregation</code> workflow writes
        one row per rep per day; once it has run at least once, the four
        panels below populate.
      </p>
      <p className="mt-3 text-sm text-zinc-400">
        While you wait, browse the{' '}
        <Link href="/objects/companies" className="text-sky-300 hover:underline">
          companies ontology
        </Link>{' '}
        for individual account truth or{' '}
        <Link href="/admin/roi" className="text-sky-300 hover:underline">
          /admin/roi
        </Link>{' '}
        for adoption + cost trends.
      </p>
    </div>
  )
}

function PanelEmpty({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-5">
      <h2 className="text-sm font-semibold tracking-tight text-zinc-200">{title}</h2>
      <p className="mt-2 text-sm text-zinc-500">{body}</p>
    </section>
  )
}

function AttainmentLeaderboard({
  rows,
}: {
  rows: { name: string; quota: number | null; attainment: number | null }[]
}) {
  if (rows.length === 0) {
    return (
      <PanelEmpty
        title="Attainment leaderboard"
        body="No reps have a quarterly quota set yet. Add quota_quarterly on rep_profiles to populate this panel."
      />
    )
  }
  const sorted = [...rows].sort((a, b) => (b.attainment ?? 0) - (a.attainment ?? 0))
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-5">
      <h2 className="text-sm font-semibold tracking-tight text-zinc-200">Attainment leaderboard</h2>
      <p className="mt-1 text-xs text-zinc-500">Won this quarter ÷ quota</p>
      <ul className="mt-4 space-y-2 text-sm text-zinc-100">
        {sorted.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-3">
            <span className="truncate">{r.name}</span>
            <div className="flex items-center gap-3 font-mono tabular-nums text-zinc-300">
              <span className="text-zinc-500">{formatGBP(r.quota)}</span>
              <span
                className={
                  (r.attainment ?? 0) >= 1
                    ? 'text-emerald-300'
                    : (r.attainment ?? 0) >= 0.7
                      ? 'text-amber-300'
                      : 'text-rose-300'
                }
              >
                {formatPercent(r.attainment)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function PipelineCoveragePanel({
  rows,
}: {
  rows: { name: string; coverage: number | null; weightedPipeline: number | null }[]
}) {
  if (rows.length === 0) {
    return (
      <PanelEmpty
        title="Pipeline coverage"
        body="Coverage requires a quarterly quota per rep. Set quota_quarterly to render this panel."
      />
    )
  }
  const sorted = [...rows].sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0))
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-5">
      <h2 className="text-sm font-semibold tracking-tight text-zinc-200">Pipeline coverage</h2>
      <p className="mt-1 text-xs text-zinc-500">Open weighted pipeline ÷ gap to quota — 3× is healthy</p>
      <ul className="mt-4 space-y-2 text-sm text-zinc-100">
        {sorted.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-3">
            <span className="truncate">{r.name}</span>
            <div className="flex items-center gap-3 font-mono tabular-nums text-zinc-300">
              <span className="text-zinc-500">{formatGBP(r.weightedPipeline)}</span>
              <span
                className={
                  (r.coverage ?? 0) >= 3
                    ? 'text-emerald-300'
                    : (r.coverage ?? 0) >= 1.5
                      ? 'text-amber-300'
                      : 'text-rose-300'
                }
              >
                {formatRatio(r.coverage)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function StalledHeatmap({ rows }: { rows: { name: string; stalls: number }[] }) {
  if (rows.length === 0) {
    return (
      <PanelEmpty
        title="Stalled deals"
        body="No stalled deals across the team. Either every deal is moving (great) or the stall detector hasn't run yet."
      />
    )
  }
  const max = Math.max(1, ...rows.map((r) => r.stalls))
  const sorted = [...rows].sort((a, b) => b.stalls - a.stalls)
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-5">
      <h2 className="text-sm font-semibold tracking-tight text-zinc-200">Stalled deals</h2>
      <p className="mt-1 text-xs text-zinc-500">Open deals flagged as stalled, by rep</p>
      <ul className="mt-4 space-y-2 text-sm text-zinc-100">
        {sorted.map((r) => {
          const widthPct = Math.round((r.stalls / max) * 100)
          return (
            <li key={r.name} className="flex items-center gap-3">
              <span className="w-32 truncate">{r.name}</span>
              <div className="relative h-2 flex-1 overflow-hidden rounded bg-zinc-800">
                <div
                  className="h-2 bg-amber-500/70"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <span className="w-8 text-right font-mono tabular-nums text-zinc-300">
                {r.stalls}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ForecastRollup({
  totalForecast,
  repCount,
}: {
  totalForecast: { low: number; mid: number; high: number }
  repCount: number
}) {
  if (repCount === 0) {
    return (
      <PanelEmpty
        title="Forecast roll-up"
        body="Forecast bands populate once reps have open opportunities. Connect your CRM and the next nightly run will fill this in."
      />
    )
  }
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-5">
      <h2 className="text-sm font-semibold tracking-tight text-zinc-200">Forecast roll-up</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Bootstrap p10 / p50 / p90 across {repCount} rep{repCount === 1 ? '' : 's'}
      </p>
      <div className="mt-5 grid grid-cols-3 gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Low (p10)</div>
          <div className="mt-1 font-mono text-xl tabular-nums text-rose-300">
            {formatGBP(totalForecast.low)}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Mid (p50)</div>
          <div className="mt-1 font-mono text-xl tabular-nums text-zinc-100">
            {formatGBP(totalForecast.mid)}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">High (p90)</div>
          <div className="mt-1 font-mono text-xl tabular-nums text-emerald-300">
            {formatGBP(totalForecast.high)}
          </div>
        </div>
      </div>
    </section>
  )
}
