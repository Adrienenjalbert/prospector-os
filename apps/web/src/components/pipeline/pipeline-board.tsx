'use client'

import { formatGbp } from '@/lib/utils'
import { DealCard } from './deal-card'

interface Deal {
  id: string
  companyName: string
  companyId: string
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

interface PipelineBoardProps {
  deals: Deal[]
  stages: string[]
}

export function PipelineBoard({ deals, stages }: PipelineBoardProps) {
  const columns = stages.map((stageName) => {
    const stageDeals = deals
      .filter((d) => d.stage === stageName)
      .sort((a, b) => (b.expectedRevenue ?? 0) - (a.expectedRevenue ?? 0))

    const totalValue = stageDeals.reduce((s, d) => s + (d.value ?? 0), 0)
    const stallCount = stageDeals.filter((d) => d.isStalled).length

    return { name: stageName, deals: stageDeals, totalValue, stallCount }
  })

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => (
        <div key={col.name} className="flex w-72 shrink-0 flex-col">
          {/* Column Header */}
          <div className="mb-3 rounded-lg bg-zinc-800/50 px-3 py-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200">{col.name}</h3>
              <span className="text-xs text-zinc-500">{col.deals.length}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
              <span className="font-mono">{formatGbp(col.totalValue)}</span>
              {col.stallCount > 0 && (
                <span className="text-red-400">⚠ {col.stallCount} stalled</span>
              )}
            </div>
          </div>

          {/* Deal Cards */}
          <div className="flex flex-col gap-2">
            {col.deals.map((deal) => (
              <DealCard key={deal.id} {...deal} />
            ))}
            {col.deals.length === 0 && (
              <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-600">
                No deals
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
