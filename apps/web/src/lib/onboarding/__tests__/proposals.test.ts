import { describe, expect, it } from 'vitest'
import {
  buildFunnelProposal,
  buildIcpProposal,
  type CompanyForAnalysis,
  type OpportunityForAnalysis,
} from '../proposals'

/**
 * Tests for the onboarding proposal derivation. These functions feed the
 * /onboarding wizard's ICP and Funnel steps, so a regression here writes
 * bad config into `tenants.icp_config` / `funnel_config` for every new
 * tenant. The MISSION promises proposals derived from real data — these
 * tests pin the empty / partial / well-populated branches.
 */

describe('buildIcpProposal', () => {
  it('falls back to defaults with fewer than 3 won deals', () => {
    const wonOpps: OpportunityForAnalysis[] = [{ is_won: true }, { is_won: true }]
    const result = buildIcpProposal(wonOpps, [], [])
    expect(result.source).toBe('default')
    expect(result.config.dimensions.length).toBeGreaterThanOrEqual(5)
    // Default tier thresholds are sane.
    expect(result.config.tier_thresholds).toEqual({ A: 80, B: 60, C: 40, D: 0 })
  })

  it('falls back to defaults with fewer than 3 won companies even if many wins', () => {
    const result = buildIcpProposal(
      [{ is_won: true }, { is_won: true }, { is_won: true }, { is_won: true }],
      [{ industry: 'Logistics' }],
      [{ industry: 'Logistics' }, { industry: 'Logistics' }],
    )
    expect(result.source).toBe('default')
  })

  it('derives ICP dimensions from won-deal patterns when there is enough history', () => {
    const wonCompanies: CompanyForAnalysis[] = [
      { industry: 'Logistics', employee_count: 800, hq_country: 'GB', annual_revenue: 50_000_000 },
      { industry: 'Logistics', employee_count: 1200, hq_country: 'GB', annual_revenue: 80_000_000 },
      { industry: 'Manufacturing', employee_count: 600, hq_country: 'GB', annual_revenue: 30_000_000 },
      { industry: 'Logistics', employee_count: 1500, hq_country: 'US', annual_revenue: 120_000_000 },
    ]
    const wonOpps: OpportunityForAnalysis[] = wonCompanies.map(() => ({ is_won: true }))
    const allCompanies: CompanyForAnalysis[] = [...wonCompanies, { industry: 'Retail' }, { industry: 'Other' }]

    const result = buildIcpProposal(wonOpps, allCompanies, wonCompanies)

    expect(result.source).toBe('derived')
    expect(result.analysis?.won_deals_analyzed).toBe(4)
    expect(result.analysis?.top_winning_industries[0]).toBe('Logistics')
    expect(result.analysis?.top_winning_countries[0]).toBe('GB')
    expect(result.analysis?.median_winning_company_size).toBeGreaterThan(500)

    const industry = result.config.dimensions.find((d) => d.name === 'industry')
    expect(industry).toBeDefined()
    const coreTier = industry?.scoring_tiers.find((t) => t.label === 'Core industry')
    expect(coreTier?.conditions?.[0].value).toContain('Logistics')
  })

  it('produces dimension weights that sum to 1.0', () => {
    const result = buildIcpProposal([], [], [])
    const sum = result.config.dimensions.reduce((s, d) => s + d.weight, 0)
    // Float tolerance — exact 1.0 is the contract but we allow rounding drift.
    expect(Math.abs(sum - 1)).toBeLessThan(0.001)
  })
})

describe('buildFunnelProposal', () => {
  it('falls back to defaults when there are no opportunities', () => {
    const result = buildFunnelProposal([])
    expect(result.source).toBe('default')
    expect(result.config.stages.map((s) => s.name)).toEqual([
      'Lead',
      'Qualified',
      'Proposal',
      'Negotiation',
    ])
  })

  it('falls back to defaults when every opportunity has a null stage', () => {
    const result = buildFunnelProposal([
      { stage: null },
      { stage: null },
      { stage: null },
    ] as OpportunityForAnalysis[])
    expect(result.source).toBe('default')
  })

  it('derives stages from observed opportunities and computes median days', () => {
    const opps: OpportunityForAnalysis[] = [
      { stage: 'Discovery', stage_order: 1, days_in_stage: 5 },
      { stage: 'Discovery', stage_order: 1, days_in_stage: 10 },
      { stage: 'Discovery', stage_order: 1, days_in_stage: 15 },
      { stage: 'Proposal', stage_order: 3, days_in_stage: 20 },
      { stage: 'Proposal', stage_order: 3, days_in_stage: 30 },
    ]
    const result = buildFunnelProposal(opps)
    expect(result.source).toBe('derived')
    expect(result.analysis?.total_deals).toBe(5)
    expect(result.config.stages.map((s) => s.name)).toEqual(['Discovery', 'Proposal'])
    const discovery = result.config.stages.find((s) => s.name === 'Discovery')!
    expect(discovery.expected_velocity_days).toBe(10) // median of [5, 10, 15]
  })

  it('orders stages by CRM stage_order, not by Postgres iteration order', () => {
    // Input order is shuffled deliberately; expected output is sorted by
    // stage_order ascending so the wizard renders Lead → Qualified → ...
    const opps: OpportunityForAnalysis[] = [
      { stage: 'Negotiation', stage_order: 4 },
      { stage: 'Lead', stage_order: 1 },
      { stage: 'Proposal', stage_order: 3 },
      { stage: 'Qualified', stage_order: 2 },
    ]
    const result = buildFunnelProposal(opps)
    expect(result.config.stages.map((s) => s.name)).toEqual([
      'Lead',
      'Qualified',
      'Proposal',
      'Negotiation',
    ])
  })

  it('falls back to first-observed order when stage_order is missing', () => {
    // Without CRM order, stable on first-seen ordering — better than the
    // previous Set-iteration behaviour which depended on input row order.
    const opps: OpportunityForAnalysis[] = [
      { stage: 'A' },
      { stage: 'B' },
      { stage: 'A' }, // duplicate, should not change order
      { stage: 'C' },
    ]
    const result = buildFunnelProposal(opps)
    expect(result.config.stages.map((s) => s.name)).toEqual(['A', 'B', 'C'])
  })

  it('classifies stage_type heuristically from stage name', () => {
    const opps: OpportunityForAnalysis[] = [
      { stage: 'Discovery', stage_order: 1 },
      { stage: 'Closed Won', stage_order: 5 },
      { stage: 'Closed Lost', stage_order: 6 },
    ]
    const result = buildFunnelProposal(opps)
    const byName = Object.fromEntries(result.config.stages.map((s) => [s.name, s.stage_type]))
    expect(byName['Discovery']).toBe('active')
    expect(byName['Closed Won']).toBe('closed_won')
    expect(byName['Closed Lost']).toBe('closed_lost')
  })
})
