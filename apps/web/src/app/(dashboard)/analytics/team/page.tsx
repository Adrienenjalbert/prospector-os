import { createSupabaseServer } from '@/lib/supabase/server'
import { formatGbp } from '@/lib/utils'
import { RepLeaderboard } from '@/components/analytics/rep-leaderboard'
import { CoachingCard } from '@/components/analytics/coaching-card'
import { TeamCharts } from './team-charts'

const DEMO_REPS = [
  { id: 'r1', name: 'Sarah Johnson', closedRevenue: 485_000, pipelineValue: 890_000, targetValue: 500_000, winRate: 68, stallCount: 1, dealCount: 8 },
  { id: 'r2', name: 'Mike Chen', closedRevenue: 425_000, pipelineValue: 720_000, targetValue: 500_000, winRate: 62, stallCount: 2, dealCount: 6 },
  { id: 'r3', name: 'Emma Davis', closedRevenue: 375_000, pipelineValue: 650_000, targetValue: 500_000, winRate: 58, stallCount: 0, dealCount: 7 },
  { id: 'r4', name: 'Alex Rodriguez', closedRevenue: 180_000, pipelineValue: 420_000, targetValue: 500_000, winRate: 45, stallCount: 3, dealCount: 5 },
  { id: 'r5', name: 'Jordan Kim', closedRevenue: 145_000, pipelineValue: 380_000, targetValue: 500_000, winRate: 38, stallCount: 4, dealCount: 4 },
]

const DEMO_COACHING = [
  {
    repName: 'Alex Rodriguez',
    issue: '3 proposals stalled > 20 days',
    context: 'Alex has 3 deals at Proposal stage that have been stalled for 20+ days. The team median for this stage is 14 days. Total value at risk: £520K.',
    suggestion: 'Alex may need help overcoming procurement objections. Consider a joint call with a senior stakeholder or offer a business case template.',
    severity: 'critical' as const,
    metric: '20+ days at Proposal',
    benchmark: 'Team avg: 14 days',
  },
  {
    repName: 'Jordan Kim',
    issue: 'Low win rate (38% vs team 62%)',
    context: 'Jordan\'s win rate is 24 points below the team average. The main pattern: deals are single-threaded with only 1 contact per account.',
    suggestion: 'Focus coaching on multi-threading — help Jordan identify and engage 2-3 additional stakeholders per deal before Proposal stage.',
    severity: 'high' as const,
    metric: '38% win rate',
    benchmark: 'Team avg: 62%',
  },
]

export default async function TeamPage() {
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
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Team</h1>
        <p className="mt-4 text-zinc-500">
          Team performance is available for managers and above.
        </p>
      </div>
    )
  }

  const totalClosed = DEMO_REPS.reduce((s, r) => s + r.closedRevenue, 0)
  const totalTarget = DEMO_REPS.reduce((s, r) => s + r.targetValue, 0)
  const totalPipeline = DEMO_REPS.reduce((s, r) => s + r.pipelineValue, 0)
  const totalStalls = DEMO_REPS.reduce((s, r) => s + r.stallCount, 0)
  const attainmentPct = totalTarget > 0 ? Math.round((totalClosed / totalTarget) * 100) : 0

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Team Performance</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {DEMO_REPS.length} reps · Q3 2026
        </p>
      </div>

      <div className="mt-4 rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
        <p className="text-sm text-amber-300/80">
          Showing demo team data. Connect your CRM to see real team performance.
        </p>
      </div>

      {/* Attainment Bar */}
      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Team Attainment</p>
            <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-zinc-50">
              {attainmentPct}%
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="text-zinc-400">
              <span className="font-mono text-emerald-400">{formatGbp(totalClosed)}</span> / {formatGbp(totalTarget)}
            </p>
            <p className="text-xs text-zinc-500">Pipeline: {formatGbp(totalPipeline)}</p>
          </div>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all"
            style={{ width: `${Math.min(attainmentPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Key Metrics */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Avg Win Rate', value: `${Math.round(DEMO_REPS.reduce((s, r) => s + r.winRate, 0) / DEMO_REPS.length)}%`, color: 'text-emerald-400' },
          { label: 'Active Stalls', value: `${totalStalls}`, color: totalStalls > 5 ? 'text-red-400' : 'text-zinc-200' },
          { label: 'Total Deals', value: `${DEMO_REPS.reduce((s, r) => s + r.dealCount, 0)}`, color: 'text-zinc-200' },
          { label: 'Reps On Track', value: `${DEMO_REPS.filter(r => (r.closedRevenue / r.targetValue) >= 0.5).length}/${DEMO_REPS.length}`, color: 'text-sky-400' },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
            <p className="text-xs text-zinc-500">{m.label}</p>
            <p className={`mt-1 text-xl font-bold font-mono tabular-nums ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Rep Radar + Pipeline by Rep */}
      <div className="mt-6">
        <TeamCharts reps={DEMO_REPS} />
      </div>

      {/* Rep Leaderboard */}
      <div className="mt-6">
        <RepLeaderboard reps={DEMO_REPS} />
      </div>

      {/* Coaching Opportunities */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-200 mb-3">Needs Attention</h2>
        <div className="space-y-3">
          {DEMO_COACHING.map((coaching, i) => (
            <CoachingCard key={i} {...coaching} />
          ))}
        </div>
      </div>
    </div>
  )
}
