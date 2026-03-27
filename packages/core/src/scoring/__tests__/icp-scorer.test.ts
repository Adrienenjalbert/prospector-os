import { describe, it, expect } from 'vitest'
import { computeICPScore, type ICPScorerInput } from '../icp-scorer'
import type { ICPConfig } from '../../types/config'

const testConfig: ICPConfig = {
  version: '1.0-test',
  business: 'indeed_flex',
  dimensions: [
    {
      name: 'industry_vertical',
      weight: 0.25,
      description: 'Industry match',
      data_source: 'industry',
      scoring_tiers: [
        { condition: 'in', values: ['Warehousing', 'Logistics', 'Manufacturing'], score: 100, label: 'Tier 1' },
        { condition: 'in', values: ['Hospitality', 'Facilities Management'], score: 80, label: 'Tier 2' },
        { condition: 'default', score: 15, label: 'Other' },
      ],
    },
    {
      name: 'company_size',
      weight: 0.20,
      description: 'Employee count',
      data_source: 'employee_count',
      scoring_tiers: [
        { condition: 'between', min: 500, max: 5000, score: 100, label: 'Sweet spot' },
        { condition: 'between', min: 250, max: 499, score: 80, label: 'Mid-market' },
        { condition: 'default', score: 10, label: 'Outside range' },
      ],
      disqualify_below: 50,
    },
    {
      name: 'geography',
      weight: 0.15,
      description: 'Location match',
      data_source: 'hq_location',
      operating_regions: {
        uk: ['London', 'Manchester', 'Birmingham'],
        us: ['Austin', 'Dallas'],
      },
      scoring_tiers: [
        { condition: 'locations_in_operating_regions', min_count: 3, score: 100, label: 'Multiple locations' },
        { condition: 'locations_in_operating_regions', min_count: 1, score: 70, label: 'One location' },
        { condition: 'hq_in_country', values: ['United Kingdom', 'United States'], score: 50, label: 'In-country' },
        { condition: 'default', score: 10, label: 'No presence' },
      ],
    },
    {
      name: 'temp_flex_usage',
      weight: 0.25,
      description: 'Evidence of temp/flex usage',
      data_source: 'industry',
      scoring_tiers: [
        { condition: 'high_turnover_industry', score: 40, label: 'Industry implies temp need' },
        { condition: 'default', score: 10, label: 'No evidence' },
      ],
    },
    {
      name: 'tech_ops_maturity',
      weight: 0.15,
      description: 'Tech adoption',
      data_source: 'technologies',
      scoring_tiers: [
        { condition: 'uses_any', values: ['Kronos', 'Deputy', 'When I Work'], score: 100, label: 'WFM tech' },
        { condition: 'uses_any', values: ['Workday', 'ADP'], score: 70, label: 'Enterprise HR' },
        { condition: 'default', score: 20, label: 'No HR tech' },
      ],
    },
  ],
  tier_thresholds: { A: 80, B: 60, C: 40, D: 0 },
  recalibration: {
    frequency_days: 90,
    method: 'compare_won_lost_cohorts',
    min_sample_size: 20,
  },
}

describe('computeICPScore', () => {
  it('scores a perfect-fit company as Tier A', () => {
    const company: ICPScorerInput = {
      industry: 'Warehousing',
      employee_count: 1200,
      hq_city: 'London',
      hq_country: 'United Kingdom',
      locations: [
        { city: 'London', country: 'United Kingdom' },
        { city: 'Manchester', country: 'United Kingdom' },
        { city: 'Birmingham', country: 'United Kingdom' },
      ],
      tech_stack: ['Kronos', 'SAP'],
    }

    const result = computeICPScore(company, testConfig)

    expect(result.score).toBeGreaterThanOrEqual(80)
    expect(result.tier).toBe('A')
    expect(result.dimensions).toHaveLength(5)
  })

  it('scores a weak-fit company as Tier C or D', () => {
    const company: ICPScorerInput = {
      industry: 'Software',
      employee_count: 30,
      hq_city: 'Berlin',
      hq_country: 'Germany',
      locations: [{ city: 'Berlin', country: 'Germany' }],
      tech_stack: [],
    }

    const result = computeICPScore(company, testConfig)

    expect(result.score).toBeLessThan(40)
    expect(result.tier).toBe('D')
  })

  it('caps score at 25 when disqualified', () => {
    const company: ICPScorerInput = {
      industry: 'Warehousing',
      employee_count: 10,
      hq_city: 'London',
      hq_country: 'United Kingdom',
      locations: [
        { city: 'London', country: 'United Kingdom' },
        { city: 'Manchester', country: 'United Kingdom' },
        { city: 'Birmingham', country: 'United Kingdom' },
      ],
      tech_stack: ['Kronos'],
    }

    const result = computeICPScore(company, testConfig)

    expect(result.score).toBeLessThanOrEqual(25)
  })

  it('assigns Tier B for mid-range scores', () => {
    const company: ICPScorerInput = {
      industry: 'Hospitality',
      employee_count: 300,
      hq_city: 'Edinburgh',
      hq_country: 'United Kingdom',
      locations: [],
      tech_stack: ['ADP'],
    }

    const result = computeICPScore(company, testConfig)

    expect(result.score).toBeGreaterThanOrEqual(40)
    expect(result.score).toBeLessThan(80)
    expect(['B', 'C']).toContain(result.tier)
  })

  it('includes top_reason with dimension detail', () => {
    const company: ICPScorerInput = {
      industry: 'Warehousing',
      employee_count: 1000,
      locations: [],
      tech_stack: [],
    }

    const result = computeICPScore(company, testConfig)

    expect(result.top_reason).toContain('industry_vertical')
    expect(result.config_version).toBe('1.0-test')
    expect(result.computed_at).toBeTruthy()
  })
})
