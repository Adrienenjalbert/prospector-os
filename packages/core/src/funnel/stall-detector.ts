import type { Opportunity, FunnelBenchmark } from '../types/ontology'
import type { FunnelConfig } from '../types/config'

export interface StallDetectionResult {
  opportunity_id: string
  company_id: string
  is_stalled: boolean
  days_in_stage: number
  median_days: number
  stall_multiplier: number
  threshold_days: number
  stall_reason: string | null
  severity: 'warning' | 'critical' | 'none'
}

export function detectStalls(
  opportunities: Opportunity[],
  benchmarks: FunnelBenchmark[],
  config: FunnelConfig
): StallDetectionResult[] {
  const openDeals = opportunities.filter((o) => !o.is_closed)

  return openDeals.map((opp) => {
    const bench = benchmarks.find((b) => b.stage_name === opp.stage)
    const stageConfig = config.stages.find((s) => s.name === opp.stage)

    const medianDays = bench?.median_days_in_stage ?? stageConfig?.expected_velocity_days ?? 14
    const multiplier = stageConfig?.stall_multiplier ?? config.stall_config.default_multiplier
    const thresholdDays = medianDays * multiplier
    const isStalled = opp.days_in_stage > thresholdDays

    const escalationThreshold = medianDays * config.stall_config.escalation_multiplier
    const isCritical = opp.days_in_stage > escalationThreshold

    let stallReason: string | null = null
    if (isStalled) {
      stallReason = buildStallReason(opp, medianDays)
    }

    return {
      opportunity_id: opp.id,
      company_id: opp.company_id,
      is_stalled: isStalled,
      days_in_stage: opp.days_in_stage,
      median_days: medianDays,
      stall_multiplier: multiplier,
      threshold_days: thresholdDays,
      stall_reason: stallReason,
      severity: isCritical ? 'critical' : isStalled ? 'warning' : 'none',
    }
  })
}

function buildStallReason(opp: Opportunity, medianDays: number): string {
  const overBy = Math.round(opp.days_in_stage - medianDays * 1.5)
  const parts: string[] = [
    `${opp.days_in_stage} days at ${opp.stage} (median: ${medianDays})`,
  ]

  if (overBy > medianDays) {
    parts.push('significantly over threshold')
  }

  if (opp.stall_reason) {
    parts.push(opp.stall_reason)
  }

  return parts.join(' — ')
}
