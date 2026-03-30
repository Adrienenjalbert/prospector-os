'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn, formatGbp } from '@/lib/utils'
import { PipelineBoard } from '@/components/pipeline/pipeline-board'
import { LayoutGrid, List } from 'lucide-react'

interface DealRow {
  id: string
  name: string
  companyName: string | null
  companyId: string | null
  value: number | null
  stage: string
  daysInStage: number
  medianDays: number
  isStalled: boolean
  stallReason: string | null
  probability: number | null
  priorityScore: number | null
  priorityTier: string | null
  contactName: string | null
  expectedRevenue: number
}

interface PipelineClientProps {
  deals: DealRow[]
  stages: string[]
  isDemo: boolean
}

export function PipelineClient({ deals, stages, isDemo }: PipelineClientProps) {
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')
  const [activeStage, setActiveStage] = useState<string | null>(null)

  const displayDeals = activeStage
    ? deals.filter((d) => d.stage === activeStage)
    : deals

  const stageCounts = stages.reduce<Record<string, number>>((acc, stage) => {
    acc[stage] = deals.filter((d) => d.stage === stage).length
    return acc
  }, {})

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Pipeline</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {deals.length} deals · {formatGbp(deals.reduce((s, d) => s + (d.value ?? 0), 0))} total value
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-zinc-800/60 p-1">
          <button
            onClick={() => setViewMode('board')}
            className={cn(
              'rounded-md p-2 transition-colors',
              viewMode === 'board' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            )}
            aria-label="Board view"
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'rounded-md p-2 transition-colors',
              viewMode === 'list' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            )}
            aria-label="List view"
          >
            <List className="size-4" />
          </button>
        </div>
      </div>

      {isDemo && (
        <div className="mt-4 rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
          <p className="text-sm text-amber-300/80">
            Showing demo pipeline. Connect your CRM to see your real deals.
          </p>
        </div>
      )}

      {viewMode === 'board' ? (
        <div className="mt-6">
          <PipelineBoard
            deals={deals.map((d) => ({
              ...d,
              companyId: d.companyId ?? d.id,
              companyName: d.companyName ?? d.name,
            }))}
            stages={stages}
          />
        </div>
      ) : (
        <>
          {/* Stage Tabs */}
          <div className="mt-6 flex gap-1 overflow-x-auto border-b border-zinc-800 pb-px">
            <button
              onClick={() => setActiveStage(null)}
              className={cn(
                'whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors',
                !activeStage
                  ? 'border-b-2 border-violet-500 text-zinc-50'
                  : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              All ({deals.length})
            </button>
            {stages.map((stage) => (
              <button
                key={stage}
                onClick={() => setActiveStage(stage)}
                className={cn(
                  'whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors',
                  activeStage === stage
                    ? 'border-b-2 border-violet-500 text-zinc-50'
                    : 'text-zinc-500 hover:text-zinc-300'
                )}
              >
                {stage} ({stageCounts[stage] ?? 0})
              </button>
            ))}
          </div>

          {/* Deal List */}
          <div className="mt-4 space-y-2">
            {displayDeals.map((deal) => (
              <Link
                key={deal.id}
                href={deal.companyId ? `/accounts/${deal.companyId}?tab=opportunities` : `/pipeline/${deal.id}`}
                className={cn(
                  'flex items-center justify-between rounded-lg border bg-zinc-900 p-4 transition-colors hover:border-zinc-600',
                  deal.isStalled ? 'border-red-900/50' : 'border-zinc-800'
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-zinc-200 truncate">{deal.companyName ?? deal.name}</p>
                    {deal.isStalled && (
                      <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-xs text-red-300 font-medium">STALLED</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {deal.stage} · {deal.daysInStage}d in stage
                    {deal.medianDays > 0 && <span className="text-zinc-600"> (avg {deal.medianDays})</span>}
                  </p>
                </div>
                <div className="text-right shrink-0 ml-4">
                  {deal.value != null && (
                    <p className="text-sm font-bold font-mono tabular-nums text-zinc-100">
                      {formatGbp(deal.value)}
                    </p>
                  )}
                  {deal.probability != null && (
                    <p className="text-xs text-zinc-500">{deal.probability}%</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
