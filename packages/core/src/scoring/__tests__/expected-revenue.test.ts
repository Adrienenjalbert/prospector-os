import { describe, it, expect } from 'vitest'
import { computeExpectedRevenue } from '../expected-revenue'
import type { ScoringConfig } from '../../types/config'
import type { UrgencyComponents } from '../../types/scoring'

const mockConfig = {
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

const noUrgency: UrgencyComponents = {
  immediate_signal: false,
  close_date_within_30d: false,
  competitive_pressure: false,
  signal_surge: false,
  stall_going_dark: false,
}

describe('computeExpectedRevenue', () => {
  it('computes expected revenue as deal_value × propensity/100', () => {
    const result = computeExpectedRevenue(
      { deal_value: 100000, propensity: 60, urgency_components: noUrgency },
      mockConfig,
    )
    expect(result.expected_revenue).toBe(60000) // 100000 * 60/100
    expect(result.urgency_multiplier).toBe(1.0)
  })

  it('applies immediate signal bonus (+0.20)', () => {
    const result = computeExpectedRevenue(
      { deal_value: 100000, propensity: 50, urgency_components: { ...noUrgency, immediate_signal: true } },
      mockConfig,
    )
    expect(result.urgency_multiplier).toBe(1.20)
    expect(result.priority_score).toBe(50000 * 1.20) // 60000
  })

  it('applies stall penalty (-0.15)', () => {
    const result = computeExpectedRevenue(
      { deal_value: 100000, propensity: 50, urgency_components: { ...noUrgency, stall_going_dark: true } },
      mockConfig,
    )
    expect(result.urgency_multiplier).toBe(0.85) // 1.0 + (-0.15) = 0.85 = min_multiplier
  })

  it('clamps multiplier at max_multiplier when all bonuses active', () => {
    const allPositive: UrgencyComponents = {
      immediate_signal: true,
      close_date_within_30d: true,
      competitive_pressure: true,
      signal_surge: true,
      stall_going_dark: false,
    }
    const result = computeExpectedRevenue(
      { deal_value: 100000, propensity: 80, urgency_components: allPositive },
      mockConfig,
    )
    // bonus = 0.20+0.15+0.10+0.05 = 0.50 → 1.0+0.50 = 1.50 = max_multiplier
    expect(result.urgency_multiplier).toBe(1.50)
  })

  it('clamps multiplier at min_multiplier when only penalty applies', () => {
    const result = computeExpectedRevenue(
      { deal_value: 100000, propensity: 50, urgency_components: { ...noUrgency, stall_going_dark: true } },
      mockConfig,
    )
    expect(result.urgency_multiplier).toBe(0.85)
  })

  it('assigns HOT tier at propensity = 70', () => {
    const result = computeExpectedRevenue(
      { deal_value: 100000, propensity: 70, urgency_components: noUrgency },
      mockConfig,
    )
    expect(result.priority_tier).toBe('HOT')
  })

  it('assigns WARM tier at propensity = 69', () => {
    const result = computeExpectedRevenue(
      { deal_value: 100000, propensity: 69, urgency_components: noUrgency },
      mockConfig,
    )
    expect(result.priority_tier).toBe('WARM')
  })

  it('assigns COOL tier at propensity = 30', () => {
    const result = computeExpectedRevenue(
      { deal_value: 100000, propensity: 30, urgency_components: noUrgency },
      mockConfig,
    )
    expect(result.priority_tier).toBe('COOL')
  })

  it('assigns MONITOR tier at propensity = 29', () => {
    const result = computeExpectedRevenue(
      { deal_value: 100000, propensity: 29, urgency_components: noUrgency },
      mockConfig,
    )
    expect(result.priority_tier).toBe('MONITOR')
  })

  it('handles zero deal value', () => {
    const result = computeExpectedRevenue(
      { deal_value: 0, propensity: 80, urgency_components: noUrgency },
      mockConfig,
    )
    expect(result.expected_revenue).toBe(0)
    expect(result.priority_score).toBe(0)
    expect(result.priority_tier).toBe('HOT') // tier from propensity, not revenue
  })

  it('includes reason listing active urgency components', () => {
    const result = computeExpectedRevenue(
      { deal_value: 100000, propensity: 50, urgency_components: { ...noUrgency, immediate_signal: true, competitive_pressure: true } },
      mockConfig,
    )
    expect(result.priority_reason).toContain('immediate signal')
    expect(result.priority_reason).toContain('competitive pressure')
  })

  it('shows propensity percentage as reason when no urgency factors', () => {
    const result = computeExpectedRevenue(
      { deal_value: 100000, propensity: 42, urgency_components: noUrgency },
      mockConfig,
    )
    expect(result.priority_reason).toBe('Propensity 42%')
  })
})
