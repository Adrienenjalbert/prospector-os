import type { Opportunity, FunnelBenchmark, BenchmarkScope } from '../types/ontology'
import type { FunnelConfig } from '../types/config'

export interface BenchmarkInput {
  opportunities: Opportunity[]
  scope: BenchmarkScope
  scope_id: string
  period: string
  stages: string[]
}

export function computeBenchmarks(input: BenchmarkInput): Omit<FunnelBenchmark, 'id' | 'tenant_id' | 'computed_at'>[] {
  const { opportunities, scope, scope_id, period, stages } = input

  const closedOrActive = opportunities.filter(
    (o) => o.stage_order > 0
  )

  return stages.map((stageName) => {
    const atStage = closedOrActive.filter((o) => o.stage === stageName || stageReached(o, stageName, stages))
    const advanced = atStage.filter((o) => stageAdvanced(o, stageName, stages))
    const dropped = atStage.filter((o) => !stageAdvanced(o, stageName, stages) && o.is_closed && !o.is_won)

    const dealCount = atStage.length
    const totalValue = atStage.reduce((s, o) => s + (o.value ?? 0), 0)
    const avgDealValue = dealCount > 0 ? totalValue / dealCount : 0

    const conversionRate = dealCount > 0 ? (advanced.length / dealCount) * 100 : 0
    const dropRate = dealCount > 0 ? (dropped.length / dealCount) * 100 : 0

    const daysValues = atStage
      .filter((o) => o.days_in_stage > 0)
      .map((o) => o.days_in_stage)
    const avgDays = daysValues.length > 0
      ? daysValues.reduce((a, b) => a + b, 0) / daysValues.length
      : 0
    const medianDays = median(daysValues)

    const stalledAtStage = atStage.filter((o) => o.is_stalled && o.stage === stageName)

    return {
      stage_name: stageName,
      period,
      scope,
      scope_id,
      conversion_rate: round(conversionRate),
      drop_rate: round(dropRate),
      deal_count: dealCount,
      total_value: round(totalValue),
      avg_deal_value: round(avgDealValue),
      avg_days_in_stage: round(avgDays),
      median_days_in_stage: round(medianDays),
      impact_score: 0,
      stall_count: stalledAtStage.length,
      stall_value: stalledAtStage.reduce((s, o) => s + (o.value ?? 0), 0),
    }
  })
}

function stageReached(opp: Opportunity, stage: string, stageOrder: string[]): boolean {
  const targetIdx = stageOrder.indexOf(stage)
  const currentIdx = stageOrder.indexOf(opp.stage)
  return currentIdx >= targetIdx
}

function stageAdvanced(opp: Opportunity, stage: string, stageOrder: string[]): boolean {
  const targetIdx = stageOrder.indexOf(stage)
  const currentIdx = stageOrder.indexOf(opp.stage)
  return currentIdx > targetIdx || (opp.is_won && currentIdx >= targetIdx)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
