import { describe, it, expect } from 'vitest'
import {
  thompsonAdjustForMemory,
  MIN_SAMPLES_FOR_MEMORY_BANDIT,
  type MemoryPrior,
} from '../bandit'

/**
 * Unit tests for the memory bandit's Thompson-sampling adjustment
 * (Phase 6, Section 1.2).
 *
 * The math mirrors the slice bandit in
 * apps/web/src/lib/agent/context/bandit.ts — same Beta-Bernoulli
 * conjugate, same MIN_SAMPLES gate. We test that:
 *
 *   1. Below the sample threshold, the adjustment is exactly 0
 *      (heuristic / scope ranking stays in charge).
 *   2. Above the threshold, the adjustment is bounded in roughly
 *      [-2, +2].
 *   3. A mostly-cited memory pulls a positive adjustment on average
 *      (success-biased posterior).
 *   4. A mostly-uncited memory pulls a negative adjustment on
 *      average.
 *
 * Random sampling means individual draws can be anywhere in range;
 * we average many draws to compare population means.
 */

describe('thompsonAdjustForMemory', () => {
  it('returns 0 for a missing prior', () => {
    expect(thompsonAdjustForMemory(undefined)).toBe(0)
  })

  it('returns 0 below the sample threshold (cold start)', () => {
    // Beta(1, 1) is uniform — sample_count is 0 (alpha + beta - 2 = 0).
    const cold: MemoryPrior = { memory_id: 'a', prior_alpha: 1, prior_beta: 1 }
    expect(thompsonAdjustForMemory(cold)).toBe(0)

    // Just below the threshold (5 + 5 = 10 → sample_count = 8, < 10).
    const justBelow: MemoryPrior = { memory_id: 'b', prior_alpha: 5, prior_beta: 5 }
    expect(thompsonAdjustForMemory(justBelow)).toBe(0)
  })

  it('above the sample threshold, bounds the adjustment in [-2, +2]', () => {
    // 7 alpha + 7 beta = 14 → sample_count = 12 ≥ 10, eligible for adjustment.
    const eligible: MemoryPrior = { memory_id: 'c', prior_alpha: 7, prior_beta: 7 }
    for (let i = 0; i < 50; i++) {
      const adj = thompsonAdjustForMemory(eligible)
      expect(adj).toBeGreaterThanOrEqual(-2.05)
      expect(adj).toBeLessThanOrEqual(2.05)
    }
  })

  it('a mostly-cited memory averages a POSITIVE adjustment', () => {
    // alpha=80, beta=20 → posterior mean 0.8 → adjustment averages > 0.
    // Need ≥ MIN_SAMPLES_FOR_MEMORY_BANDIT events for the gate to open.
    const cited: MemoryPrior = { memory_id: 'd', prior_alpha: 80, prior_beta: 20 }
    expect((cited.prior_alpha + cited.prior_beta) - 2).toBeGreaterThanOrEqual(
      MIN_SAMPLES_FOR_MEMORY_BANDIT,
    )
    let sum = 0
    const N = 100
    for (let i = 0; i < N; i++) sum += thompsonAdjustForMemory(cited)
    const mean = sum / N
    // Posterior mean is 0.8 → expected adjustment is (0.8 - 0.5) * 4 = 1.2.
    // Allow generous slack for sampling variance over 100 draws.
    expect(mean).toBeGreaterThan(0.5)
  })

  it('a mostly-uncited memory averages a NEGATIVE adjustment', () => {
    const uncited: MemoryPrior = { memory_id: 'e', prior_alpha: 20, prior_beta: 80 }
    let sum = 0
    const N = 100
    for (let i = 0; i < N; i++) sum += thompsonAdjustForMemory(uncited)
    const mean = sum / N
    expect(mean).toBeLessThan(-0.5)
  })

  it('exposes a tunable MIN_SAMPLES threshold equal to slice bandit (10)', () => {
    expect(MIN_SAMPLES_FOR_MEMORY_BANDIT).toBe(10)
  })
})
