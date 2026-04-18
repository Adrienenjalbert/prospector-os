'use client'

import { FunnelWaterfall } from '@/components/analytics/funnel-waterfall'
import { BenchmarkBar } from '@/components/analytics/benchmark-bar'

interface StageBenchmark {
  stage: string
  repConvRate: number
  benchConvRate: number
  repVelocityDays: number
  benchVelocityDays: number
  repDropRate: number
  benchDropRate: number
  entered: number
  converted: number
  dropped: number
  status: 'CRITICAL' | 'MONITOR' | 'OPPORTUNITY' | 'HEALTHY'
}

interface MyFunnelDashboardProps {
  stages: StageBenchmark[]
}

export function MyFunnelDashboard({ stages }: MyFunnelDashboardProps) {
  const waterfallStages = stages.map((s) => ({
    name: s.stage,
    entered: s.entered,
    converted: s.converted,
    dropped: s.dropped,
    conversionRate: s.repConvRate,
    dropRate: s.repDropRate,
    benchmarkConvRate: s.benchConvRate,
    status: s.status,
  }))

  return (
    <div className="space-y-6">
      {/* Funnel Waterfall */}
      <FunnelWaterfall stages={waterfallStages} />

      {/* Benchmark Comparison */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
        <h3 className="text-sm font-semibold text-zinc-200 mb-4">Rep vs Company Benchmark</h3>

        {stages.map((s) => (
          <div key={s.stage} className="mb-5 last:mb-0">
            <p className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">{s.stage}</p>
            <div className="space-y-2">
              <BenchmarkBar
                label="Conversion"
                repValue={s.repConvRate}
                benchmarkValue={s.benchConvRate}
                delta={s.repConvRate - s.benchConvRate}
                format="percent"
                isHigherBetter={true}
              />
              <BenchmarkBar
                label="Velocity"
                repValue={s.repVelocityDays}
                benchmarkValue={s.benchVelocityDays}
                delta={s.repVelocityDays - s.benchVelocityDays}
                format="days"
                isHigherBetter={false}
              />
              <BenchmarkBar
                label="Drop Rate"
                repValue={s.repDropRate}
                benchmarkValue={s.benchDropRate}
                delta={s.repDropRate - s.benchDropRate}
                format="percent"
                isHigherBetter={false}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
