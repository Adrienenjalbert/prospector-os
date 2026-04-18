'use client'

import { cn } from '@/lib/utils'

interface StallHeatmapProps {
  stages: string[]
  weeks: string[]
  data: { stage: string; week: string; count: number }[]
}

function getIntensityClass(count: number, max: number): string {
  if (count === 0) return 'bg-zinc-900'
  const ratio = count / Math.max(max, 1)
  if (ratio >= 0.75) return 'bg-red-500/80'
  if (ratio >= 0.5) return 'bg-red-500/50'
  if (ratio >= 0.25) return 'bg-amber-500/40'
  return 'bg-amber-500/20'
}

export function StallHeatmap({ stages, weeks, data }: StallHeatmapProps) {
  const maxCount = Math.max(...data.map((d) => d.count), 1)
  const lookup = new Map(data.map((d) => [`${d.stage}:${d.week}`, d.count]))
  const totalStalls = data.reduce((s, d) => s + d.count, 0)

  const worstStage = stages
    .map((stage) => ({
      stage,
      total: data.filter((d) => d.stage === stage).reduce((s, d) => s + d.count, 0),
    }))
    .sort((a, b) => b.total - a.total)[0]

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-200">Stall Distribution</h3>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          <span>Total: <span className="font-mono text-zinc-300">{totalStalls}</span></span>
          {worstStage && worstStage.total > 0 && (
            <span>Worst: <span className="text-red-400">{worstStage.stage}</span></span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="pb-1 pr-2 text-left text-[10px] font-medium text-zinc-500 w-24" />
              {weeks.map((w) => (
                <th key={w} className="pb-1 px-0.5 text-center text-[10px] font-medium text-zinc-500 whitespace-nowrap">
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => (
              <tr key={stage}>
                <td className="py-0.5 pr-2 text-[10px] font-medium text-zinc-400 truncate">{stage}</td>
                {weeks.map((week) => {
                  const count = lookup.get(`${stage}:${week}`) ?? 0
                  return (
                    <td key={week} className="py-0.5 px-0.5">
                      <div
                        className={cn(
                          'h-7 w-full rounded-sm flex items-center justify-center transition-colors',
                          getIntensityClass(count, maxCount),
                        )}
                        title={`${stage}, ${week}: ${count} stalled deals`}
                      >
                        {count > 0 && (
                          <span className="text-[9px] font-mono font-semibold text-white/80">{count}</span>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-600">
        <span>Fewer</span>
        <div className="flex gap-0.5">
          <span className="inline-block size-3 rounded-sm bg-zinc-900" />
          <span className="inline-block size-3 rounded-sm bg-amber-500/20" />
          <span className="inline-block size-3 rounded-sm bg-amber-500/40" />
          <span className="inline-block size-3 rounded-sm bg-red-500/50" />
          <span className="inline-block size-3 rounded-sm bg-red-500/80" />
        </div>
        <span>More stalls</span>
      </div>
    </div>
  )
}
