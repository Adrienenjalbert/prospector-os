'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatGbp } from '@/lib/utils'
import { clsx } from 'clsx'
import { PipelineFunnelChart, type StageMetric } from './pipeline-funnel-chart'
import { StageRecoCard } from './stage-reco-card'
import { SortControl } from '@/components/shared/sort-control'
import { SkillBar } from '@/components/agent/skill-bar'
import { PIPELINE_SKILLS } from '@/lib/agent/skills'
import { sortCompanies, type SortField } from '@/lib/sort-companies'

interface Deal {
  id: string
  name: string
  companyName: string | null
  companyId: string | null
  companyPropensity: number
  companyIcpTier: string | null
  value: number | null
  stage: string
  daysInStage: number
  isStalled: boolean
  stallReason: string | null
  contactName: string | null
}

interface KPIs {
  totalPipeline: number
  dealCount: number
  stallCount: number
  winRate: string
  avgCycleDays: number
  weightedRevenue: number
}

interface PipelineClientProps {
  deals: Deal[]
  stageMetrics: StageMetric[]
  kpis: KPIs
  isDemo: boolean
}

const PIPELINE_SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: 'priority', label: 'Priority' },
  { field: 'revenue', label: 'Value' },
  { field: 'days', label: 'Days in Stage' },
]

export function PipelineClient({ deals, stageMetrics, kpis, isDemo }: PipelineClientProps) {
  const firstStage = stageMetrics[0]?.stage ?? 'Lead'
  const [activeStage, setActiveStage] = useState(firstStage)
  const [sortField, setSortField] = useState<SortField>('priority')

  const filteredDeals = useMemo(() => {
    const inStage = deals.filter((d) => d.stage === activeStage)
    return sortCompanies(
      inStage.map((d) => ({ ...d, propensity: d.companyPropensity })),
      sortField,
    )
  }, [deals, activeStage, sortField])

  const activeMetric = stageMetrics.find((s) => s.stage === activeStage)

  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8">
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
              Pipeline & Funnel
            </h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              {kpis.dealCount} deals · {formatGbp(kpis.totalPipeline)} total pipeline
            </p>
          </div>
          <SkillBar skills={PIPELINE_SKILLS} pageContext={{ page: 'pipeline' }} />
        </div>

        {isDemo && (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
            <p className="text-sm text-amber-300/80">
              Showing demo data. Connect your CRM to see your live pipeline and funnel health.
            </p>
          </div>
        )}

        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: 'Pipeline', value: formatGbp(kpis.totalPipeline), color: 'text-zinc-100' },
            { label: 'Win Rate', value: kpis.winRate, color: 'text-emerald-400' },
            { label: 'Stalled', value: `${kpis.stallCount}`, color: kpis.stallCount > 2 ? 'text-red-400' : 'text-zinc-200' },
            { label: 'Avg Cycle', value: `${kpis.avgCycleDays}d`, color: 'text-zinc-200' },
            { label: 'Weighted', value: formatGbp(kpis.weightedRevenue), color: 'text-sky-400' },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
              <p className="text-xs text-zinc-500">{m.label}</p>
              <p className={`mt-1 text-xl font-bold font-mono tabular-nums ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* Funnel Chart */}
        <PipelineFunnelChart
          stages={stageMetrics}
          activeStage={activeStage}
          onStageClick={setActiveStage}
        />

        {/* Stage Recommendation Card */}
        {activeMetric && (
          <StageRecoCard
            metric={activeMetric}
            topDeals={filteredDeals.slice(0, 5).map((d) => ({
              id: d.id,
              name: d.name,
              companyName: d.companyName ?? 'Unknown',
              companyId: d.companyId ?? '',
              value: d.value,
              daysInStage: d.daysInStage,
              isStalled: d.isStalled,
              contactName: d.contactName,
            }))}
          />
        )}

        {/* Deal Cards */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">
              {activeStage} Deals
              <span className="ml-1.5 text-zinc-500 font-normal">({filteredDeals.length})</span>
            </h2>
            <SortControl options={PIPELINE_SORT_OPTIONS} active={sortField} onChange={setSortField} />
          </div>

          {filteredDeals.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 px-6 py-16 text-center">
              <p className="text-base font-medium text-zinc-300">
                No deals in {activeStage}
              </p>
              <p className="max-w-sm text-sm leading-relaxed text-zinc-500">
                Click another stage in the funnel chart above.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredDeals.map((deal) => (
                <Link
                  key={deal.id}
                  href={deal.companyId ? `/accounts/${deal.companyId}` : `/pipeline/${deal.id}`}
                  className="group flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-zinc-100 group-hover:text-violet-300">
                        {deal.name}
                      </h3>
                      {deal.companyName && (
                        <p className="mt-0.5 text-sm text-zinc-400">{deal.companyName}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {deal.isStalled && (
                        <span className="rounded-md border border-rose-800/80 bg-rose-950/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-200">
                          STALLED
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="mt-3 font-mono text-lg font-semibold tabular-nums text-zinc-200">
                    {deal.value != null ? formatGbp(deal.value) : '—'}
                  </p>

                  <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
                    <span>{deal.daysInStage}d in stage</span>
                    {deal.companyPropensity > 0 && (
                      <span className="font-mono text-zinc-400">
                        Priority: {Math.round(deal.companyPropensity)}
                      </span>
                    )}
                    {deal.companyIcpTier && (
                      <span className={clsx(
                        'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                        deal.companyIcpTier === 'A' ? 'bg-emerald-950/60 text-emerald-300' :
                        deal.companyIcpTier === 'B' ? 'bg-teal-950/60 text-teal-300' :
                        'bg-zinc-800 text-zinc-400',
                      )}>
                        ICP {deal.companyIcpTier}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
