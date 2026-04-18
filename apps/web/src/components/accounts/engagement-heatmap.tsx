'use client'

import { cn } from '@/lib/utils'

interface AccountEngagement {
  id: string
  name: string
  lastTouchDaysAgo: number
  touchCount: number
  priorityTier: string | null
}

interface EngagementHeatmapProps {
  accounts: AccountEngagement[]
}

function getRecencyClass(daysAgo: number): string {
  if (daysAgo <= 3) return 'bg-emerald-500/70'
  if (daysAgo <= 7) return 'bg-emerald-500/40'
  if (daysAgo <= 14) return 'bg-sky-500/40'
  if (daysAgo <= 30) return 'bg-amber-500/40'
  if (daysAgo <= 60) return 'bg-red-500/40'
  return 'bg-red-500/70'
}

function getRecencyLabel(daysAgo: number): string {
  if (daysAgo <= 3) return 'Active'
  if (daysAgo <= 7) return 'Recent'
  if (daysAgo <= 14) return 'This week'
  if (daysAgo <= 30) return 'Cooling'
  if (daysAgo <= 60) return 'At risk'
  return 'Going dark'
}

export function EngagementHeatmap({ accounts }: EngagementHeatmapProps) {
  if (accounts.length === 0) return null

  const sorted = [...accounts].sort((a, b) => a.lastTouchDaysAgo - b.lastTouchDaysAgo)
  const atRiskCount = accounts.filter((a) => a.lastTouchDaysAgo > 30).length
  const activeCount = accounts.filter((a) => a.lastTouchDaysAgo <= 7).length

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-200">Engagement Recency</h3>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          <span>Active (7d): <span className="font-mono text-emerald-400">{activeCount}</span></span>
          <span>At risk (30d+): <span className="font-mono text-red-400">{atRiskCount}</span></span>
        </div>
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1">
        {sorted.map((a) => (
          <div
            key={a.id}
            className={cn(
              'rounded-md p-1.5 text-center cursor-default transition-all hover:ring-1 hover:ring-zinc-600',
              getRecencyClass(a.lastTouchDaysAgo),
            )}
            title={`${a.name}: ${a.lastTouchDaysAgo}d ago, ${a.touchCount} touches, ${getRecencyLabel(a.lastTouchDaysAgo)}`}
          >
            <p className="text-[8px] font-medium text-white/90 truncate leading-tight">{a.name.split(' ')[0]}</p>
            <p className="text-[9px] font-mono text-white/70">{a.lastTouchDaysAgo}d</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[10px] text-zinc-600">
        <span>Recent</span>
        <div className="flex gap-0.5">
          <span className="inline-block size-3 rounded-sm bg-emerald-500/70" />
          <span className="inline-block size-3 rounded-sm bg-emerald-500/40" />
          <span className="inline-block size-3 rounded-sm bg-sky-500/40" />
          <span className="inline-block size-3 rounded-sm bg-amber-500/40" />
          <span className="inline-block size-3 rounded-sm bg-red-500/40" />
          <span className="inline-block size-3 rounded-sm bg-red-500/70" />
        </div>
        <span>Going dark</span>
      </div>
    </div>
  )
}
