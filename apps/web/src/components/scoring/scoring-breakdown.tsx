import { cn, formatGbp } from "@/lib/utils"

export interface ScoringBreakdownProps {
  expectedRevenue: number
  dealValue: number
  winLikelihood: number
  subScores: {
    name: string
    score: number
  }[]
}

function scoreBarColor(score: number): string {
  if (score > 70) return "bg-emerald-500"
  if (score >= 40) return "bg-amber-500"
  return "bg-red-500"
}

function scoreLabel(score: number): string {
  if (score > 70) return "Strong"
  if (score >= 40) return "Average"
  return "Weak"
}

export function ScoringBreakdown({
  expectedRevenue,
  dealValue,
  winLikelihood,
  subScores,
}: ScoringBreakdownProps) {
  return (
    <div className="rounded-xl border border-zinc-700/80 bg-zinc-800 p-6 text-zinc-100 shadow-sm">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div className="space-y-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Expected revenue
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight text-zinc-50 sm:text-4xl">
              {formatGbp(expectedRevenue)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Win likelihood
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight text-zinc-50 sm:text-4xl">
              {winLikelihood.toFixed(1)}
              <span className="text-2xl text-zinc-400">%</span>
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Deal value
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight text-zinc-50 sm:text-4xl">
              {formatGbp(dealValue)}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <p className="text-sm font-medium text-zinc-300">Score breakdown</p>
          <ul className="space-y-3">
            {subScores.map((row) => {
              const width = Math.min(100, Math.max(0, row.score))
              return (
                <li key={row.name} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium text-zinc-200">{row.name}</span>
                    <span className="shrink-0 font-mono tabular-nums text-zinc-400">
                      <span className="text-zinc-100">{row.score.toFixed(0)}</span>
                      <span className="text-zinc-500"> / 100</span>
                      <span className={cn(
                        "ml-2 text-xs font-medium",
                        row.score > 70 && "text-emerald-400",
                        row.score >= 40 && row.score <= 70 && "text-amber-400",
                        row.score < 40 && "text-red-400",
                      )}>
                        {scoreLabel(row.score)}
                      </span>
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-900/80 ring-1 ring-zinc-700/60">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-300 ease-out",
                        scoreBarColor(row.score),
                      )}
                      style={{ width: `${width}%` }}
                      role="progressbar"
                      aria-valuenow={row.score}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${row.name} score ${row.score}`}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
