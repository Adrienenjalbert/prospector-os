import { describe, it, expect } from 'vitest'
import { computeBootstrapForecast } from '../forecast'

/**
 * Bootstrap forecast tests (C6.4).
 *
 * The bootstrap is non-deterministic by default. We pass a seeded
 * PRNG (Mulberry32) for repeatability — same seed, same band.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
  }
}

describe('computeBootstrapForecast', () => {
  it('returns zeros when there are no opportunities', () => {
    const r = computeBootstrapForecast({ opportunities: [] })
    expect(r.mean).toBe(0)
    expect(r.p10).toBe(0)
    expect(r.p50).toBe(0)
    expect(r.p90).toBe(0)
    expect(r.opportunity_count).toBe(0)
  })

  it('produces a tight band when every deal has near-certain winRate', () => {
    const opps = Array.from({ length: 10 }, () => ({ value: 100, winRate: 0.99 }))
    const r = computeBootstrapForecast({
      opportunities: opps,
      iterations: 2000,
      rng: mulberry32(1),
    })
    // With 99% win rate × 10 deals × $100, expected sum ~ $990 per
    // simulation; band should be very tight (p10/p90 within $200).
    expect(r.mean).toBeGreaterThan(900)
    expect(r.mean).toBeLessThan(1000)
    expect(r.p90 - r.p10).toBeLessThan(200)
  })

  it('produces a wider band when win rates are 50%', () => {
    const opps = Array.from({ length: 20 }, () => ({ value: 100, winRate: 0.5 }))
    const r = computeBootstrapForecast({
      opportunities: opps,
      iterations: 2000,
      rng: mulberry32(2),
    })
    // 50% over 20 deals: expected mean = $1000; band naturally wider
    // because of high variance.
    expect(r.mean).toBeGreaterThan(800)
    expect(r.mean).toBeLessThan(1200)
    expect(r.p90 - r.p10).toBeGreaterThan(300)
  })

  it('clamps winRate outside [0,1] to bounds', () => {
    const opps = [
      { value: 100, winRate: -0.5 }, // floored to 0 -> never wins
      { value: 100, winRate: 1.5 }, // ceilinged to 1 -> always wins
    ]
    const r = computeBootstrapForecast({
      opportunities: opps,
      iterations: 500,
      rng: mulberry32(3),
    })
    // Always-win contributes 100 every iteration, never-win
    // contributes 0 -> distribution collapses to 100.
    expect(r.mean).toBe(100)
    expect(r.p10).toBe(100)
    expect(r.p90).toBe(100)
  })

  it('is deterministic with the same seed', () => {
    const opps = [
      { value: 50, winRate: 0.4 },
      { value: 200, winRate: 0.7 },
      { value: 1000, winRate: 0.2 },
    ]
    const a = computeBootstrapForecast({
      opportunities: opps,
      iterations: 500,
      rng: mulberry32(99),
    })
    const b = computeBootstrapForecast({
      opportunities: opps,
      iterations: 500,
      rng: mulberry32(99),
    })
    expect(a).toEqual(b)
  })
})
