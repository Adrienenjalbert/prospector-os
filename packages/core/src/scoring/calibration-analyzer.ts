import type { PropensityWeights } from '../types/config'

export interface DealOutcomeRecord {
  icp_score_at_entry: number | null
  signal_score_at_entry: number | null
  engagement_score_at_entry: number | null
  contact_coverage_at_entry: number | null
  velocity_at_entry: number | null
  win_rate_at_entry: number | null
  propensity_at_entry: number | null
  outcome: 'won' | 'lost'
}

export interface DimensionAnalysis {
  dimension: string
  won_avg: number
  lost_avg: number
  won_std: number
  lost_std: number
  discrimination: number
  current_weight: number
  proposed_weight: number
  change_pct: number
}

export interface CalibrationResult {
  current_weights: PropensityWeights
  proposed_weights: PropensityWeights
  dimension_analysis: DimensionAnalysis[]
  model_auc: number
  proposed_auc: number
  sample_size: number
  won_count: number
  lost_count: number
  confidence: 'high' | 'medium' | 'low'
}

const DIMENSION_KEYS: (keyof PropensityWeights)[] = [
  'icp_fit',
  'signal_momentum',
  'engagement_depth',
  'contact_coverage',
  'stage_velocity',
  'profile_win_rate',
]

const OUTCOME_FIELD_MAP: Record<keyof PropensityWeights, keyof DealOutcomeRecord> = {
  icp_fit: 'icp_score_at_entry',
  signal_momentum: 'signal_score_at_entry',
  engagement_depth: 'engagement_score_at_entry',
  contact_coverage: 'contact_coverage_at_entry',
  stage_velocity: 'velocity_at_entry',
  profile_win_rate: 'win_rate_at_entry',
}

export function analyzeCalibration(
  outcomes: DealOutcomeRecord[],
  currentWeights: PropensityWeights,
  minSampleSize: number = 30
): CalibrationResult | null {
  const valid = outcomes.filter((o) => o.propensity_at_entry !== null)
  if (valid.length < minSampleSize) return null

  const won = valid.filter((o) => o.outcome === 'won')
  const lost = valid.filter((o) => o.outcome === 'lost')

  if (won.length < 5 || lost.length < 5) return null

  const dimensionAnalysis: DimensionAnalysis[] = DIMENSION_KEYS.map((dim) => {
    const field = OUTCOME_FIELD_MAP[dim]

    const wonScores = won.map((o) => (o[field] as number) ?? 0)
    const lostScores = lost.map((o) => (o[field] as number) ?? 0)

    const wonAvg = mean(wonScores)
    const lostAvg = mean(lostScores)
    const wonStd = stdDev(wonScores)
    const lostStd = stdDev(lostScores)

    const pooledStd = Math.sqrt(
      ((wonStd ** 2 * (wonScores.length - 1)) + (lostStd ** 2 * (lostScores.length - 1))) /
      (wonScores.length + lostScores.length - 2)
    )

    const discrimination = pooledStd > 0 ? (wonAvg - lostAvg) / pooledStd : 0

    return {
      dimension: dim,
      won_avg: round(wonAvg, 2),
      lost_avg: round(lostAvg, 2),
      won_std: round(wonStd, 2),
      lost_std: round(lostStd, 2),
      discrimination: round(discrimination, 3),
      current_weight: currentWeights[dim],
      proposed_weight: 0,
      change_pct: 0,
    }
  })

  const rawDiscriminations = dimensionAnalysis.map((d) => Math.max(0, d.discrimination))
  const totalDiscrimination = rawDiscriminations.reduce((a, b) => a + b, 0)

  if (totalDiscrimination <= 0) {
    const equalWeight = round(1 / DIMENSION_KEYS.length, 3)
    for (const d of dimensionAnalysis) {
      d.proposed_weight = equalWeight
      d.change_pct = round(((equalWeight - d.current_weight) / d.current_weight) * 100, 1)
    }
  } else {
    for (let i = 0; i < dimensionAnalysis.length; i++) {
      const proposed = rawDiscriminations[i] / totalDiscrimination
      dimensionAnalysis[i].proposed_weight = round(proposed, 3)
      const current = dimensionAnalysis[i].current_weight
      dimensionAnalysis[i].change_pct = current > 0
        ? round(((proposed - current) / current) * 100, 1)
        : 0
    }
  }

  normalizeWeights(dimensionAnalysis)

  const proposedWeights: PropensityWeights = {
    icp_fit: 0,
    signal_momentum: 0,
    engagement_depth: 0,
    contact_coverage: 0,
    stage_velocity: 0,
    profile_win_rate: 0,
  }
  for (const d of dimensionAnalysis) {
    proposedWeights[d.dimension as keyof PropensityWeights] = d.proposed_weight
  }

  const currentAuc = computeAUC(valid, currentWeights)
  const proposedAuc = computeAUC(valid, proposedWeights)

  const confidence = valid.length >= 100 ? 'high'
    : valid.length >= 50 ? 'medium'
    : 'low'

  return {
    current_weights: { ...currentWeights },
    proposed_weights: proposedWeights,
    dimension_analysis: dimensionAnalysis,
    model_auc: round(currentAuc, 4),
    proposed_auc: round(proposedAuc, 4),
    sample_size: valid.length,
    won_count: won.length,
    lost_count: lost.length,
    confidence,
  }
}

export function shouldAutoApply(
  result: CalibrationResult,
  maxChangePct: number = 10
): boolean {
  if (result.proposed_auc <= result.model_auc) return false
  if (result.confidence === 'low') return false

  return result.dimension_analysis.every(
    (d) => Math.abs(d.change_pct) <= maxChangePct
  )
}

function computeAUC(
  outcomes: DealOutcomeRecord[],
  weights: PropensityWeights
): number {
  const scored = outcomes.map((o) => {
    const propensity =
      ((o.icp_score_at_entry ?? 0) * weights.icp_fit) +
      ((o.signal_score_at_entry ?? 0) * weights.signal_momentum) +
      ((o.engagement_score_at_entry ?? 0) * weights.engagement_depth) +
      ((o.contact_coverage_at_entry ?? 0) * weights.contact_coverage) +
      ((o.velocity_at_entry ?? 0) * weights.stage_velocity) +
      ((o.win_rate_at_entry ?? 0) * weights.profile_win_rate)

    return { score: propensity, label: o.outcome === 'won' ? 1 : 0 }
  })

  scored.sort((a, b) => b.score - a.score)

  let tp = 0
  let fp = 0
  const totalPositive = scored.filter((s) => s.label === 1).length
  const totalNegative = scored.length - totalPositive

  if (totalPositive === 0 || totalNegative === 0) return 0.5

  let auc = 0
  let prevFpr = 0
  let prevTpr = 0

  for (const item of scored) {
    if (item.label === 1) {
      tp++
    } else {
      fp++
    }

    const tpr = tp / totalPositive
    const fpr = fp / totalNegative

    auc += (fpr - prevFpr) * (tpr + prevTpr) / 2

    prevFpr = fpr
    prevTpr = tpr
  }

  return auc
}

function normalizeWeights(analysis: DimensionAnalysis[]): void {
  const total = analysis.reduce((s, d) => s + d.proposed_weight, 0)
  if (total <= 0) return
  for (const d of analysis) {
    d.proposed_weight = round(d.proposed_weight / total, 3)
  }
  const remainder = round(1 - analysis.reduce((s, d) => s + d.proposed_weight, 0), 3)
  if (remainder !== 0 && analysis.length > 0) {
    analysis[0].proposed_weight = round(analysis[0].proposed_weight + remainder, 3)
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const avg = mean(values)
  const sqDiffs = values.map((v) => (v - avg) ** 2)
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1))
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
