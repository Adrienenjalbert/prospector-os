import { describe, it, expect } from 'vitest'
import {
  thompsonAdjust,
  posteriorMean,
  sampleCount,
  MIN_SAMPLES_FOR_BANDIT,
  type BetaPrior,
} from '../beta'

/**
 * Shared Beta-Bernoulli math (Phase 7, Section 2.3 extraction).
 *
 * The math is the conjugate prior used by:
 *   - Memory bandit (Phase 6): tenant_memories.prior_alpha/beta
 *   - Wiki page bandit (Phase 6): wiki_pages.prior_alpha/beta
 *   - Trigger bandit (Phase 7): triggers.prior_alpha/beta
 *
 * One file, one set of tests, three call sites — exactly the contract
 * we wanted from the extraction.
 */

describe('thompsonAdjust', () => {
  it('returns 0 for a missing prior', () => {
    expect(thompsonAdjust(undefined)).toBe(0)
  })

  it('returns 0 at uniform Beta(1,1) cold start', () => {
    const cold: BetaPrior = { prior_alpha: 1, prior_beta: 1 }
    expect(thompsonAdjust(cold)).toBe(0)
  })

  it('returns 0 just below the sample threshold', () => {
    // 5 + 5 - 2 = 8, < MIN_SAMPLES_FOR_BANDIT (10).
    const justBelow: BetaPrior = { prior_alpha: 5, prior_beta: 5 }
    expect(thompsonAdjust(justBelow)).toBe(0)
  })

  it('above threshold, bounds adjustment in [-2.05, +2.05]', () => {
    const eligible: BetaPrior = { prior_alpha: 7, prior_beta: 7 }
    for (let i = 0; i < 100; i++) {
      const adj = thompsonAdjust(eligible)
      expect(adj).toBeGreaterThanOrEqual(-2.05)
      expect(adj).toBeLessThanOrEqual(2.05)
    }
  })

  it('mostly-positive prior averages a POSITIVE adjustment', () => {
    const positive: BetaPrior = { prior_alpha: 80, prior_beta: 20 }
    expect(positive.prior_alpha + positive.prior_beta - 2).toBeGreaterThanOrEqual(
      MIN_SAMPLES_FOR_BANDIT,
    )
    let total = 0
    for (let i = 0; i < 200; i++) total += thompsonAdjust(positive)
    expect(total / 200).toBeGreaterThan(0)
  })

  it('mostly-negative prior averages a NEGATIVE adjustment', () => {
    const negative: BetaPrior = { prior_alpha: 20, prior_beta: 80 }
    let total = 0
    for (let i = 0; i < 200; i++) total += thompsonAdjust(negative)
    expect(total / 200).toBeLessThan(0)
  })
})

describe('posteriorMean', () => {
  it('returns null below the sample threshold', () => {
    expect(posteriorMean(undefined)).toBeNull()
    expect(posteriorMean({ prior_alpha: 1, prior_beta: 1 })).toBeNull()
    expect(posteriorMean({ prior_alpha: 5, prior_beta: 5 })).toBeNull()
  })

  it('returns alpha / (alpha + beta) above the threshold', () => {
    const p: BetaPrior = { prior_alpha: 80, prior_beta: 20 }
    expect(posteriorMean(p)).toBeCloseTo(0.8, 5)
  })
})

describe('sampleCount', () => {
  it('returns 0 for cold start', () => {
    expect(sampleCount(undefined)).toBe(0)
    expect(sampleCount({ prior_alpha: 1, prior_beta: 1 })).toBe(0)
  })

  it('returns alpha + beta - 2', () => {
    expect(sampleCount({ prior_alpha: 50, prior_beta: 30 })).toBe(78)
  })
})
