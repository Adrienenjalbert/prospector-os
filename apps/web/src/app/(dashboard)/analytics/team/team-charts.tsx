'use client'

import { RepRadarCompare } from '@/components/analytics/rep-radar-compare'
import { PipelineByRep } from '@/components/analytics/pipeline-by-rep'

interface RepData {
  id: string
  name: string
  closedRevenue: number
  pipelineValue: number
  targetValue: number
  winRate: number
  stallCount: number
  dealCount: number
}

interface TeamChartsProps {
  reps: RepData[]
}

export function TeamCharts({ reps }: TeamChartsProps) {
  const pipelineData = reps.map((r) => ({
    name: r.name.split(' ')[0],
    lead: Math.round(r.pipelineValue * 0.3),
    qualified: Math.round(r.pipelineValue * 0.3),
    proposal: Math.round(r.pipelineValue * 0.25),
    negotiation: Math.round(r.pipelineValue * 0.15),
  }))

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RepRadarCompare reps={reps} />
      <PipelineByRep reps={pipelineData} />
    </div>
  )
}
