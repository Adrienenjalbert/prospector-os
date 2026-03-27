import type { FunnelBenchmark } from '../types/ontology'

export type StageStatus = 'CRITICAL' | 'MONITOR' | 'OPPORTUNITY' | 'HEALTHY'

export interface ImpactScoreResult {
  stage_name: string
  impact_score: number
  delta_drop: number
  deal_count: number
  avg_deal_value: number
  status: StageStatus
}

export function computeImpactScores(
  repBenchmarks: FunnelBenchmark[],
  companyBenchmarks: FunnelBenchmark[],
  highDropThresholdPts: number = 5
): ImpactScoreResult[] {
  return repBenchmarks.map((rep) => {
    const company = companyBenchmarks.find((c) => c.stage_name === rep.stage_name)
    const benchDrop = company?.drop_rate ?? 0
    const deltaDrop = rep.drop_rate - benchDrop

    const impactScore = Math.abs(deltaDrop) * rep.deal_count * rep.avg_deal_value

    const medianDealCount = company?.deal_count ?? 1
    const isHighVolume = rep.deal_count >= medianDealCount
    const isHighDrop = deltaDrop >= highDropThresholdPts

    let status: StageStatus
    if (isHighDrop && isHighVolume) status = 'CRITICAL'
    else if (isHighDrop && !isHighVolume) status = 'MONITOR'
    else if (!isHighDrop && isHighVolume) status = 'OPPORTUNITY'
    else status = 'HEALTHY'

    return {
      stage_name: rep.stage_name,
      impact_score: Math.round(impactScore),
      delta_drop: Math.round(deltaDrop * 100) / 100,
      deal_count: rep.deal_count,
      avg_deal_value: rep.avg_deal_value,
      status,
    }
  }).sort((a, b) => b.impact_score - a.impact_score)
}
