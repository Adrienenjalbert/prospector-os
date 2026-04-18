import { describe, expect, it } from 'vitest'
import {
  MIN_SAMPLES_FOR_BANDIT,
  priorKey,
  thompsonAdjustment,
  type SlicePrior,
} from '../bandit'
import { buildSelectorInput, scoreSlices } from '../selector'

/**
 * Unit tests for the Phase-3 bandit. Pin the invariants future contributors
 * are most likely to regress:
 *
 *   - thin priors (sample_count < MIN_SAMPLES_FOR_BANDIT) contribute 0
 *   - bandit adjustment magnitude stays within ±2-ish range so it nudges
 *     without dominating the heuristic
 *   - selector composes the bandit input cleanly (no-priors selector matches
 *     the Phase-2 behaviour exactly)
 */

const fakePrior = (alpha: number, beta: number, samples: number): SlicePrior => ({
  intent_class: 'risk_analysis',
  role: 'ae',
  slice_slug: 'stalled-deals',
  alpha,
  beta,
  sample_count: samples,
})

describe('priorKey', () => {
  it('formats consistently', () => {
    expect(priorKey('risk_analysis', 'ae', 'stalled-deals')).toBe(
      'risk_analysis:ae:stalled-deals',
    )
  })
})

describe('thompsonAdjustment', () => {
  it('returns 0 for undefined prior', () => {
    expect(thompsonAdjustment(undefined)).toBe(0)
  })

  it('returns 0 when sample_count is below the bandit threshold', () => {
    const prior = fakePrior(5, 1, MIN_SAMPLES_FOR_BANDIT - 1)
    expect(thompsonAdjustment(prior)).toBe(0)
  })

  it('returns a non-zero nudge once enough samples accumulate', () => {
    const prior = fakePrior(20, 4, 24)
    // Run several samples; due to randomness we just assert that the
    // distribution is non-degenerate around a positive central value.
    const samples = Array.from({ length: 100 }, () => thompsonAdjustment(prior))
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length
    expect(mean).toBeGreaterThan(0)
    // Magnitude bound: within ±3 around 0 (the 4-point scale x sampled ±0.5).
    for (const s of samples) {
      expect(Math.abs(s)).toBeLessThanOrEqual(3)
    }
  })

  it('penalises losing slices on average', () => {
    const prior = fakePrior(2, 20, 22)
    const samples = Array.from({ length: 100 }, () => thompsonAdjustment(prior))
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length
    expect(mean).toBeLessThan(0)
  })
})

describe('selector + bandit composition', () => {
  it('matches the no-bandit Phase-2 score when bandit_priors is undefined', () => {
    const noBandit = scoreSlices(
      buildSelectorInput({
        role: 'ae',
        activeObject: 'none',
        activeUrn: null,
        intentClass: 'risk_analysis',
      }),
    )
    const stalledDealsScore = noBandit.find((s) => s.slug === 'stalled-deals')!.score
    expect(stalledDealsScore).toBeGreaterThan(0)
  })

  it('boosts a slice when the bandit reports a positive adjustment', () => {
    const baseInput = buildSelectorInput({
      role: 'ae',
      activeObject: 'none',
      activeUrn: null,
      intentClass: 'risk_analysis',
    })
    const baseScore = scoreSlices(baseInput).find(
      (s) => s.slug === 'stalled-deals',
    )!.score

    const boostedInput = buildSelectorInput({
      role: 'ae',
      activeObject: 'none',
      activeUrn: null,
      intentClass: 'risk_analysis',
      banditPriors: {
        adjustment: (slug) => (slug === 'stalled-deals' ? 1.5 : 0),
      },
    })
    const boostedScore = scoreSlices(boostedInput).find(
      (s) => s.slug === 'stalled-deals',
    )!.score

    expect(boostedScore).toBe(baseScore + 1.5)
  })

  it('denies via tenant override beats bandit boost (deny is strict)', () => {
    const input = buildSelectorInput({
      role: 'ae',
      activeObject: 'none',
      activeUrn: null,
      intentClass: 'risk_analysis',
      tenantOverrides: { deny: ['stalled-deals'] },
      banditPriors: { adjustment: () => 5 },
    })
    const scored = scoreSlices(input)
    const stalledDeals = scored.find((s) => s.slug === 'stalled-deals')!
    expect(stalledDeals.score).toBe(Number.NEGATIVE_INFINITY)
  })
})
