import type { Opportunity, FunnelBenchmark } from '../types/ontology'
import type { VelocityTier } from '../types/config'
import type { ScoringResult } from '../types/scoring'

export interface VelocityScorerInput {
  opportunity: Opportunity | null
  benchmarks: FunnelBenchmark[]
  total_active_stages: number
}

export function computeStageVelocity(
  input: VelocityScorerInput,
  velocityTiers: VelocityTier[]
): ScoringResult {
  const { opportunity, benchmarks, total_active_stages } = input

  if (!opportunity || opportunity.is_closed) {
    return neutralResult()
  }

  const progress = computeProgress(opportunity.stage_order, total_active_stages)
  const speedVsBenchmark = computeSpeedVsBenchmark(opportunity, benchmarks, velocityTiers)
  const momentum = computeMomentum(opportunity)

  const score = Math.round(
    progress * 0.30 + speedVsBenchmark * 0.40 + momentum * 0.30
  )
  const clamped = Math.max(0, Math.min(100, score))

  return {
    score: clamped,
    dimensions: [
      { name: 'stage_progress', score: progress, weight: 0.30, weighted_score: progress * 0.30, label: `Stage ${opportunity.stage_order}/${total_active_stages}` },
      { name: 'speed_vs_benchmark', score: speedVsBenchmark, weight: 0.40, weighted_score: speedVsBenchmark * 0.40, label: speedLabel(speedVsBenchmark) },
      { name: 'momentum_direction', score: momentum, weight: 0.30, weighted_score: momentum * 0.30, label: momentumLabel(momentum) },
    ],
    top_reason: opportunity.is_stalled
      ? `Stalled at ${opportunity.stage} for ${opportunity.days_in_stage} days`
      : `${opportunity.stage} — ${opportunity.days_in_stage} days`,
    computed_at: new Date().toISOString(),
    config_version: '',
  }
}

function neutralResult(): ScoringResult {
  return {
    score: 0,
    dimensions: [
      { name: 'stage_progress', score: 0, weight: 0.30, weighted_score: 0, label: 'No deal' },
      { name: 'speed_vs_benchmark', score: 0, weight: 0.40, weighted_score: 0, label: 'N/A' },
      { name: 'momentum_direction', score: 0, weight: 0.30, weighted_score: 0, label: 'N/A' },
    ],
    top_reason: 'No active opportunity',
    computed_at: new Date().toISOString(),
    config_version: '',
  }
}

function computeProgress(stageOrder: number, totalStages: number): number {
  if (totalStages <= 0) return 0
  return Math.round((stageOrder / totalStages) * 100)
}

function computeSpeedVsBenchmark(
  opp: Opportunity,
  benchmarks: FunnelBenchmark[],
  tiers: VelocityTier[]
): number {
  const bench = benchmarks.find((b) => b.stage_name === opp.stage)
  if (!bench || !bench.median_days_in_stage || bench.median_days_in_stage <= 0) {
    return 50
  }

  const ratio = bench.median_days_in_stage / Math.max(1, opp.days_in_stage)

  const sorted = [...tiers].sort((a, b) => b.min_ratio - a.min_ratio)
  for (const tier of sorted) {
    if (ratio >= tier.min_ratio) return tier.score
  }
  return 10
}

function computeMomentum(opp: Opportunity): number {
  const stageEnteredDaysAgo = opp.stage_entered_at
    ? Math.floor((Date.now() - new Date(opp.stage_entered_at).getTime()) / (1000 * 60 * 60 * 24))
    : opp.days_in_stage

  if (stageEnteredDaysAgo <= 7) return 95

  const hasRecentActivity = opp.next_best_action != null
  if (hasRecentActivity && !opp.is_stalled) return 70

  if (opp.is_stalled) return 10

  return 50
}

function speedLabel(s: number): string {
  if (s >= 85) return 'Above median'
  if (s >= 70) return 'On pace'
  if (s >= 50) return 'Slightly slow'
  if (s >= 30) return 'Significantly slow'
  return 'Stalled territory'
}

function momentumLabel(s: number): string {
  if (s >= 80) return 'Just progressed'
  if (s >= 60) return 'On track'
  if (s >= 40) return 'Needs push'
  return 'Stalled'
}
