import { cn, formatGbp } from '@/lib/utils'

interface RepRow {
  id: string
  name: string
  closedRevenue: number
  pipelineValue: number
  targetValue: number
  winRate: number
  stallCount: number
  dealCount: number
}

interface RepLeaderboardProps {
  reps: RepRow[]
}

export function RepLeaderboard({ reps }: RepLeaderboardProps) {
  const sorted = [...reps].sort((a, b) => b.closedRevenue - a.closedRevenue)

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h3 className="text-sm font-semibold text-zinc-200">Rep Performance</h3>
      <div className="mt-4 space-y-3">
        {sorted.map((rep, i) => {
          const pct = rep.targetValue > 0 ? Math.round((rep.closedRevenue / rep.targetValue) * 100) : 0
          const color = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
          const textColor = pct >= 75 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400'

          return (
            <div key={rep.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-5 text-xs text-zinc-600 text-right font-mono">{i + 1}.</span>
                  <span className="text-sm font-medium text-zinc-200 truncate">{rep.name}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs">
                  <span className="font-mono text-zinc-300">{formatGbp(rep.closedRevenue)}</span>
                  <span className={cn('font-semibold font-mono', textColor)}>{pct}%</span>
                </div>
              </div>
              <div className="ml-7 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={cn('h-full rounded-full transition-all', color)}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <div className="ml-7 flex items-center gap-3 text-xs text-zinc-600">
                <span>Pipeline: {formatGbp(rep.pipelineValue)}</span>
                <span>Win: {rep.winRate}%</span>
                <span>{rep.dealCount} deals</span>
                {rep.stallCount > 0 && (
                  <span className="text-red-400">⚠ {rep.stallCount} stalls</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
