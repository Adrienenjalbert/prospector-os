import { cn, formatGbp } from '@/lib/utils'

interface PipelineMicroBarStage {
  name: string
  count: number
  value: number
  stallCount: number
}

interface PipelineMicroBarProps {
  stages: PipelineMicroBarStage[]
  showValues?: boolean
}

export function PipelineMicroBar({ stages, showValues = false }: PipelineMicroBarProps) {
  const totalValue = stages.reduce((s, st) => s + st.value, 0)

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      {stages.map((stage, i) => {
        const pct = totalValue > 0 ? (stage.value / totalValue) * 100 : 0
        return (
          <span key={stage.name} className="inline-flex items-center gap-1">
            {i > 0 && <span className="text-zinc-700 mx-0.5">▸</span>}
            <span className="text-zinc-400">{stage.name}</span>
            <span className="font-mono text-zinc-300">({stage.count})</span>
            {showValues && (
              <span className="text-zinc-500 font-mono">{formatGbp(stage.value)}</span>
            )}
            {stage.stallCount > 0 && (
              <span
                className="text-red-400"
                title={`${stage.stallCount} stalled deal${stage.stallCount > 1 ? 's' : ''}`}
              >
                ⚠{stage.stallCount}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}
