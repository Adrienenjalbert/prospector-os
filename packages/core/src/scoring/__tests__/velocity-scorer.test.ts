import { describe, it, expect } from 'vitest'
import { computeStageVelocity, type VelocityScorerInput } from '../velocity-scorer'
import type { Opportunity, FunnelBenchmark } from '../../types/ontology'
import type { VelocityTier } from '../../types/config'

const velocityTiers: VelocityTier[] = [
  { min_ratio: 2.0, score: 100, label: 'Fast-track' },
  { min_ratio: 1.5, score: 85, label: 'Above median' },
  { min_ratio: 1.0, score: 70, label: 'On pace' },
  { min_ratio: 0.7, score: 50, label: 'Slightly slow' },
  { min_ratio: 0.5, score: 30, label: 'Significantly slow' },
  { min_ratio: 0.0, score: 10, label: 'Stalled' },
]

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'o1', tenant_id: 't1', crm_id: 'opp-1', company_id: 'c1',
    owner_crm_id: 'rep-1', name: 'Deal', value: 100000, currency: 'GBP',
    stage: 'Proposal', stage_order: 3, probability: 50,
    days_in_stage: 10, stage_entered_at: null, expected_close_date: null,
    is_stalled: false, stall_reason: null, next_best_action: null,
    is_closed: false, is_won: false, closed_at: null, lost_reason: null,
    win_probability_ai: null, created_at: '', updated_at: '', last_crm_sync: '',
    ...overrides,
  }
}

function makeBenchmark(stage: string, medianDays: number): FunnelBenchmark {
  return {
    id: 'b1', tenant_id: 't1', stage_name: stage, period: '2026-03',
    scope: 'company', scope_id: 'all',
    conversion_rate: 50, drop_rate: 10, deal_count: 20, total_value: 2000000,
    avg_deal_value: 100000, avg_days_in_stage: medianDays,
    median_days_in_stage: medianDays, impact_score: 0,
    stall_count: 2, stall_value: 200000, computed_at: new Date().toISOString(),
  }
}

describe('computeStageVelocity', () => {
  it('returns score 0 with neutral dimensions when no opportunity', () => {
    const result = computeStageVelocity(
      { opportunity: null, benchmarks: [], total_active_stages: 4 },
      velocityTiers,
    )
    expect(result.score).toBe(0)
    expect(result.top_reason).toBe('No active opportunity')
  })

  it('returns score 0 for a closed opportunity', () => {
    const result = computeStageVelocity(
      { opportunity: makeOpp({ is_closed: true }), benchmarks: [], total_active_stages: 4 },
      velocityTiers,
    )
    expect(result.score).toBe(0)
  })

  it('computes progress as stage_order / total_active_stages', () => {
    const result = computeStageVelocity(
      { opportunity: makeOpp({ stage_order: 2 }), benchmarks: [], total_active_stages: 4 },
      velocityTiers,
    )
    const progressDim = result.dimensions.find(d => d.name === 'stage_progress')!
    expect(progressDim.score).toBe(50) // 2/4 = 50%
  })

  it('scores speed high when deal is faster than benchmark median', () => {
    const result = computeStageVelocity(
      {
        opportunity: makeOpp({ stage: 'Proposal', days_in_stage: 5 }),
        benchmarks: [makeBenchmark('Proposal', 20)],
        total_active_stages: 4,
      },
      velocityTiers,
    )
    const speedDim = result.dimensions.find(d => d.name === 'speed_vs_benchmark')!
    // ratio = 20/5 = 4.0 → >= 2.0 → score 100
    expect(speedDim.score).toBe(100)
  })

  it('scores speed low when deal is much slower than benchmark', () => {
    const result = computeStageVelocity(
      {
        opportunity: makeOpp({ stage: 'Proposal', days_in_stage: 50 }),
        benchmarks: [makeBenchmark('Proposal', 14)],
        total_active_stages: 4,
      },
      velocityTiers,
    )
    const speedDim = result.dimensions.find(d => d.name === 'speed_vs_benchmark')!
    // ratio = 14/50 = 0.28 → >= 0.0, < 0.5 → score 10
    expect(speedDim.score).toBe(10)
  })

  it('defaults speed to 50 when no benchmark matches the stage', () => {
    const result = computeStageVelocity(
      {
        opportunity: makeOpp({ stage: 'Proposal' }),
        benchmarks: [makeBenchmark('Negotiation', 14)],
        total_active_stages: 4,
      },
      velocityTiers,
    )
    const speedDim = result.dimensions.find(d => d.name === 'speed_vs_benchmark')!
    expect(speedDim.score).toBe(50)
  })

  it('gives high momentum to a recently entered stage', () => {
    const recentEntry = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const result = computeStageVelocity(
      {
        opportunity: makeOpp({ stage_entered_at: recentEntry, days_in_stage: 3 }),
        benchmarks: [],
        total_active_stages: 4,
      },
      velocityTiers,
    )
    const momentumDim = result.dimensions.find(d => d.name === 'momentum_direction')!
    expect(momentumDim.score).toBe(95)
  })

  it('gives low momentum to a stalled deal', () => {
    const result = computeStageVelocity(
      {
        opportunity: makeOpp({ is_stalled: true, days_in_stage: 45 }),
        benchmarks: [],
        total_active_stages: 4,
      },
      velocityTiers,
    )
    const momentumDim = result.dimensions.find(d => d.name === 'momentum_direction')!
    expect(momentumDim.score).toBe(10)
  })

  it('produces overall score in [0, 100] range', () => {
    const result = computeStageVelocity(
      {
        opportunity: makeOpp({ stage_order: 4, days_in_stage: 5 }),
        benchmarks: [makeBenchmark('Proposal', 14)],
        total_active_stages: 4,
      },
      velocityTiers,
    )
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })
})
