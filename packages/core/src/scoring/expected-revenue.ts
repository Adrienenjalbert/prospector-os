import type { ScoringConfig } from '../types/config'
import type { PriorityTier } from '../types/ontology'
import type { SubScoreSet, UrgencyComponents } from '../types/scoring'

export interface ExpectedRevenueInput {
  deal_value: number
  propensity: number
  urgency_components: UrgencyComponents
  /**
   * The six sub-scores. Optional — when provided, the priority_reason
   * one-liner names the top-3 dimensions driving the score (per the
   * mission's "score AND its reason — top 3 only" promise) instead of
   * just listing urgency triggers. When omitted (legacy callers), the
   * function falls back to the urgency-only message.
   */
  sub_scores?: SubScoreSet
  /**
   * Per-dimension weights from the tenant's `scoring_config`. Required
   * when `sub_scores` is provided so we can rank dimensions by
   * weighted contribution. Without weights we'd be ranking by raw
   * sub-score, which would over-weight high-variance dimensions like
   * signal_momentum vs more stable ones like contact_coverage.
   */
  propensity_weights?: ScoringConfig['propensity_weights']
}

export interface ExpectedRevenueResult {
  expected_revenue: number
  priority_score: number
  urgency_multiplier: number
  priority_tier: PriorityTier
  priority_reason: string
}

// Human-readable labels for sub-score dimensions in the priority reason.
const DIMENSION_LABELS: Record<keyof SubScoreSet, string> = {
  icp_fit: 'ICP fit',
  signal_momentum: 'signal momentum',
  engagement_depth: 'engagement',
  contact_coverage: 'stakeholder coverage',
  stage_velocity: 'stage velocity',
  profile_win_rate: 'win-rate profile',
}

const URGENCY_LABEL_LIMIT = 3

export function computeExpectedRevenue(
  input: ExpectedRevenueInput,
  config: ScoringConfig
): ExpectedRevenueResult {
  const { deal_value, propensity, urgency_components, sub_scores, propensity_weights } = input
  const uc = config.urgency_config

  let urgencyBonus = 0
  const urgencyReasons: string[] = []

  if (urgency_components.immediate_signal) {
    urgencyBonus += uc.immediate_signal_bonus
    urgencyReasons.push('immediate signal')
  }
  if (urgency_components.close_date_within_30d) {
    urgencyBonus += uc.close_date_30d_bonus
    urgencyReasons.push('close date near')
  }
  if (urgency_components.competitive_pressure) {
    urgencyBonus += uc.competitive_pressure_bonus
    urgencyReasons.push('competitive pressure')
  }
  if (urgency_components.signal_surge) {
    urgencyBonus += uc.signal_surge_bonus
    urgencyReasons.push('signal surge')
  }
  if (urgency_components.stall_going_dark) {
    urgencyBonus += uc.stall_going_dark_penalty
    urgencyReasons.push('stall/going dark')
  }

  const urgencyMultiplier = Math.max(
    uc.min_multiplier,
    Math.min(uc.max_multiplier, 1.0 + urgencyBonus)
  )

  const expectedRevenue = deal_value * (propensity / 100)
  const priorityScore = expectedRevenue * urgencyMultiplier

  const tier = assignPriorityTier(propensity, config.priority_tiers)

  return {
    expected_revenue: Math.round(expectedRevenue * 100) / 100,
    priority_score: Math.round(priorityScore * 100) / 100,
    urgency_multiplier: Math.round(urgencyMultiplier * 100) / 100,
    priority_tier: tier,
    priority_reason: buildPriorityReason({
      propensity,
      sub_scores,
      propensity_weights,
      urgencyReasons,
    }),
  }
}

/**
 * Compose the one-line "why this priority" string the inbox + agent
 * surface to the rep. Per the mission/PRD ("score AND its reason — top
 * 3 only"), we prefer to name the top-3 dimensions that drove the
 * propensity, with up to 3 urgency triggers appended. If sub-scores
 * aren't provided (legacy callers), we fall back to the simpler
 * urgency-only / "Propensity N%" message.
 */
function buildPriorityReason(opts: {
  propensity: number
  sub_scores?: SubScoreSet
  propensity_weights?: ScoringConfig['propensity_weights']
  urgencyReasons: string[]
}): string {
  const { propensity, sub_scores, propensity_weights, urgencyReasons } = opts
  const urgencyChunk =
    urgencyReasons.length > 0
      ? ` (${urgencyReasons.slice(0, URGENCY_LABEL_LIMIT).join(', ')}` +
        (urgencyReasons.length > URGENCY_LABEL_LIMIT ? '…' : '') +
        ')'
      : ''

  if (!sub_scores || !propensity_weights) {
    return urgencyReasons.length > 0
      ? `Priority driven by: ${urgencyReasons.slice(0, URGENCY_LABEL_LIMIT).join(', ')}`
      : `Propensity ${propensity}%`
  }

  const ranked = (Object.keys(sub_scores) as (keyof SubScoreSet)[])
    .map((dim) => ({
      dim,
      contribution: sub_scores[dim] * propensity_weights[dim],
    }))
    .filter((d) => d.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)

  if (ranked.length === 0) {
    return urgencyReasons.length > 0
      ? `Priority driven by: ${urgencyReasons.slice(0, URGENCY_LABEL_LIMIT).join(', ')}`
      : `Propensity ${propensity}%`
  }

  const dims = ranked.map((d) => DIMENSION_LABELS[d.dim]).join(', ')
  return `Top drivers: ${dims}${urgencyChunk}`
}

function assignPriorityTier(
  propensity: number,
  tiers: Record<string, { min_propensity: number }>
): PriorityTier {
  const sorted = Object.entries(tiers).sort(
    ([, a], [, b]) => b.min_propensity - a.min_propensity
  )

  for (const [tier, config] of sorted) {
    if (propensity >= config.min_propensity) return tier as PriorityTier
  }

  return 'MONITOR'
}
