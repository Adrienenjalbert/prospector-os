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

/**
 * Bootstrap confidence interval inputs (C6.4).
 *
 * Each account contributes a `value` (deal value) and a `winRate`
 * (the historical conversion rate of similar deals). The bootstrap
 * samples Bernoulli(winRate) for each account independently, sums
 * the wins × value, and reports the percentile band. Replaces the
 * arbitrary `1.3×` multiplier the analytics page used as a fallback
 * with a defensible statistical band.
 */
export interface BootstrapForecastInput {
  /**
   * One row per open opportunity. `value` is the deal value;
   * `winRate` is the historical conversion rate (0..1) of similar
   * deals (typically the win-rate scorer's output / 100).
   */
  opportunities: Array<{ value: number; winRate: number }>
  /** Number of bootstrap samples. Default 1000 — fast and stable. */
  iterations?: number
  /**
   * Optional seeded RNG for deterministic tests. Default
   * `Math.random`.
   */
  rng?: () => number
}

export interface BootstrapForecastResult {
  /** Mean of the simulated forecast distribution. */
  mean: number
  /** 10th percentile — pessimistic floor. */
  p10: number
  /** 50th percentile — median forecast. */
  p50: number
  /** 90th percentile — optimistic ceiling. */
  p90: number
  /** Sample size used for the bootstrap (after iteration count). */
  iterations: number
  /** Number of opportunities that contributed. */
  opportunity_count: number
}

/**
 * Bootstrap forecast confidence band.
 *
 * For `iterations` runs, simulate each opportunity as won/lost via a
 * Bernoulli draw against `winRate`. Sum each run's won-deal values.
 * Report (mean, p10, p50, p90) of the resulting distribution.
 *
 * Why not a closed-form Poisson-binomial? Because the rep-facing
 * forecast usually has 30–500 opps; bootstrap converges fast at
 * those sizes and is far more flexible (we can extend to draw stage
 * velocity from a separate distribution per stage when we want).
 *
 * Pure function — no IO, no DB calls. Deterministic when `rng` is
 * seeded.
 */
export function computeBootstrapForecast(
  input: BootstrapForecastInput,
): BootstrapForecastResult {
  const opps = input.opportunities ?? []
  const iterations = Math.max(100, input.iterations ?? 1000)
  const rng = input.rng ?? Math.random

  if (opps.length === 0) {
    return {
      mean: 0,
      p10: 0,
      p50: 0,
      p90: 0,
      iterations,
      opportunity_count: 0,
    }
  }

  const samples: number[] = new Array(iterations)
  for (let i = 0; i < iterations; i++) {
    let total = 0
    for (const o of opps) {
      const wr = Math.max(0, Math.min(1, o.winRate))
      if (rng() < wr) total += o.value
    }
    samples[i] = total
  }

  samples.sort((a, b) => a - b)
  const mean = samples.reduce((s, v) => s + v, 0) / iterations

  return {
    mean: Math.round(mean),
    p10: Math.round(samples[Math.floor(iterations * 0.1)]),
    p50: Math.round(samples[Math.floor(iterations * 0.5)]),
    p90: Math.round(samples[Math.floor(iterations * 0.9)]),
    iterations,
    opportunity_count: opps.length,
  }
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
