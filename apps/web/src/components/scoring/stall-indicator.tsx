import { cn } from '@/lib/utils'

interface StallIndicatorProps {
  daysInStage: number
  medianDays: number
  stageName?: string
  stallMultiplier?: number
}

export function StallIndicator({
  daysInStage,
  medianDays,
  stageName,
  stallMultiplier = 1.5,
}: StallIndicatorProps) {
  const threshold = medianDays * stallMultiplier
  const isStalled = daysInStage > threshold
  const isWarning = daysInStage > medianDays && !isStalled
  const ratio = medianDays > 0 ? daysInStage / medianDays : 0

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-mono tabular-nums',
        isStalled ? 'text-red-400' :
        isWarning ? 'text-amber-400' :
        'text-zinc-400'
      )}
      title={
        stageName
          ? `${daysInStage} days at ${stageName} (median: ${medianDays}d, threshold: ${Math.round(threshold)}d)`
          : `${daysInStage} days in stage (median: ${medianDays}d)`
      }
    >
      {isStalled && <span>⚠</span>}
      <span>{daysInStage}d</span>
      <span className="text-zinc-600">(avg {medianDays})</span>
      {isStalled && (
        <span className="font-sans text-red-500 font-medium">
          {ratio.toFixed(1)}x
        </span>
      )}
    </span>
  )
}
