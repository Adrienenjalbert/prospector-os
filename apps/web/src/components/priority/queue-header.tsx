import { formatGbp } from '@/lib/utils'

export interface PipelineStage {
  name: string
  count: number
  value: number
  stallCount: number
}

export interface QueueHeaderProps {
  repName: string
  actionCount: number
  pipelineStages?: PipelineStage[]
  totalPipelineValue?: number
  targetValue?: number
}

export function QueueHeader({
  repName,
  actionCount,
  pipelineStages,
  totalPipelineValue,
  targetValue,
}: QueueHeaderProps) {
  const firstName = repName.split(' ')[0] || 'there'
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const targetPct = targetValue && totalPipelineValue
    ? Math.round((totalPipelineValue / targetValue) * 100)
    : null

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
        {greeting}, {firstName}.
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        You have {actionCount} {actionCount === 1 ? 'action' : 'actions'} today.
        {totalPipelineValue != null && (
          <span className="ml-1">
            Pipeline: <span className="font-mono text-zinc-300">{formatGbp(totalPipelineValue)}</span>
            {targetPct != null && (
              <span className="text-zinc-600"> ({targetPct}% of target)</span>
            )}
          </span>
        )}
      </p>

      {pipelineStages && pipelineStages.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1 text-xs">
          {pipelineStages.map((stage, i) => (
            <span key={stage.name} className="flex items-center gap-1">
              {i > 0 && <span className="text-zinc-700 mx-0.5">▸</span>}
              <span className="text-zinc-400">{stage.name}</span>
              <span className="font-mono text-zinc-300">({stage.count})</span>
              {stage.stallCount > 0 && (
                <span className="text-red-400" title={`${stage.stallCount} stalled`}>
                  ⚠{stage.stallCount}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
        <span><span aria-hidden>🔴</span> Stalled deal</span>
        <span><span aria-hidden>🟡</span> Signal detected</span>
        <span><span aria-hidden>🟢</span> Prospecting target</span>
        <span><span aria-hidden>🔵</span> Pipeline deal</span>
      </div>
    </div>
  )
}
