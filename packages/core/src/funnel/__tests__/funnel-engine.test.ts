import { describe, it, expect } from 'vitest'
import { computeBenchmarks, type BenchmarkInput } from '../benchmark-engine'
import { computeImpactScores } from '../impact-scorer'
import { detectStalls } from '../stall-detector'
import { computeForecast } from '../forecast'
import type { Opportunity, FunnelBenchmark } from '../../types/ontology'
import type { FunnelConfig } from '../../types/config'

const STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation']

const funnelConfig: FunnelConfig = {
  version: '1.0',
  business: 'test',
  stages: [
    { name: 'Lead', order: 1, crm_field_value: 'Lead', stage_type: 'top_of_funnel', expected_velocity_days: 14, stall_multiplier: 1.5, description: '' },
    { name: 'Qualified', order: 2, crm_field_value: 'Qualified', stage_type: 'qualification', expected_velocity_days: 21, stall_multiplier: 1.5, description: '' },
    { name: 'Proposal', order: 3, crm_field_value: 'Proposal', stage_type: 'proposal', expected_velocity_days: 28, stall_multiplier: 1.5, description: '' },
    { name: 'Negotiation', order: 4, crm_field_value: 'Negotiation', stage_type: 'negotiation', expected_velocity_days: 21, stall_multiplier: 2.0, description: '' },
    { name: 'Closed Won', order: 5, crm_field_value: 'Closed Won', stage_type: 'closed_won', expected_velocity_days: null, stall_multiplier: null, description: '' },
    { name: 'Closed Lost', order: -1, crm_field_value: 'Closed Lost', stage_type: 'closed_lost', expected_velocity_days: null, stall_multiplier: null, description: '' },
  ],
  benchmark_config: {
    rolling_window_days: 90, refresh_frequency: 'weekly',
    min_deals_for_valid_benchmark: 20,
    scopes: ['company', 'rep'],
    drift_alert_threshold_points: 5, drift_alert_window_weeks: 4,
  },
  stall_config: {
    default_multiplier: 1.5, alert_cooldown_days: 7,
    escalation_multiplier: 2.5, escalation_action: 'Flag for manager',
  },
  impact_score: { formula: '', description: '' },
  drop_volume_matrix: {
    high_drop_high_volume: { label: 'CRITICAL', action: '' },
    high_drop_low_volume: { label: 'MONITOR', action: '' },
    low_drop_high_volume: { label: 'OPPORTUNITY', action: '' },
    low_drop_low_volume: { label: 'HEALTHY', action: '' },
  },
  high_drop_threshold_pts: 5,
}

function makeOpp(overrides: Partial<Opportunity>): Opportunity {
  return {
    id: `o-${Math.random().toString(36).slice(2)}`,
    tenant_id: 't1', crm_id: `crm-${Math.random()}`,
    company_id: 'c1', owner_crm_id: 'rep-1',
    name: 'Deal', value: 100000, currency: 'GBP',
    stage: 'Proposal', stage_order: 3, probability: 50,
    days_in_stage: 10, stage_entered_at: null, expected_close_date: null,
    is_stalled: false, stall_reason: null, next_best_action: null,
    is_closed: false, is_won: false, closed_at: null, lost_reason: null,
    win_probability_ai: null, created_at: '', updated_at: '', last_crm_sync: '',
    ...overrides,
  }
}

function makeBenchmark(stage: string, overrides: Partial<FunnelBenchmark> = {}): FunnelBenchmark {
  return {
    id: 'b1', tenant_id: 't1', stage_name: stage, period: '2026-03',
    scope: 'company', scope_id: 'all',
    conversion_rate: 50, drop_rate: 10, deal_count: 20,
    total_value: 2000000, avg_deal_value: 100000,
    avg_days_in_stage: 14, median_days_in_stage: 14,
    impact_score: 0, stall_count: 2, stall_value: 200000,
    computed_at: new Date().toISOString(),
    ...overrides,
  }
}

// ─── BENCHMARK ENGINE ────────────────────────────────────────

describe('computeBenchmarks', () => {
  it('computes conversion rate as deals-advanced / deals-at-stage', () => {
    const opps: Opportunity[] = [
      makeOpp({ stage: 'Qualified', stage_order: 2, days_in_stage: 10, is_closed: false }),
      makeOpp({ stage: 'Proposal', stage_order: 3, days_in_stage: 5, is_closed: false }),
      makeOpp({ stage: 'Qualified', stage_order: 2, days_in_stage: 15, is_closed: true, is_won: false }),
    ]

    const results = computeBenchmarks({
      opportunities: opps, scope: 'company', scope_id: 'all',
      period: '2026-03', stages: STAGES,
    })

    const leadBench = results.find(b => b.stage_name === 'Lead')!
    // All 3 deals reached Lead (stage_order >= 1)
    // 3 deals advanced past Lead (stage_order > 0 for Lead at idx 0): all 3
    expect(leadBench.deal_count).toBe(3)
    expect(leadBench.conversion_rate).toBe(100) // all 3 advanced past Lead

    const qualifiedBench = results.find(b => b.stage_name === 'Qualified')!
    // 3 deals reached Qualified (stage_order >= 2): all 3 have stage_order ≥ 2
    // 1 advanced past (at Proposal, order 3), 1 closed-lost at Qualified (didn't advance)
    // 1 is still at Qualified (not advanced, not dropped)
    expect(qualifiedBench.deal_count).toBe(3)
    expect(qualifiedBench.conversion_rate).toBeCloseTo(33.33, 1) // 1/3
    expect(qualifiedBench.drop_rate).toBeCloseTo(33.33, 1) // 1/3 closed-lost
  })

  it('computes median days correctly for even and odd counts', () => {
    const opps: Opportunity[] = [
      makeOpp({ stage: 'Lead', stage_order: 1, days_in_stage: 5 }),
      makeOpp({ stage: 'Lead', stage_order: 1, days_in_stage: 10 }),
      makeOpp({ stage: 'Lead', stage_order: 1, days_in_stage: 20 }),
    ]

    const results = computeBenchmarks({
      opportunities: opps, scope: 'company', scope_id: 'all',
      period: '2026-03', stages: ['Lead'],
    })

    expect(results[0].median_days_in_stage).toBe(10) // odd count: middle value
    expect(results[0].avg_days_in_stage).toBeCloseTo(11.67, 1)
  })

  it('returns zero metrics for a stage with no deals', () => {
    const results = computeBenchmarks({
      opportunities: [], scope: 'company', scope_id: 'all',
      period: '2026-03', stages: ['Lead', 'Qualified'],
    })

    for (const b of results) {
      expect(b.deal_count).toBe(0)
      expect(b.conversion_rate).toBe(0)
      expect(b.drop_rate).toBe(0)
      expect(b.avg_days_in_stage).toBe(0)
      expect(b.median_days_in_stage).toBe(0)
    }
  })

  it('counts closed-won deals as having advanced through their stage', () => {
    const opps: Opportunity[] = [
      makeOpp({ stage: 'Negotiation', stage_order: 4, is_closed: true, is_won: true, days_in_stage: 12 }),
    ]

    const results = computeBenchmarks({
      opportunities: opps, scope: 'company', scope_id: 'all',
      period: '2026-03', stages: STAGES,
    })

    const negoBench = results.find(b => b.stage_name === 'Negotiation')!
    // Won at Negotiation → stageAdvanced returns true (is_won && currentIdx >= targetIdx)
    expect(negoBench.conversion_rate).toBe(100)
    expect(negoBench.drop_rate).toBe(0)
  })

  it('excludes stage_order <= 0 from calculations', () => {
    const opps: Opportunity[] = [
      makeOpp({ stage: 'Closed Lost', stage_order: -1, is_closed: true, is_won: false }),
      makeOpp({ stage: 'Lead', stage_order: 1, days_in_stage: 5 }),
    ]

    const results = computeBenchmarks({
      opportunities: opps, scope: 'company', scope_id: 'all',
      period: '2026-03', stages: ['Lead'],
    })

    // Only 1 deal should be counted (Lead), not Closed Lost
    expect(results[0].deal_count).toBe(1)
  })
})

// ─── IMPACT SCORER ───────────────────────────────────────────

describe('computeImpactScores', () => {
  it('matches PRD formula: |delta_drop| × deal_count × avg_deal_value', () => {
    const rep = [makeBenchmark('Proposal', { scope: 'rep', scope_id: 'r1', drop_rate: 25, deal_count: 10, avg_deal_value: 80000 })]
    const company = [makeBenchmark('Proposal', { drop_rate: 10, deal_count: 30, avg_deal_value: 100000 })]

    const results = computeImpactScores(rep, company, 5)

    // delta = 25-10 = 15, impact = |15| × 10 × 80000 = 12,000,000
    expect(results[0].impact_score).toBe(12000000)
    expect(results[0].delta_drop).toBe(15)
  })

  it('assigns CRITICAL when high drop + high volume', () => {
    const rep = [makeBenchmark('Proposal', { scope: 'rep', scope_id: 'r1', drop_rate: 20, deal_count: 25 })]
    const company = [makeBenchmark('Proposal', { drop_rate: 10, deal_count: 20 })]

    const results = computeImpactScores(rep, company, 5)
    // delta=10 (≥5), rep.deal_count=25 ≥ company.deal_count=20
    expect(results[0].status).toBe('CRITICAL')
  })

  it('assigns MONITOR when high drop + low volume', () => {
    const rep = [makeBenchmark('Proposal', { scope: 'rep', scope_id: 'r1', drop_rate: 20, deal_count: 5 })]
    const company = [makeBenchmark('Proposal', { drop_rate: 10, deal_count: 20 })]

    const results = computeImpactScores(rep, company, 5)
    // delta=10 (≥5), rep.deal_count=5 < company.deal_count=20
    expect(results[0].status).toBe('MONITOR')
  })

  it('assigns OPPORTUNITY when low drop + high volume', () => {
    const rep = [makeBenchmark('Proposal', { scope: 'rep', scope_id: 'r1', drop_rate: 8, deal_count: 25 })]
    const company = [makeBenchmark('Proposal', { drop_rate: 10, deal_count: 20 })]

    const results = computeImpactScores(rep, company, 5)
    // delta=-2 (<5), rep.deal_count=25 ≥ 20
    expect(results[0].status).toBe('OPPORTUNITY')
  })

  it('assigns HEALTHY when low drop + low volume', () => {
    const rep = [makeBenchmark('Proposal', { scope: 'rep', scope_id: 'r1', drop_rate: 8, deal_count: 5 })]
    const company = [makeBenchmark('Proposal', { drop_rate: 10, deal_count: 20 })]

    const results = computeImpactScores(rep, company, 5)
    expect(results[0].status).toBe('HEALTHY')
  })

  it('sorts results by impact_score descending', () => {
    const rep = [
      makeBenchmark('Lead', { scope: 'rep', scope_id: 'r1', drop_rate: 30, deal_count: 5, avg_deal_value: 50000 }),
      makeBenchmark('Proposal', { scope: 'rep', scope_id: 'r1', drop_rate: 40, deal_count: 10, avg_deal_value: 100000 }),
    ]
    const company = [
      makeBenchmark('Lead', { drop_rate: 10 }),
      makeBenchmark('Proposal', { drop_rate: 10 }),
    ]

    const results = computeImpactScores(rep, company, 5)
    expect(results[0].stage_name).toBe('Proposal') // higher impact
    expect(results[0].impact_score).toBeGreaterThan(results[1].impact_score)
  })

  it('handles missing company benchmark by using 0 drop rate', () => {
    const rep = [makeBenchmark('Proposal', { scope: 'rep', scope_id: 'r1', drop_rate: 20, deal_count: 10, avg_deal_value: 80000 })]

    const results = computeImpactScores(rep, [], 5)
    // delta = 20-0 = 20, impact = 20 × 10 × 80000 = 16,000,000
    expect(results[0].delta_drop).toBe(20)
    expect(results[0].impact_score).toBe(16000000)
  })
})

// ─── STALL DETECTOR ──────────────────────────────────────────

describe('detectStalls', () => {
  it('flags a deal as stalled when days > 1.5 × median', () => {
    const opps = [makeOpp({ stage: 'Proposal', days_in_stage: 25, is_closed: false })]
    const benchmarks = [makeBenchmark('Proposal', { median_days_in_stage: 14 })]

    const results = detectStalls(opps, benchmarks, funnelConfig)

    // threshold = 14 × 1.5 = 21, 25 > 21 → stalled
    expect(results[0].is_stalled).toBe(true)
    expect(results[0].threshold_days).toBe(21)
    expect(results[0].severity).toBe('warning')
    expect(results[0].stall_reason).toContain('25 days at Proposal')
  })

  it('does not flag a deal within threshold', () => {
    const opps = [makeOpp({ stage: 'Proposal', days_in_stage: 20, is_closed: false })]
    const benchmarks = [makeBenchmark('Proposal', { median_days_in_stage: 14 })]

    const results = detectStalls(opps, benchmarks, funnelConfig)

    // threshold = 14 × 1.5 = 21, 20 ≤ 21 → not stalled
    expect(results[0].is_stalled).toBe(false)
    expect(results[0].severity).toBe('none')
    expect(results[0].stall_reason).toBeNull()
  })

  it('assigns critical severity when days > escalation multiplier', () => {
    const opps = [makeOpp({ stage: 'Proposal', days_in_stage: 40, is_closed: false })]
    const benchmarks = [makeBenchmark('Proposal', { median_days_in_stage: 14 })]

    const results = detectStalls(opps, benchmarks, funnelConfig)

    // stall threshold = 14 × 1.5 = 21 → stalled
    // escalation threshold = 14 × 2.5 = 35, 40 > 35 → critical
    expect(results[0].is_stalled).toBe(true)
    expect(results[0].severity).toBe('critical')
  })

  it('uses per-stage multiplier from config', () => {
    // Negotiation has stall_multiplier: 2.0 in our test config
    const opps = [makeOpp({ stage: 'Negotiation', stage_order: 4, days_in_stage: 25, is_closed: false })]
    const benchmarks = [makeBenchmark('Negotiation', { median_days_in_stage: 14 })]

    const results = detectStalls(opps, benchmarks, funnelConfig)

    // threshold = 14 × 2.0 = 28, 25 ≤ 28 → NOT stalled
    expect(results[0].is_stalled).toBe(false)
    expect(results[0].stall_multiplier).toBe(2.0)
    expect(results[0].threshold_days).toBe(28)
  })

  it('falls back to expected_velocity_days when no benchmark exists', () => {
    const opps = [makeOpp({ stage: 'Lead', stage_order: 1, days_in_stage: 25, is_closed: false })]

    const results = detectStalls(opps, [], funnelConfig)

    // No benchmark → expected_velocity_days for Lead = 14
    // threshold = 14 × 1.5 = 21, 25 > 21 → stalled
    expect(results[0].is_stalled).toBe(true)
    expect(results[0].median_days).toBe(14)
  })

  it('falls back to hardcoded 14 when no benchmark and no stage config', () => {
    const configNoStages: FunnelConfig = { ...funnelConfig, stages: [] }
    const opps = [makeOpp({ stage: 'Unknown', stage_order: 1, days_in_stage: 25, is_closed: false })]

    const results = detectStalls(opps, [], configNoStages)

    expect(results[0].median_days).toBe(14)
    // threshold = 14 × 1.5 = 21
    expect(results[0].is_stalled).toBe(true)
  })

  it('ignores closed deals', () => {
    const opps = [
      makeOpp({ id: 'open', stage: 'Proposal', days_in_stage: 30, is_closed: false }),
      makeOpp({ id: 'closed', stage: 'Proposal', days_in_stage: 60, is_closed: true, is_won: false }),
    ]
    const benchmarks = [makeBenchmark('Proposal', { median_days_in_stage: 14 })]

    const results = detectStalls(opps, benchmarks, funnelConfig)

    expect(results).toHaveLength(1) // only the open deal
    expect(results[0].opportunity_id).toBe('open')
  })

  it('appends existing stall_reason from opportunity', () => {
    const opps = [makeOpp({
      stage: 'Proposal', days_in_stage: 30, is_closed: false,
      stall_reason: 'Decision-maker on holiday',
    })]
    const benchmarks = [makeBenchmark('Proposal', { median_days_in_stage: 14 })]

    const results = detectStalls(opps, benchmarks, funnelConfig)

    expect(results[0].stall_reason).toContain('Decision-maker on holiday')
    expect(results[0].stall_reason).toContain('30 days at Proposal')
  })
})

// ─── FORECAST ────────────────────────────────────────────────

describe('computeForecast', () => {
  it('aggregates pipeline by priority tier', () => {
    const result = computeForecast({
      accounts: [
        { expected_revenue: 100000, priority_tier: 'HOT', propensity: 80 },
        { expected_revenue: 50000, priority_tier: 'WARM', propensity: 55 },
        { expected_revenue: 20000, priority_tier: 'COOL', propensity: 35 },
        { expected_revenue: 5000, priority_tier: 'MONITOR', propensity: 15 },
      ],
    })

    expect(result.total_pipeline).toBe(175000)
    expect(result.hot_value).toBe(100000)
    expect(result.warm_value).toBe(50000)
    expect(result.cool_value).toBe(20000)
    expect(result.deal_count).toBe(4)
    expect(result.avg_propensity).toBe(46.25) // (80+55+35+15)/4
  })

  it('handles empty accounts', () => {
    const result = computeForecast({ accounts: [] })

    expect(result.total_pipeline).toBe(0)
    expect(result.weighted_pipeline).toBe(0)
    expect(result.deal_count).toBe(0)
    expect(result.avg_propensity).toBe(0)
  })

  it('excludes MONITOR tier from hot/warm/cool buckets', () => {
    const result = computeForecast({
      accounts: [
        { expected_revenue: 10000, priority_tier: 'MONITOR', propensity: 10 },
      ],
    })

    expect(result.total_pipeline).toBe(10000)
    expect(result.hot_value).toBe(0)
    expect(result.warm_value).toBe(0)
    expect(result.cool_value).toBe(0)
  })
})

// ─── END-TO-END: BENCHMARKS → IMPACT → STALLS ───────────────

describe('Funnel engine end-to-end', () => {
  it('computes benchmarks, detects stalls, and scores impact in sequence', () => {
    const opps: Opportunity[] = [
      makeOpp({ id: 'o1', owner_crm_id: 'r1', stage: 'Negotiation', stage_order: 4, days_in_stage: 8, value: 200000 }),
      makeOpp({ id: 'o2', owner_crm_id: 'r1', stage: 'Proposal', stage_order: 3, days_in_stage: 35, value: 120000 }),
      makeOpp({ id: 'o3', owner_crm_id: 'r1', stage: 'Proposal', stage_order: 3, days_in_stage: 10, value: 80000 }),
      makeOpp({ id: 'o4', owner_crm_id: 'r1', stage: 'Qualified', stage_order: 2, days_in_stage: 5, value: 60000 }),
      makeOpp({ id: 'o5', owner_crm_id: 'r1', stage: 'Lead', stage_order: 1, days_in_stage: 3, value: 40000 }),
      makeOpp({ id: 'lost1', owner_crm_id: 'r1', stage: 'Proposal', stage_order: 3, days_in_stage: 20, value: 90000, is_closed: true, is_won: false }),
      makeOpp({ id: 'won1', owner_crm_id: 'r1', stage: 'Negotiation', stage_order: 4, days_in_stage: 15, value: 150000, is_closed: true, is_won: true }),
    ]

    // Step 1: Compute company benchmarks
    const companyBenchmarks = computeBenchmarks({
      opportunities: opps, scope: 'company', scope_id: 'all',
      period: '2026-03', stages: STAGES,
    })
    expect(companyBenchmarks).toHaveLength(4)
    for (const b of companyBenchmarks) {
      expect(b.conversion_rate).toBeGreaterThanOrEqual(0)
      expect(b.conversion_rate).toBeLessThanOrEqual(100)
      expect(b.drop_rate).toBeGreaterThanOrEqual(0)
    }

    // Step 2: Compute rep benchmarks (same data since it's one rep)
    const repBenchmarks = computeBenchmarks({
      opportunities: opps, scope: 'rep', scope_id: 'r1',
      period: '2026-03', stages: STAGES,
    })

    // Step 3: Compute impact scores (rep vs company)
    const impacts = computeImpactScores(
      repBenchmarks as FunnelBenchmark[],
      companyBenchmarks as FunnelBenchmark[],
      5,
    )
    expect(impacts).toHaveLength(4)
    for (const i of impacts) {
      expect(i.impact_score).toBeGreaterThanOrEqual(0)
      expect(['CRITICAL', 'MONITOR', 'OPPORTUNITY', 'HEALTHY']).toContain(i.status)
    }

    // Step 4: Detect stalls using the computed benchmarks
    const stalls = detectStalls(opps, companyBenchmarks as FunnelBenchmark[], funnelConfig)
    // o2 has 35 days at Proposal; median will be derived from the 3 Proposal deals
    const o2Stall = stalls.find(s => s.opportunity_id === 'o2')
    expect(o2Stall).toBeDefined()
    // With 3 Proposal deals having days [35, 10, 20], median = 20
    // threshold = 20 × 1.5 = 30, 35 > 30 → stalled
    expect(o2Stall!.is_stalled).toBe(true)

    // o3 has 10 days at Proposal, well within threshold
    const o3Stall = stalls.find(s => s.opportunity_id === 'o3')
    expect(o3Stall!.is_stalled).toBe(false)
  })
})
