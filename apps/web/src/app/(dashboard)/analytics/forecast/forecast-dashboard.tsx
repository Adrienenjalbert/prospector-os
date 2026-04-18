'use client'

import { ForecastTrajectory, DealRiskScatter } from '@/components/analytics/forecast-charts'
import { PipelineVelocityScatter } from '@/components/analytics/pipeline-velocity-scatter'

interface ForecastData {
  target: number
  closed: number
  committed: number
  upside: number
  hotValue: number
  warmValue: number
  coolValue: number
  stallCount: number
}

export interface RiskDeal {
  name: string
  companyName: string
  value: number
  daysStalled: number
  tier: string
}

export interface VelocityDeal {
  name: string
  company: string
  value: number
  daysInStage: number
  stage: string
  tier: 'HOT' | 'WARM' | 'COOL' | 'MONITOR'
  expectedDays: number
}

interface ForecastDashboardProps {
  forecast: ForecastData
  riskDeals?: RiskDeal[]
  velocityDeals?: VelocityDeal[]
}

/**
 * Renders forecast charts. When `riskDeals` / `velocityDeals` are empty, the
 * charts render empty states rather than plausible-but-fake numbers — no demo
 * data in analytics per the v1 plan. Populate from the ontology aggregation
 * cron or leave empty until the data is real.
 */
export function ForecastDashboard({ forecast, riskDeals = [], velocityDeals = [] }: ForecastDashboardProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ForecastTrajectory
          target={forecast.target}
          closed={forecast.closed}
          committed={forecast.committed}
          upside={forecast.upside}
        />
        {riskDeals.length > 0 ? (
          <DealRiskScatter deals={riskDeals} />
        ) : (
          <EmptyChart title="Deal risk" />
        )}
      </div>
      {velocityDeals.length > 0 ? (
        <PipelineVelocityScatter deals={velocityDeals} />
      ) : (
        <EmptyChart title="Pipeline velocity" />
      )}
    </div>
  )
}

function EmptyChart({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-6 text-center text-sm text-zinc-500">
      <div className="font-medium text-zinc-400">{title}</div>
      <div className="mt-1 text-xs">
        No data yet. Rendered once the nightly forecast aggregation runs over real pipeline rows.
      </div>
    </div>
  )
}
