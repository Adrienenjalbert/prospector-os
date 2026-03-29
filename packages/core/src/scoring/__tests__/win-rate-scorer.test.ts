import { describe, it, expect } from 'vitest'
import { computeProfileWinRate } from '../win-rate-scorer'

describe('computeProfileWinRate', () => {
  it('returns company_win_rate when no similar deals exist', () => {
    const result = computeProfileWinRate({
      similar_won: 0,
      similar_lost: 0,
      company_win_rate: 15,
      blend_threshold: 10,
    })
    expect(result.score).toBe(15)
    expect(result.top_reason).toContain('small sample: 0')
  })

  it('returns raw win rate when sample exceeds blend threshold', () => {
    const result = computeProfileWinRate({
      similar_won: 8,
      similar_lost: 2,
      company_win_rate: 15,
      blend_threshold: 10,
    })
    expect(result.score).toBe(80) // 8/10 * 100
    expect(result.top_reason).toContain('Based on 10 similar deals')
  })

  it('blends win rate with company average for small samples', () => {
    const result = computeProfileWinRate({
      similar_won: 3,
      similar_lost: 2,
      company_win_rate: 20,
      blend_threshold: 10,
    })
    // rawWinRate = 3/5 * 100 = 60
    // blended = (60*5 + 20*10) / (5+10) = (300+200)/15 = 33.33
    expect(result.score).toBeCloseTo(33.33, 1)
    expect(result.top_reason).toContain('Blended')
  })

  it('clamps score to [0, 100]', () => {
    const result = computeProfileWinRate({
      similar_won: 100,
      similar_lost: 0,
      company_win_rate: 200,
      blend_threshold: 10,
    })
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('handles 100% loss rate', () => {
    const result = computeProfileWinRate({
      similar_won: 0,
      similar_lost: 15,
      company_win_rate: 15,
      blend_threshold: 10,
    })
    expect(result.score).toBe(0) // 0/15 * 100 = 0, sample ≥ threshold
  })

  it('handles blend_threshold of 0 (no blending)', () => {
    const result = computeProfileWinRate({
      similar_won: 1,
      similar_lost: 1,
      company_win_rate: 15,
      blend_threshold: 0,
    })
    // sampleSize=2 >= threshold=0 → raw win rate = 50
    expect(result.score).toBe(50)
  })

  it('produces single dimension with weight 1', () => {
    const result = computeProfileWinRate({
      similar_won: 5,
      similar_lost: 5,
      company_win_rate: 15,
      blend_threshold: 10,
    })
    expect(result.dimensions).toHaveLength(1)
    expect(result.dimensions[0].weight).toBe(1)
  })
})
