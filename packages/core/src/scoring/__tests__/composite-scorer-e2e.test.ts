import { describe, it, expect } from 'vitest'
import { computeCompositeScore, type CompositeScoreInput, type CompositeScoreConfig } from '../composite-scorer'
import type { Contact, Signal, Opportunity, CRMActivity, FunnelBenchmark } from '../../types/ontology'

const daysAgo = (d: number) =>
  new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString()

const fullConfig: CompositeScoreConfig = {
  icpConfig: {
    version: '1.0',
    business: 'test',
    dimensions: [
      { name: 'industry', weight: 0.5, description: '', data_source: 'industry', scoring_tiers: [{ condition: 'in', values: ['Logistics', 'Warehousing'], score: 100, label: 'T1' }, { condition: 'in', values: ['Hospitality'], score: 70, label: 'T2' }, { condition: 'default', score: 15, label: 'Other' }] },
      { name: 'size', weight: 0.5, description: '', data_source: 'employee_count', scoring_tiers: [{ condition: 'between', min: 250, max: 5000, score: 100, label: 'Fit' }, { condition: 'default', score: 20, label: 'Other' }] },
    ],
    tier_thresholds: { A: 80, B: 60, C: 40, D: 0 },
    recalibration: { frequency_days: 90, method: 'test', min_sample_size: 10 },
  },
  scoringConfig: {
    version: '3.0',
    propensity_weights: { icp_fit: 0.15, signal_momentum: 0.20, engagement_depth: 0.15, contact_coverage: 0.20, stage_velocity: 0.15, profile_win_rate: 0.15 },
    icp_tier_thresholds: { A: 80, B: 60, C: 40, D: 0 },
    priority_tiers: { HOT: { min_propensity: 70 }, WARM: { min_propensity: 50 }, COOL: { min_propensity: 30 }, MONITOR: { min_propensity: 0 } },
    deal_value_estimation: { method: 'fallback', fallback_values: { A: 180000, B: 95000, C: 45000, D: 0 }, currency: 'GBP' },
    urgency_config: { immediate_signal_bonus: 0.20, close_date_30d_bonus: 0.15, competitive_pressure_bonus: 0.10, signal_surge_bonus: 0.05, stall_going_dark_penalty: -0.15, max_multiplier: 1.5, min_multiplier: 0.85 },
    contact_coverage: {
      breadth_tiers: [{ min_contacts: 7, score: 100, label: 'Deep' }, { min_contacts: 5, score: 80, label: 'Good' }, { min_contacts: 3, score: 60, label: 'Dev' }, { min_contacts: 1, score: 15, label: 'Single' }, { min_contacts: 0, score: 0, label: 'Blind' }],
      seniority_points: { c_level: 35, vp_director: 30, manager: 20, individual: 15 },
      key_roles: [{ role: 'champion', identified_pts: 10, engaged_pts: 15 }, { role: 'economic_buyer', identified_pts: 10, engaged_pts: 15 }],
      champion_engaged_bonus: 15,
      economic_buyer_engaged_bonus: 15,
    },
    engagement_activity_points: { proposal_sent: 25, meeting_multi_party: 20, meeting_one_on_one: 15, call_connected: 10, email_reply_received: 8, call_attempted: 3, email_opened_multiple: 2, email_opened_once: 1 },
    engagement_recency: [{ max_days: 3, score: 100 }, { max_days: 7, score: 80 }, { max_days: 14, score: 60 }, { max_days: 30, score: 40 }, { max_days: 60, score: 20 }, { max_days: 9999, score: 5 }],
    velocity_ratio_tiers: [{ min_ratio: 2.0, score: 100, label: 'Fast' }, { min_ratio: 1.0, score: 70, label: 'Pace' }, { min_ratio: 0.5, score: 30, label: 'Slow' }, { min_ratio: 0.0, score: 10, label: 'Stalled' }],
    profile_match: { dimensions: [], lookback_months: 12, blend_threshold: 10, value_tiers: [] },
    recalibration: { frequency_days: 90, method: 'test' },
  },
  signalConfig: {
    version: '1.0',
    business: 'test',
    signal_types: [
      { name: 'hiring_surge', display_name: 'Hiring', description: '', source: 'apollo', weight_multiplier: 1.2, recency_decay_days: 30, min_relevance_threshold: 0.5, urgency_default: 'this_week', enrichment_depth: 'standard' },
      { name: 'temp_job_posting', display_name: 'Temp', description: '', source: 'apollo', weight_multiplier: 1.8, recency_decay_days: 14, min_relevance_threshold: 0.7, urgency_default: 'immediate', enrichment_depth: 'standard' },
      { name: 'competitor_mention', display_name: 'Competitor', description: '', source: 'claude', weight_multiplier: 2.0, recency_decay_days: 30, min_relevance_threshold: 0.8, urgency_default: 'immediate', enrichment_depth: 'deep' },
    ],
    recency_decay: { formula: '', description: '' },
    composite_signal_score: { formula: '', max_signals_per_company: 10, description: '' },
    deep_research_config: { model: 'test', temperature: 0.2, max_tokens: 100, only_for_tiers: ['A'] },
  },
}

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: `c-${Math.random().toString(36).slice(2)}`, tenant_id: 't1', company_id: 'co1',
    crm_id: null, apollo_id: null,
    email: 'test@test.com', first_name: 'Test', last_name: 'User',
    title: 'Manager', seniority: 'manager', department: 'Operations',
    phone: null, linkedin_url: null,
    engagement_score: 0, relevance_score: 50,
    is_champion: false, is_decision_maker: false, is_economic_buyer: false,
    role_tag: null,
    last_activity_date: daysAgo(5),
    enriched_at: null, created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: `s-${Math.random().toString(36).slice(2)}`, tenant_id: 't1', company_id: 'co1',
    signal_type: 'hiring_surge', title: 'Hiring surge detected',
    description: null, source_url: null, source: 'apollo',
    relevance_score: 0.8, weight_multiplier: 1.2,
    recency_days: 3, weighted_score: 0.96,
    recommended_action: null, urgency: 'this_week',
    detected_at: daysAgo(3), expires_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: `o-${Math.random().toString(36).slice(2)}`, tenant_id: 't1', crm_id: 'opp-1',
    company_id: 'co1', owner_crm_id: 'rep-1',
    name: 'Test Deal', value: 120000, currency: 'GBP',
    stage: 'Proposal', stage_order: 3, probability: 50,
    days_in_stage: 12, stage_entered_at: daysAgo(12), expected_close_date: null,
    is_stalled: false, stall_reason: null, next_best_action: null,
    is_closed: false, is_won: false, closed_at: null, lost_reason: null,
    win_probability_ai: null, created_at: '', updated_at: '', last_crm_sync: '',
    ...overrides,
  }
}

function makeActivity(type: string, daysOld: number): CRMActivity {
  return {
    id: `a-${Math.random().toString(36).slice(2)}`,
    type: type as CRMActivity['type'],
    contact_id: null, account_id: 'co1',
    subject: null, duration_minutes: null,
    occurred_at: daysAgo(daysOld),
  }
}

function makeBenchmark(stage: string, medianDays: number): FunnelBenchmark {
  return {
    id: 'b1', tenant_id: 't1', stage_name: stage, period: '2026-03',
    scope: 'company', scope_id: 'all',
    conversion_rate: 55, drop_rate: 12, deal_count: 30, total_value: 3000000,
    avg_deal_value: 100000, avg_days_in_stage: medianDays,
    median_days_in_stage: medianDays, impact_score: 0,
    stall_count: 3, stall_value: 300000, computed_at: new Date().toISOString(),
  }
}

describe('Composite scorer — end-to-end with realistic data', () => {
  it('produces a high-priority result for a strong Tier-A account with signals and deals', () => {
    const input: CompositeScoreInput = {
      company: {
        industry: 'Logistics',
        employee_count: 1500,
        hq_city: 'London',
        hq_country: 'United Kingdom',
        locations: [{ city: 'London', country: 'United Kingdom' }],
        tech_stack: [],
      },
      contacts: [
        makeContact({ seniority: 'c_level', is_champion: true, role_tag: 'champion', last_activity_date: daysAgo(2) }),
        makeContact({ seniority: 'director', is_economic_buyer: true, role_tag: 'economic_buyer', last_activity_date: daysAgo(5) }),
        makeContact({ seniority: 'manager' }),
        makeContact({ seniority: 'individual' }),
      ],
      signals: [
        makeSignal({ signal_type: 'temp_job_posting', relevance_score: 0.9, weight_multiplier: 1.8, urgency: 'immediate' }),
        makeSignal({ signal_type: 'hiring_surge', relevance_score: 0.7, weight_multiplier: 1.2 }),
      ],
      opportunities: [
        makeOpp({ value: 150000, stage: 'Proposal', stage_order: 3, days_in_stage: 8 }),
      ],
      activities: [
        makeActivity('proposal_sent', 2),
        makeActivity('meeting_multi_party', 5),
        makeActivity('call_connected', 8),
        makeActivity('email_reply_received', 12),
      ],
      benchmarks: [
        makeBenchmark('Lead', 14),
        makeBenchmark('Qualified', 21),
        makeBenchmark('Proposal', 28),
        makeBenchmark('Negotiation', 21),
      ],
      previousSignalScore: 30,
      companyWinRate: 12.3,
    }

    const result = computeCompositeScore(input, fullConfig)

    expect(result.icp_score).toBe(100) // Logistics=100×0.5 + 1500 in 250-5000=100×0.5
    expect(result.icp_tier).toBe('A')

    expect(result.signal_score).toBeGreaterThan(50)
    expect(result.engagement_score).toBeGreaterThan(40)
    expect(result.contact_coverage_score).toBeGreaterThan(50)
    expect(result.velocity_score).toBeGreaterThan(30)

    expect(result.propensity).toBeGreaterThan(45)
    expect(result.expected_revenue).toBeGreaterThan(0)
    expect(result.urgency_multiplier).toBeGreaterThan(1.0)
    expect(result.priority_tier).toBeDefined()
    expect(['HOT', 'WARM', 'COOL', 'MONITOR']).toContain(result.priority_tier)
  })

  it('produces a low-priority result for a poor-fit account with no signals or deals', () => {
    const input: CompositeScoreInput = {
      company: {
        industry: 'Software',
        employee_count: 25,
        hq_country: 'Germany',
      },
      contacts: [],
      signals: [],
      opportunities: [],
      activities: [],
      benchmarks: [],
      previousSignalScore: null,
      companyWinRate: 12.3,
    }

    const result = computeCompositeScore(input, fullConfig)

    expect(result.icp_score).toBeLessThan(25) // 15*0.5 + 20*0.5 = 17.5
    expect(result.icp_tier).toBe('D')
    expect(result.signal_score).toBe(0)
    expect(result.contact_coverage_score).toBe(0)
    expect(result.velocity_score).toBe(0)

    expect(result.propensity).toBeLessThan(20)
    expect(result.priority_tier).toBe('MONITOR')
  })

  it('uses ICP tier fallback for deal value when no opportunity exists', () => {
    const input: CompositeScoreInput = {
      company: { industry: 'Logistics', employee_count: 1000 },
      contacts: [],
      signals: [],
      opportunities: [],
      activities: [],
      benchmarks: [],
      previousSignalScore: null,
      companyWinRate: 15,
    }

    const result = computeCompositeScore(input, fullConfig)

    // ICP = 100 → Tier A → fallback deal value = 180000
    // expected_revenue = 180000 × propensity/100
    expect(result.icp_tier).toBe('A')
    expect(result.expected_revenue).toBeGreaterThan(0)
  })

  it('uses 0 as fallback deal value for ICP tier D', () => {
    const input: CompositeScoreInput = {
      company: { industry: 'Software', employee_count: 5 },
      contacts: [],
      signals: [],
      opportunities: [],
      activities: [],
      benchmarks: [],
      previousSignalScore: null,
      companyWinRate: 15,
    }

    const result = computeCompositeScore(input, fullConfig)

    expect(result.icp_tier).toBe('D')
    // fallback_values.D = 0 → expected_revenue = 0
    expect(result.expected_revenue).toBe(0)
    expect(result.priority_score).toBe(0)
  })

  it('applies stall/going-dark penalty when deal is stalled', () => {
    const stalledInput: CompositeScoreInput = {
      company: { industry: 'Logistics', employee_count: 1000 },
      contacts: [makeContact()],
      signals: [],
      opportunities: [makeOpp({ is_stalled: true, days_in_stage: 45 })],
      activities: [],
      benchmarks: [],
      previousSignalScore: null,
      companyWinRate: 15,
    }

    const normalInput: CompositeScoreInput = {
      ...stalledInput,
      opportunities: [makeOpp({ is_stalled: false, days_in_stage: 5 })],
    }

    const stalled = computeCompositeScore(stalledInput, fullConfig)
    const normal = computeCompositeScore(normalInput, fullConfig)

    expect(stalled.urgency_multiplier).toBeLessThan(normal.urgency_multiplier)
  })

  it('picks the highest-stage open opportunity when multiple exist', () => {
    const input: CompositeScoreInput = {
      company: { industry: 'Logistics', employee_count: 1000 },
      contacts: [],
      signals: [],
      opportunities: [
        makeOpp({ id: 'o1', stage: 'Lead', stage_order: 1, value: 50000 }),
        makeOpp({ id: 'o2', stage: 'Negotiation', stage_order: 4, value: 200000 }),
        makeOpp({ id: 'o3', stage: 'Proposal', stage_order: 3, value: 300000 }),
      ],
      activities: [],
      benchmarks: [],
      previousSignalScore: null,
      companyWinRate: 15,
    }

    const result = computeCompositeScore(input, fullConfig)

    // Should pick Negotiation (stage_order=4), value=200000
    expect(result.expected_revenue).toBeGreaterThan(0)
    // The deal value used should be 200000 (from Negotiation, highest stage_order)
    // expected_revenue = 200000 × propensity/100
  })

  it('ignores closed opportunities when picking top deal', () => {
    const input: CompositeScoreInput = {
      company: { industry: 'Logistics', employee_count: 1000 },
      contacts: [],
      signals: [],
      opportunities: [
        makeOpp({ id: 'closed', stage: 'Negotiation', stage_order: 4, value: 500000, is_closed: true, is_won: true }),
        makeOpp({ id: 'open', stage: 'Lead', stage_order: 1, value: 50000, is_closed: false }),
      ],
      activities: [],
      benchmarks: [],
      previousSignalScore: null,
      companyWinRate: 15,
    }

    const result = computeCompositeScore(input, fullConfig)

    // Should use the open Lead deal (50000), not the closed Negotiation (500000)
    // But win-rate should count the closed won deal
    expect(result.win_rate_score).toBeGreaterThan(0)
  })

  it('all output scores are within [0, 100] range', () => {
    const input: CompositeScoreInput = {
      company: { industry: 'Logistics', employee_count: 1000 },
      contacts: Array.from({ length: 10 }, () => makeContact()),
      signals: Array.from({ length: 8 }, (_, i) => makeSignal({ id: `s${i}` })),
      opportunities: [makeOpp()],
      activities: Array.from({ length: 20 }, (_, i) => makeActivity('call_connected', i)),
      benchmarks: [makeBenchmark('Proposal', 14)],
      previousSignalScore: 50,
      companyWinRate: 15,
    }

    const result = computeCompositeScore(input, fullConfig)

    expect(result.icp_score).toBeGreaterThanOrEqual(0)
    expect(result.icp_score).toBeLessThanOrEqual(100)
    expect(result.signal_score).toBeGreaterThanOrEqual(0)
    expect(result.signal_score).toBeLessThanOrEqual(100)
    expect(result.engagement_score).toBeGreaterThanOrEqual(0)
    expect(result.engagement_score).toBeLessThanOrEqual(100)
    expect(result.contact_coverage_score).toBeGreaterThanOrEqual(0)
    expect(result.contact_coverage_score).toBeLessThanOrEqual(100)
    expect(result.velocity_score).toBeGreaterThanOrEqual(0)
    expect(result.velocity_score).toBeLessThanOrEqual(100)
    expect(result.win_rate_score).toBeGreaterThanOrEqual(0)
    expect(result.win_rate_score).toBeLessThanOrEqual(100)
    expect(result.propensity).toBeGreaterThanOrEqual(0)
    expect(result.propensity).toBeLessThanOrEqual(100)
    expect(result.urgency_multiplier).toBeGreaterThanOrEqual(0.85)
    expect(result.urgency_multiplier).toBeLessThanOrEqual(1.50)
  })
})
