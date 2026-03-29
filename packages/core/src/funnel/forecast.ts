import type { Company } from '../types/ontology'

export interface ForecastInput {
  accounts: Pick<Company, 'expected_revenue' | 'priority_tier' | 'propensity'>[]
}

export interface ForecastResult {
  total_pipeline: number
  weighted_pipeline: number
  hot_value: number
  warm_value: number
  cool_value: number
  deal_count: number
  avg_propensity: number
}

export function computeForecast(input: ForecastInput): ForecastResult {
  const { accounts } = input

  let totalPipeline = 0
  let weightedPipeline = 0
  let hot = 0
  let warm = 0
  let cool = 0
  let totalPropensity = 0

  for (const acc of accounts) {
    const rev = acc.expected_revenue ?? 0
    totalPipeline += rev
    // expected_revenue already includes propensity (deal_value * propensity/100)
    // so weighted_pipeline is just the sum of expected_revenue values
    weightedPipeline += rev
    totalPropensity += acc.propensity

    switch (acc.priority_tier) {
      case 'HOT': hot += rev; break
      case 'WARM': warm += rev; break
      case 'COOL': cool += rev; break
    }
  }

  return {
    total_pipeline: Math.round(totalPipeline),
    weighted_pipeline: Math.round(weightedPipeline),
    hot_value: Math.round(hot),
    warm_value: Math.round(warm),
    cool_value: Math.round(cool),
    deal_count: accounts.length,
    avg_propensity: accounts.length > 0
      ? Math.round((totalPropensity / accounts.length) * 100) / 100
      : 0,
  }
}
