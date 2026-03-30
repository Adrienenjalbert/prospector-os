import { createSupabaseServer } from '@/lib/supabase/server'
import { formatGbp } from '@/lib/utils'

const DEMO_FORECAST = {
  target: 5_000_000,
  closed: 3_900_000,
  committed: 1_800_000,
  upside: 2_400_000,
  hotValue: 1_200_000,
  warmValue: 1_800_000,
  coolValue: 1_200_000,
  dealCount: 42,
  stallCount: 8,
  avgCycleDays: 89,
  winRate: 67,
  icpQualifiedPct: 62,
}

export default async function ForecastPage() {
  let forecast = DEMO_FORECAST
  let isDemo = true
  let userRole = 'rep'

  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      userRole = profile?.role ?? 'rep'
    }
  } catch {
    // fall back
  }

  if (!['manager', 'admin', 'revops'].includes(userRole)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Forecast</h1>
        <p className="mt-4 text-zinc-500">
          The forecast view is available for managers and above.
        </p>
      </div>
    )
  }

  const closedPct = Math.round((forecast.closed / forecast.target) * 100)
  const committedPct = Math.round(((forecast.closed + forecast.committed) / forecast.target) * 100)
  const bestCasePct = Math.round(((forecast.closed + forecast.committed + forecast.upside) / forecast.target) * 100)

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Forecast
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Q3 2026 · Revenue forecast and pipeline health
          </p>
        </div>
      </div>

      {isDemo && (
        <div className="mt-4 rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
          <p className="text-sm text-amber-300/80">
            Showing demo forecast. Connect your CRM to see real data.
          </p>
        </div>
      )}

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

        <div className="mt-6">
          <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-600 via-emerald-500 to-sky-500 transition-all"
              style={{ width: `${Math.min(closedPct, 100)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
            <span>0%</span>
            <span className="text-emerald-400 font-medium">{closedPct}% closed</span>
            <span>100%</span>
          </div>
        </div>
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
