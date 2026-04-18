import { createSupabaseServer } from '@/lib/supabase/server'
import { formatGbp } from '@/lib/utils'
import { ForecastDashboard } from './forecast-dashboard'
import { SkillBar } from '@/components/agent/skill-bar'
import { FORECAST_SKILLS } from '@/lib/agent/skills'

interface ForecastNumbers {
  target: number
  closed: number
  committed: number
  upside: number
  hotValue: number
  warmValue: number
  coolValue: number
  dealCount: number
  stallCount: number
  avgCycleDays: number
  winRate: number
  icpQualifiedPct: number
}

type FetchResult =
  | { state: 'no-auth' }
  | { state: 'no-tenant'; role: string }
  | { state: 'unauthorized'; role: string }
  | { state: 'no-data'; role: string }
  | { state: 'ok'; role: string; forecast: ForecastNumbers }

/**
 * Forecast page — REAL data only. Per MISSION UX rule 8 we no longer fall
 * back to a `DEMO_FORECAST` for authenticated tenants with no opportunities;
 * we render an empty state explaining how to populate it.
 */
async function fetchForecastData(): Promise<FetchResult> {
  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { state: 'no-auth' }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, tenant_id')
      .eq('id', user.id)
      .single()

    const role = profile?.role ?? 'rep'
    if (!profile?.tenant_id) return { state: 'no-tenant', role }
    if (!['manager', 'admin', 'revops', 'leader'].includes(role)) {
      return { state: 'unauthorized', role }
    }

    const { data: opps } = await supabase
      .from('opportunities')
      .select('id, stage, expected_revenue, days_in_stage, is_stalled, priority_tier, icp_tier, created_at, close_date')
      .eq('tenant_id', profile.tenant_id)

    if (!opps || opps.length === 0) return { state: 'no-data', role }

    const closedWon = opps.filter((o) => o.stage === 'Closed Won')
    const closedLost = opps.filter((o) => o.stage === 'Closed Lost')
    const open = opps.filter((o) => !['Closed Won', 'Closed Lost'].includes(o.stage ?? ''))

    const closedValue = closedWon.reduce((s, o) => s + (Number(o.expected_revenue) || 0), 0)

    const hotDeals = open.filter((o) => (o.priority_tier ?? '').toUpperCase() === 'HOT')
    const warmDeals = open.filter((o) => (o.priority_tier ?? '').toUpperCase() === 'WARM')
    const coolDeals = open.filter((o) => !['HOT', 'WARM'].includes((o.priority_tier ?? '').toUpperCase()))

    const hotValue = hotDeals.reduce((s, o) => s + (Number(o.expected_revenue) || 0), 0)
    const warmValue = warmDeals.reduce((s, o) => s + (Number(o.expected_revenue) || 0), 0)
    const coolValue = coolDeals.reduce((s, o) => s + (Number(o.expected_revenue) || 0), 0)

    const committedValue = hotValue * 0.85
    const upsideValue = warmValue * 0.5 + coolValue * 0.2

    const stalledCount = open.filter((o) => o.is_stalled).length

    const cycleDays = closedWon
      .map((o) => {
        if (!o.created_at || !o.close_date) return null
        return (new Date(o.close_date).getTime() - new Date(o.created_at).getTime()) / 86_400_000
      })
      .filter((d): d is number => d != null && d > 0)
    const avgCycle = cycleDays.length > 0
      ? Math.round(cycleDays.reduce((s, d) => s + d, 0) / cycleDays.length)
      : 0

    const totalDecided = closedWon.length + closedLost.length
    const winRate = totalDecided > 0 ? Math.round((closedWon.length / totalDecided) * 100) : 0

    const icpQualified = open.filter((o) => ['A', 'B'].includes((o.icp_tier ?? '').toUpperCase())).length
    const icpPct = open.length > 0 ? Math.round((icpQualified / open.length) * 100) : 0

    const { data: benchmarks } = await supabase
      .from('funnel_benchmarks')
      .select('target_value')
      .eq('tenant_id', profile.tenant_id)
      .eq('scope', 'company')
      .order('created_at', { ascending: false })
      .limit(1)

    const target = benchmarks?.[0]?.target_value
      ? Number(benchmarks[0].target_value)
      : Math.max(closedValue * 1.3, 5_000_000)

    return {
      state: 'ok',
      role,
      forecast: {
        target,
        closed: closedValue,
        committed: committedValue,
        upside: upsideValue,
        hotValue,
        warmValue,
        coolValue,
        dealCount: open.length,
        stallCount: stalledCount,
        avgCycleDays: avgCycle,
        winRate,
        icpQualifiedPct: icpPct,
      },
    }
  } catch {
    return { state: 'no-tenant', role: 'rep' }
  }
}

function ForecastEmpty({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Forecast</h1>
      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950 p-8 text-center">
        <p className="text-zinc-300">{message}</p>
      </div>
    </div>
  )
}

export default async function ForecastPage() {
  const result = await fetchForecastData()

  if (result.state === 'no-auth') {
    return <ForecastEmpty message="Sign in to view the forecast." />
  }
  if (result.state === 'no-tenant') {
    return <ForecastEmpty message="Complete onboarding to start the forecast." />
  }
  if (result.state === 'unauthorized') {
    return <ForecastEmpty message="The forecast view is available for managers and above." />
  }
  if (result.state === 'no-data') {
    return (
      <ForecastEmpty
        message="No opportunities found yet. Connect your CRM and run the first sync — the forecast will populate from real opportunity stages and expected revenue."
      />
    )
  }

  const { forecast } = result

  const closedPct = forecast.target > 0 ? Math.round((forecast.closed / forecast.target) * 100) : 0
  const committedPct = forecast.target > 0 ? Math.round(((forecast.closed + forecast.committed) / forecast.target) * 100) : 0
  const bestCasePct = forecast.target > 0 ? Math.round(((forecast.closed + forecast.committed + forecast.upside) / forecast.target) * 100) : 0

  const confidenceLow = forecast.closed + forecast.committed * 0.6
  const confidenceHigh = forecast.closed + forecast.committed + forecast.upside * 0.7

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Forecast
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Q3 2026 · Revenue forecast and pipeline health
          </p>
        </div>
        <SkillBar
          skills={FORECAST_SKILLS}
          pageContext={{ page: 'forecast' }}
        />
      </div>

      {/* Forecast Bar */}
      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="grid grid-cols-4 gap-6 text-center">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Target</p>
            <p className="mt-1 text-2xl font-bold text-zinc-100 font-mono">{formatGbp(forecast.target)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Closed</p>
            <p className="mt-1 text-2xl font-bold text-emerald-400 font-mono">{formatGbp(forecast.closed)}</p>
            <p className="text-xs text-emerald-500">{closedPct}%</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Committed</p>
            <p className="mt-1 text-2xl font-bold text-sky-400 font-mono">{formatGbp(forecast.closed + forecast.committed)}</p>
            <p className="text-xs text-sky-500">{committedPct}%</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Best Case</p>
            <p className="mt-1 text-2xl font-bold text-zinc-300 font-mono">{formatGbp(forecast.closed + forecast.committed + forecast.upside)}</p>
            <p className="text-xs text-zinc-500">{bestCasePct}%</p>
          </div>
        </div>

        {/* Confidence Band */}
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2.5">
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>Weighted Confidence Band</span>
            <span className="font-mono text-zinc-300">
              {formatGbp(confidenceLow)} — {formatGbp(confidenceHigh)}
            </span>
          </div>
          <div className="mt-1.5 relative h-2 w-full rounded-full bg-zinc-800">
            {/* Confidence range */}
            <div
              className="absolute inset-y-0 rounded-full bg-sky-500/20"
              style={{
                left: `${Math.min((confidenceLow / forecast.target) * 100, 100)}%`,
                width: `${Math.min(((confidenceHigh - confidenceLow) / forecast.target) * 100, 100 - (confidenceLow / forecast.target) * 100)}%`,
              }}
            />
            {/* Most likely */}
            <div
              className="absolute inset-y-0 w-0.5 bg-zinc-300"
              style={{ left: `${Math.min(((forecast.closed + forecast.committed * 0.8) / forecast.target) * 100, 100)}%` }}
              title="Most likely"
            />
          </div>
        </div>

        <div className="mt-4">
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-zinc-600/40 transition-all"
              style={{ width: `${Math.min(bestCasePct, 100)}%` }}
              title={`Best case: ${bestCasePct}%`}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-sky-600/60 transition-all"
              style={{ width: `${Math.min(committedPct, 100)}%` }}
              title={`Committed: ${committedPct}%`}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min(closedPct, 100)}%` }}
              title={`Closed: ${closedPct}%`}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
            <span>0%</span>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-emerald-400">Closed {closedPct}%</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-sky-600" />
                <span className="text-sky-400">Committed {committedPct}%</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-zinc-600" />
                <span>Best Case {bestCasePct}%</span>
              </span>
            </div>
            <span>100%</span>
          </div>
        </div>
      </div>

      {/* Trajectory + Risk + Velocity Charts */}
      <div className="mt-6">
        <ForecastDashboard forecast={forecast} />
      </div>

      {/* Key Metrics */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Win Rate', value: `${forecast.winRate}%`, color: 'text-emerald-400' },
          { label: 'Avg Cycle', value: `${forecast.avgCycleDays}d`, color: 'text-zinc-200' },
          { label: 'Active Stalls', value: `${forecast.stallCount}`, color: forecast.stallCount > 5 ? 'text-red-400' : 'text-zinc-200' },
          { label: 'ICP Qualified', value: `${forecast.icpQualifiedPct}%`, color: 'text-sky-400' },
        ].map((metric) => (
          <div key={metric.label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-center">
            <p className="text-xs text-zinc-500">{metric.label}</p>
            <p className={`mt-1 text-2xl font-bold font-mono ${metric.color}`}>{metric.value}</p>
          </div>
        ))}
      </div>

      {/* Pipeline by Priority Tier */}
      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-sm font-semibold text-zinc-200">Pipeline by Priority Tier</h2>
        <div className="mt-4 space-y-3">
          {[
            { tier: 'HOT', value: forecast.hotValue, color: 'bg-red-500', textColor: 'text-red-300' },
            { tier: 'WARM', value: forecast.warmValue, color: 'bg-amber-500', textColor: 'text-amber-300' },
            { tier: 'COOL', value: forecast.coolValue, color: 'bg-sky-500', textColor: 'text-sky-300' },
          ].map((row) => {
            const total = forecast.hotValue + forecast.warmValue + forecast.coolValue
            const pct = total > 0 ? Math.round((row.value / total) * 100) : 0
            return (
              <div key={row.tier} className="flex items-center gap-3">
                <span className={`w-16 text-xs font-semibold ${row.textColor}`}>{row.tier}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={`h-full rounded-full ${row.color} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-20 text-right text-sm font-mono text-zinc-300">
                  {formatGbp(row.value)}
                </span>
                <span className="w-10 text-right text-xs text-zinc-500">
                  {pct}%
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
