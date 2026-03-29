import { describe, it, expect } from 'vitest'
import { computeCompositeScore, type CompositeScoreInput, type CompositeScoreConfig } from '../composite-scorer'

const mockConfig: CompositeScoreConfig = {
  icpConfig: {
    version: '1.0-test',
    business: 'test',
    dimensions: [
      { name: 'industry', weight: 0.5, description: '', data_source: 'industry', scoring_tiers: [{ condition: 'in', values: ['Logistics', 'Warehousing'], score: 100, label: 'Match' }, { condition: 'default', score: 20, label: 'Other' }] },
      { name: 'size', weight: 0.5, description: '', data_source: 'employee_count', scoring_tiers: [{ condition: 'between', min: 200, max: 5000, score: 100, label: 'Fit' }, { condition: 'default', score: 20, label: 'Other' }] },
    ],
    tier_thresholds: { A: 80, B: 60, C: 40, D: 0 },
    recalibration: { frequency_days: 90, method: 'test', min_sample_size: 10 },
  },
  scoringConfig: {
    version: '1.0',
    propensity_weights: { icp_fit: 0.2, signal_momentum: 0.2, engagement_depth: 0.15, contact_coverage: 0.15, stage_velocity: 0.15, profile_win_rate: 0.15 },
    icp_tier_thresholds: { A: 80, B: 60, C: 40, D: 0 },
    priority_tiers: { HOT: { min_propensity: 70 }, WARM: { min_propensity: 50 }, COOL: { min_propensity: 30 }, MONITOR: { min_propensity: 0 } },
    deal_value_estimation: { method: 'fallback', fallback_values: { A: 180000, B: 95000, C: 45000, D: 0 }, currency: 'GBP' },
    urgency_config: { immediate_signal_bonus: 0.2, close_date_30d_bonus: 0.15, competitive_pressure_bonus: 0.1, signal_surge_bonus: 0.05, stall_going_dark_penalty: -0.15, max_multiplier: 1.5, min_multiplier: 0.85 },
    contact_coverage: { breadth_tiers: [{ min_contacts: 3, score: 60, label: 'Dev' }, { min_contacts: 0, score: 0, label: 'None' }], seniority_points: { c_level: 35, vp_director: 30, manager: 20, individual: 15 }, key_roles: [], champion_engaged_bonus: 15, economic_buyer_engaged_bonus: 15 },
    engagement_activity_points: { proposal_sent: 25, meeting_one_on_one: 15, call_connected: 10, email_reply_received: 8 },
    engagement_recency: [{ max_days: 7, score: 100 }, { max_days: 30, score: 40 }, { max_days: 9999, score: 5 }],
    velocity_ratio_tiers: [{ min_ratio: 1.0, score: 70, label: 'On pace' }, { min_ratio: 0, score: 10, label: 'Slow' }],
    profile_match: { dimensions: [], lookback_months: 12, blend_threshold: 10, value_tiers: [] },
    recalibration: { frequency_days: 90, method: 'test' },
  },
  signalConfig: {
    version: '1.0',
    business: 'test',
    signal_types: [{ name: 'hiring_surge', display_name: 'Hiring', description: '', source: 'apollo', weight_multiplier: 1.2, recency_decay_days: 30, min_relevance_threshold: 0.5, urgency_default: 'this_week', enrichment_depth: 'standard' as const }],
    recency_decay: { formula: '', description: '' },
    composite_signal_score: { formula: '', max_signals_per_company: 10, description: '' },
    deep_research_config: { model: 'test', temperature: 0.2, max_tokens: 100, only_for_tiers: ['A'] },
  },
}

function makeInput(overrides: Partial<CompositeScoreInput> = {}): CompositeScoreInput {
  return {
    company: { industry: 'Logistics', employee_count: 1200, hq_country: 'United Kingdom' },
    contacts: [],
    signals: [],
    opportunities: [],
    activities: [],
    benchmarks: [],
    previousSignalScore: null,
    companyWinRate: 15,
    ...overrides,
  }
}

describe('computeCompositeScore', () => {
  it('returns all score fields', () => {
    const result = computeCompositeScore(makeInput(), mockConfig)
    expect(result).toHaveProperty('icp_score')
    expect(result).toHaveProperty('propensity')
    expect(result).toHaveProperty('expected_revenue')
    expect(result).toHaveProperty('priority_tier')
    expect(result).toHaveProperty('priority_reason')
    expect(result.icp_score).toBeGreaterThan(0)
  })

  it('scores a good-fit company higher than a bad-fit company', () => {
    const good = computeCompositeScore(makeInput({ company: { industry: 'Logistics', employee_count: 1200 } }), mockConfig)
    const bad = computeCompositeScore(makeInput({ company: { industry: 'Software', employee_count: 10 } }), mockConfig)
    expect(good.propensity).toBeGreaterThan(bad.propensity)
  })

  it('handles empty inputs without crashing', () => {
    const result = computeCompositeScore(makeInput({ company: {} }), mockConfig)
    expect(result.propensity).toBeGreaterThanOrEqual(0)
    expect(result.priority_tier).toBeDefined()
  })

  it('applies urgency multiplier for immediate signals', () => {
    const withSignal = computeCompositeScore(
      makeInput({
        signals: [{
          id: 's1', tenant_id: 't', company_id: 'c', signal_type: 'hiring_surge',
          title: 'Test', description: null, source_url: null, source: 'apollo',
          relevance_score: 0.9, weight_multiplier: 1.2, recency_days: 1,
          weighted_score: 1.08, recommended_action: null, urgency: 'immediate',
          detected_at: new Date().toISOString(), expires_at: null,
          created_at: new Date().toISOString(),
        }],
      }),
      mockConfig
    )
    const without = computeCompositeScore(makeInput(), mockConfig)
    expect(withSignal.urgency_multiplier).toBeGreaterThan(without.urgency_multiplier)
  })
})
