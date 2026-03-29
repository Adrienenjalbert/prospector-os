import { describe, it, expect } from 'vitest'
import { evaluateTriggers } from '../trigger-engine'
import type { Company, Opportunity, Signal, FunnelBenchmark } from '../../types/ontology'

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'c1', tenant_id: 't1', crm_id: 'sf-1', crm_source: 'salesforce',
    name: 'Test Co', domain: null, website: null, industry: null, industry_group: null,
    employee_count: null, employee_range: null, annual_revenue: null, revenue_range: null,
    founded_year: null, hq_city: null, hq_country: null, location_count: 1, locations: [],
    tech_stack: [], owner_crm_id: null, owner_name: null, owner_email: null,
    icp_score: 80, icp_tier: 'A', icp_dimensions: {}, signal_score: 50,
    engagement_score: 50, contact_coverage_score: 50, velocity_score: 50,
    win_rate_score: 50, propensity: 60, expected_revenue: 100000,
    priority_tier: 'WARM', priority_reason: 'Test', urgency_multiplier: 1.0,
    enriched_at: null, enrichment_source: null, enrichment_data: {},
    last_signal_check: null, icp_config_version: null,
    created_at: '', updated_at: '', last_activity_date: null, last_crm_sync: '',
    ...overrides,
  } as Company
}

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'o1', tenant_id: 't1', crm_id: 'opp-1', company_id: 'c1',
    owner_crm_id: 'rep-1', name: 'Deal', value: 100000, currency: 'GBP',
    stage: 'Proposal', stage_order: 3, probability: 50,
    days_in_stage: 5, stage_entered_at: null, expected_close_date: null,
    is_stalled: false, stall_reason: null, next_best_action: null,
    is_closed: false, is_won: false, closed_at: null, lost_reason: null,
    win_probability_ai: null, created_at: '', updated_at: '', last_crm_sync: '',
    ...overrides,
  } as Opportunity
}

describe('evaluateTriggers', () => {
  it('detects stalled deals', () => {
    const events = evaluateTriggers(
      {
        company: makeCompany(),
        opportunities: [makeOpp({ is_stalled: true, days_in_stage: 25 })],
        signals: [],
        repBenchmarks: [],
        companyBenchmarks: [],
        previousScores: null,
      },
      't1', 'rep-1'
    )
    expect(events.some(e => e.trigger_type === 'deal_stall')).toBe(true)
  })

  it('detects immediate signals', () => {
    const signal: Signal = {
      id: 's1', tenant_id: 't1', company_id: 'c1',
      signal_type: 'hiring_surge', title: 'Hiring',
      description: null, source_url: null, source: 'apollo',
      relevance_score: 0.9, weight_multiplier: 1.2, recency_days: 1,
      weighted_score: 1.08, recommended_action: null, urgency: 'immediate',
      detected_at: new Date().toISOString(), expires_at: null,
      created_at: new Date().toISOString(),
    }
    const events = evaluateTriggers(
      { company: makeCompany(), opportunities: [], signals: [signal], repBenchmarks: [], companyBenchmarks: [], previousScores: null },
      't1', 'rep-1'
    )
    expect(events.some(e => e.trigger_type === 'signal_detected')).toBe(true)
  })

  it('detects priority tier shifts', () => {
    const events = evaluateTriggers(
      {
        company: makeCompany({ priority_tier: 'HOT', expected_revenue: 200000 }),
        opportunities: [], signals: [], repBenchmarks: [], companyBenchmarks: [],
        previousScores: { priority_tier: 'COOL', expected_revenue: 50000 },
      },
      't1', 'rep-1'
    )
    expect(events.some(e => e.trigger_type === 'priority_shift')).toBe(true)
  })

  it('returns empty when nothing triggers', () => {
    const events = evaluateTriggers(
      { company: makeCompany(), opportunities: [makeOpp()], signals: [], repBenchmarks: [], companyBenchmarks: [], previousScores: null },
      't1', 'rep-1'
    )
    expect(events).toHaveLength(0)
  })
})
