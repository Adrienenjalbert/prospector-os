import { describe, it, expect } from 'vitest'
import { computePropensity } from '../propensity-scorer'
import { computeProfileWinRate } from '../win-rate-scorer'
import { computeExpectedRevenue } from '../expected-revenue'
import type { SubScoreSet } from '../../types/scoring'
import type { PropensityWeights, ScoringConfig } from '../../types/config'

const defaultWeights: PropensityWeights = {
  icp_fit: 0.15,
  signal_momentum: 0.20,
  engagement_depth: 0.15,
  contact_coverage: 0.20,
  stage_velocity: 0.15,
  profile_win_rate: 0.15,
}

const mockScoringConfig = {
  urgency_config: {
    immediate_signal_bonus: 0.20,
    close_date_30d_bonus: 0.15,
    competitive_pressure_bonus: 0.10,
    signal_surge_bonus: 0.05,
    stall_going_dark_penalty: -0.15,
    max_multiplier: 1.50,
    min_multiplier: 0.85,
  },
  priority_tiers: {
    HOT: { min_propensity: 70 },
    WARM: { min_propensity: 50 },
    COOL: { min_propensity: 30 },
    MONITOR: { min_propensity: 0 },
  },
} as unknown as ScoringConfig

describe('computePropensity', () => {
  it('combines sub-scores correctly', () => {
    const scores: SubScoreSet = {
      icp_fit: 80, signal_momentum: 70, engagement_depth: 60,
      contact_coverage: 50, stage_velocity: 40, profile_win_rate: 30,
    }
    const result = computePropensity(scores, defaultWeights)

    const expected =
      80 * 0.15 + 70 * 0.20 + 60 * 0.15 + 50 * 0.20 + 40 * 0.15 + 30 * 0.15
    expect(result).toBeCloseTo(expected, 1)
  })

  it('clamps to 0-100', () => {
    const allHigh: SubScoreSet = {
      icp_fit: 100, signal_momentum: 100, engagement_depth: 100,
      contact_coverage: 100, stage_velocity: 100, profile_win_rate: 100,
    }
    expect(computePropensity(allHigh, defaultWeights)).toBeLessThanOrEqual(100)

    const allZero: SubScoreSet = {
      icp_fit: 0, signal_momentum: 0, engagement_depth: 0,
      contact_coverage: 0, stage_velocity: 0, profile_win_rate: 0,
    }
    expect(computePropensity(allZero, defaultWeights)).toBe(0)
  })
})

describe('computeProfileWinRate', () => {
  it('returns company average with no similar deals', () => {
    const result = computeProfileWinRate({
      similar_won: 0, similar_lost: 0,
      company_win_rate: 15, blend_threshold: 10,
    })
    expect(result.score).toBe(15)
  })

  it('uses raw rate for large sample', () => {
    const result = computeProfileWinRate({
      similar_won: 8, similar_lost: 12,
      company_win_rate: 15, blend_threshold: 10,
    })
    expect(result.score).toBe(40)
  })

  it('blends for small sample', () => {
    const result = computeProfileWinRate({
      similar_won: 2, similar_lost: 1,
      company_win_rate: 15, blend_threshold: 10,
    })
    expect(result.score).toBeGreaterThan(15)
    expect(result.score).toBeLessThan(67)
  })
})

describe('computeExpectedRevenue', () => {
  it('calculates expected revenue = value * propensity / 100', () => {
    const result = computeExpectedRevenue({
      deal_value: 200000, propensity: 80,
      urgency_components: {
        immediate_signal: false, close_date_within_30d: false,
        competitive_pressure: false, signal_surge: false, stall_going_dark: false,
      },
    }, mockScoringConfig)

    expect(result.expected_revenue).toBe(160000)
    expect(result.urgency_multiplier).toBe(1.0)
    expect(result.priority_tier).toBe('HOT')
  })

  it('applies urgency multiplier', () => {
    const result = computeExpectedRevenue({
      deal_value: 100000, propensity: 50,
      urgency_components: {
        immediate_signal: true, close_date_within_30d: true,
        competitive_pressure: false, signal_surge: false, stall_going_dark: false,
      },
    }, mockScoringConfig)

    expect(result.urgency_multiplier).toBe(1.35)
    expect(result.expected_revenue).toBe(67500)
  })

  it('applies stall penalty', () => {
    const result = computeExpectedRevenue({
      deal_value: 100000, propensity: 50,
      urgency_components: {
        immediate_signal: false, close_date_within_30d: false,
        competitive_pressure: false, signal_surge: false, stall_going_dark: true,
      },
    }, mockScoringConfig)

    expect(result.urgency_multiplier).toBe(0.85)
    expect(result.expected_revenue).toBe(42500)
  })

  it('clamps multiplier to max', () => {
    const result = computeExpectedRevenue({
      deal_value: 100000, propensity: 50,
      urgency_components: {
        immediate_signal: true, close_date_within_30d: true,
        competitive_pressure: true, signal_surge: true, stall_going_dark: false,
      },
    }, mockScoringConfig)

    expect(result.urgency_multiplier).toBe(1.50)
  })
})
