'use client'

import { SignalTimeline } from '@/components/analytics/signal-timeline'

interface SignalRow {
  id: string
  companyName: string
  signalType: string
  detectedAt: string
  weightedScore: number
  urgency?: string
}

interface SignalsDashboardProps {
  signals: SignalRow[]
}

export function SignalsDashboard({ signals }: SignalsDashboardProps) {
  const timelineSignals = signals.map((s) => ({
    id: s.id,
    companyName: s.companyName,
    signalType: s.signalType,
    detectedAt: s.detectedAt,
    weightedScore: s.weightedScore,
  }))

  const typeCounts = new Map<string, number>()
  for (const s of signals) {
    typeCounts.set(s.signalType, (typeCounts.get(s.signalType) ?? 0) + 1)
  }

  const urgencyCounts = {
    immediate: 0,
    this_week: 0,
    this_month: 0,
  }

  for (const s of signals) {
    const u = s.urgency ?? ''
    if (u === 'immediate') urgencyCounts.immediate++
    else if (u === 'this_week') urgencyCounts.this_week++
    else urgencyCounts.this_month++
  }

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
          <p className="text-xs text-zinc-500">Total Signals</p>
          <p className="mt-1 text-xl font-bold font-mono tabular-nums text-zinc-100">{signals.length}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
          <p className="text-xs text-zinc-500">Immediate</p>
          <p className="mt-1 text-xl font-bold font-mono tabular-nums text-red-400">{urgencyCounts.immediate}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
          <p className="text-xs text-zinc-500">This Week</p>
          <p className="mt-1 text-xl font-bold font-mono tabular-nums text-amber-400">{urgencyCounts.this_week}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
          <p className="text-xs text-zinc-500">Signal Types</p>
          <p className="mt-1 text-xl font-bold font-mono tabular-nums text-sky-400">{typeCounts.size}</p>
        </div>
      </div>

      <SignalTimeline signals={timelineSignals} />
    </div>
  )
}
