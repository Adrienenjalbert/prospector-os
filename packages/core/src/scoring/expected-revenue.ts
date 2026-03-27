import type { ScoringConfig } from '../types/config'
import type { PriorityTier } from '../types/ontology'
import type { UrgencyComponents } from '../types/scoring'

export interface ExpectedRevenueInput {
  deal_value: number
  propensity: number
  urgency_components: UrgencyComponents
}

export interface ExpectedRevenueResult {
  expected_revenue: number
  urgency_multiplier: number
  priority_tier: PriorityTier
  priority_reason: string
}

export function computeExpectedRevenue(
  input: ExpectedRevenueInput,
  config: ScoringConfig
): ExpectedRevenueResult {
  const { deal_value, propensity, urgency_components } = input
  const uc = config.urgency_config

  let urgencyBonus = 0
  const reasons: string[] = []

  if (urgency_components.immediate_signal) {
    urgencyBonus += uc.immediate_signal_bonus
    reasons.push('immediate signal')
  }
  if (urgency_components.close_date_within_30d) {
    urgencyBonus += uc.close_date_30d_bonus
    reasons.push('close date near')
  }
  if (urgency_components.competitive_pressure) {
    urgencyBonus += uc.competitive_pressure_bonus
    reasons.push('competitive pressure')
  }
  if (urgency_components.signal_surge) {
    urgencyBonus += uc.signal_surge_bonus
    reasons.push('signal surge')
  }
  if (urgency_components.stall_going_dark) {
    urgencyBonus += uc.stall_going_dark_penalty
    reasons.push('stall/going dark')
  }

  const urgencyMultiplier = Math.max(
    uc.min_multiplier,
    Math.min(uc.max_multiplier, 1.0 + urgencyBonus)
  )

  const expectedRevenue = deal_value * (propensity / 100) * urgencyMultiplier
  const rounded = Math.round(expectedRevenue * 100) / 100

  const tier = assignPriorityTier(propensity, config.priority_tiers)

  return {
    expected_revenue: rounded,
    urgency_multiplier: Math.round(urgencyMultiplier * 100) / 100,
    priority_tier: tier,
    priority_reason:
      reasons.length > 0
        ? `Priority driven by: ${reasons.join(', ')}`
        : `Propensity ${propensity}%`,
  }
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
