'use client'

import { useMemo, useState } from 'react'
import { SignalCard } from '@/components/signals/signal-card'
import { SignalCharts } from '@/components/signals/signal-charts'
import { clsx } from 'clsx'

interface SignalRow {
  id: string
  companyId: string
  companyName: string
  signalType: string
  title: string
  description: string | null
  urgency: string
  relevanceScore: number
  weightedScore: number
  recommendedAction: string | null
  detectedAt: string
  source: string
}

interface SignalsFeedProps {
  signals: SignalRow[]
}

const URGENCY_OPTIONS = ['all', 'immediate', 'this_week', 'this_month'] as const
const URGENCY_LABELS: Record<string, string> = {
  all: 'All',
  immediate: 'Immediate',
  this_week: 'This Week',
  this_month: 'This Month',
}

export function SignalsFeed({ signals }: SignalsFeedProps) {
  const [urgencyFilter, setUrgencyFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const signalTypes = useMemo(() => {
    const types = new Set(signals.map((s) => s.signalType))
    return ['all', ...Array.from(types)]
  }, [signals])

  const filtered = useMemo(() => {
    return signals.filter((s) => {
      if (urgencyFilter !== 'all' && s.urgency !== urgencyFilter) return false
      if (typeFilter !== 'all' && s.signalType !== typeFilter) return false
      return true
    })
  }, [signals, urgencyFilter, typeFilter])

  const immediateCnt = signals.filter((s) => s.urgency === 'immediate').length
  const thisWeekCnt = signals.filter((s) => s.urgency === 'this_week').length
  const sources = new Set(signals.map((s) => s.source)).size

  function handleDraftOutreach(companyName: string, signalTitle: string) {
    const prompt = `Draft an outreach email referencing this signal at ${companyName}: "${signalTitle}". Use the latest account context and my outreach tone.`
    window.dispatchEvent(
      new CustomEvent('prospector:open-chat', { detail: { prompt } })
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Total', value: `${signals.length}`, color: 'text-zinc-100' },
          { label: 'Immediate', value: `${immediateCnt}`, color: immediateCnt > 0 ? 'text-red-400' : 'text-zinc-400' },
          { label: 'This Week', value: `${thisWeekCnt}`, color: thisWeekCnt > 0 ? 'text-amber-400' : 'text-zinc-400' },
          { label: 'Sources', value: `${sources}`, color: 'text-zinc-200' },
          { label: 'Showing', value: `${filtered.length}`, color: 'text-violet-400' },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
            <p className="text-xs text-zinc-500">{m.label}</p>
            <p className={`mt-1 text-xl font-bold font-mono tabular-nums ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <SignalCharts signals={signals.map((s) => ({ signalType: s.signalType, detectedAt: s.detectedAt }))} />

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-1">
          <span className="text-xs text-zinc-600 mr-1">Urgency:</span>
          {URGENCY_OPTIONS.map((u) => (
            <button
              key={u}
              onClick={() => setUrgencyFilter(u)}
              className={clsx(
                'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                urgencyFilter === u
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300',
              )}
            >
              {URGENCY_LABELS[u] ?? u}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-zinc-600 mr-1">Type:</span>
          {signalTypes.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={clsx(
                'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                typeFilter === t
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300',
              )}
            >
              {t === 'all' ? 'All' : (t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))}
            </button>
          ))}
        </div>
      </div>

      {/* Signal Cards */}
      <div className="flex flex-col gap-4">
        {filtered.map((signal) => (
          <SignalCard
            key={signal.id}
            id={signal.id}
            companyId={signal.companyId}
            companyName={signal.companyName}
            signalType={signal.signalType}
            title={signal.title}
            description={signal.description}
            urgency={signal.urgency}
            relevanceScore={signal.relevanceScore}
            recommendedAction={signal.recommendedAction}
            detectedAt={signal.detectedAt}
            source={signal.source}
            onDraftOutreach={() => handleDraftOutreach(signal.companyName, signal.title)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-zinc-500">No signals match your filters.</p>
            <button onClick={() => { setUrgencyFilter('all'); setTypeFilter('all') }} className="mt-2 text-sm text-zinc-400 underline hover:text-zinc-200">
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
