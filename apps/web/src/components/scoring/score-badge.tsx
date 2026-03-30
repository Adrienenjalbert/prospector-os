'use client'

import { cn } from '@/lib/utils'

interface ScoreBadgeProps {
  score: number
  tier?: string | null
  icpTier?: string | null
  size?: 'sm' | 'md'
  tooltipText?: string
}

const TIER_STYLES: Record<string, string> = {
  HOT: 'bg-red-950/60 text-red-300 border-red-800/40',
  WARM: 'bg-amber-950/60 text-amber-300 border-amber-800/40',
  COOL: 'bg-sky-950/60 text-sky-300 border-sky-800/40',
  MONITOR: 'bg-zinc-800 text-zinc-400 border-zinc-700',
}

const ICP_STYLES: Record<string, string> = {
  A: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/40',
  B: 'bg-teal-950/60 text-teal-300 border-teal-800/40',
  C: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  D: 'bg-zinc-800/60 text-zinc-500 border-zinc-700/60',
}

export function ScoreBadge({
  score,
  tier,
  icpTier,
  size = 'sm',
  tooltipText,
}: ScoreBadgeProps) {
  const tierStyle = tier ? TIER_STYLES[tier] ?? TIER_STYLES.MONITOR : null
  const icpStyle = icpTier ? ICP_STYLES[icpTier] ?? ICP_STYLES.D : null

  return (
    <span
      className={cn('inline-flex items-center gap-1.5', size === 'md' && 'gap-2')}
      title={tooltipText}
    >
      <span
        className={cn(
          'inline-flex items-center rounded border font-mono tabular-nums font-semibold',
          size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm',
          tierStyle ?? 'bg-zinc-800 text-zinc-300 border-zinc-700'
        )}
      >
        {Math.round(score)}
        {tier && <span className="ml-1 font-sans font-medium">{tier}</span>}
      </span>
      {icpTier && (
        <span
          className={cn(
            'inline-flex items-center rounded border font-medium',
            size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm',
            icpStyle
          )}
        >
          ICP {icpTier}
        </span>
      )}
    </span>
  )
}
