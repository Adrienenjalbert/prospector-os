'use client'

import { ForecastTrajectory, DealRiskScatter } from '@/components/analytics/forecast-charts'

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

interface ForecastDashboardProps {
  forecast: ForecastData
}

export function ForecastDashboard({ forecast }: ForecastDashboardProps) {
  const demoRiskDeals = [
    { name: 'Q2 Temp Staffing', companyName: 'Acme Logistics', value: 800_000, daysStalled: 22, tier: 'HOT' },
    { name: 'Seasonal surge', companyName: 'Echo Foods', value: 120_000, daysStalled: 18, tier: 'WARM' },
    { name: 'Contract renewal', companyName: 'Foxtrot Group', value: 350_000, daysStalled: 12, tier: 'WARM' },
    { name: 'New site staffing', companyName: 'Delta Dist', value: 95_000, daysStalled: 8, tier: 'COOL' },
    { name: 'MSP transition', companyName: 'Golf Industries', value: 500_000, daysStalled: 25, tier: 'HOT' },
    { name: 'Pilot expansion', companyName: 'Hotel Corp', value: 180_000, daysStalled: 5, tier: 'COOL' },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ForecastTrajectory
        target={forecast.target}
        closed={forecast.closed}
        committed={forecast.committed}
        upside={forecast.upside}
      />
      <DealRiskScatter deals={demoRiskDeals} />
    </div>
  )
}
