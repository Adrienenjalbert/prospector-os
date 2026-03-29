import { describe, it, expect } from 'vitest'
import { computeICPScore, type ICPScorerInput } from '../icp-scorer'
import type { ICPConfig } from '../../types/config'

const minimalConfig: ICPConfig = {
  version: '1.0-test',
  business: 'test',
  dimensions: [
    {
      name: 'industry',
      weight: 0.5,
      description: 'Industry match',
      data_source: 'industry',
      scoring_tiers: [
        { condition: 'in', values: ['Logistics'], score: 100, label: 'Match' },
        { condition: 'default', score: 20, label: 'Other' },
      ],
    },
    {
      name: 'size',
      weight: 0.5,
      description: 'Size',
      data_source: 'employee_count',
      scoring_tiers: [
        { condition: 'between', min: 500, max: 5000, score: 100, label: 'Fit' },
        { condition: 'default', score: 20, label: 'Other' },
      ],
    },
  ],
  tier_thresholds: { A: 80, B: 60, C: 40, D: 0 },
  recalibration: { frequency_days: 90, method: 'test', min_sample_size: 10 },
}

describe('ICP scorer — boundary conditions', () => {
  it('assigns Tier A at exactly 80 (not B)', () => {
    // industry=Logistics → 100*0.5=50, size=60pts → 60*0.5=30 → total=80
    // Need a config that produces exactly 80
    const config: ICPConfig = {
      ...minimalConfig,
      dimensions: [
        {
          name: 'dim1',
          weight: 1.0,
          description: 'All weight here',
          data_source: 'industry',
          scoring_tiers: [
            { condition: 'in', values: ['Logistics'], score: 80, label: 'Exact 80' },
            { condition: 'default', score: 0, label: 'None' },
          ],
        },
      ],
    }
    const result = computeICPScore({ industry: 'Logistics' }, config)
    expect(result.score).toBe(80)
    expect(result.tier).toBe('A')
  })

  it('assigns Tier B at 79.99 (just below A)', () => {
    const config: ICPConfig = {
      ...minimalConfig,
      dimensions: [
        {
          name: 'dim1',
          weight: 0.7999,
          description: '',
          data_source: 'industry',
          scoring_tiers: [
            { condition: 'in', values: ['Logistics'], score: 100, label: 'Match' },
            { condition: 'default', score: 0, label: 'None' },
          ],
        },
      ],
    }
    const result = computeICPScore({ industry: 'Logistics' }, config)
    // 100 * 0.7999 = 79.99
    expect(result.score).toBeLessThan(80)
    expect(result.tier).toBe('B')
  })

  it('handles null industry gracefully (falls to default tier)', () => {
    const result = computeICPScore({ industry: null, employee_count: 1000 }, minimalConfig)
    // industry=null → 'in' check returns false → default=20 → 20*0.5=10
    // size=1000 → between 500-5000 → 100*0.5=50 → total=60 → Tier B
    expect(result.score).toBe(60)
    expect(result.tier).toBe('B')
  })

  it('handles undefined employee_count gracefully', () => {
    const result = computeICPScore({ industry: 'Logistics' }, minimalConfig)
    // industry=Logistics → 100*0.5=50
    // employee_count=undefined → between check returns false → default=20 → 20*0.5=10
    // total=60 → Tier B
    expect(result.score).toBe(60)
    expect(result.tier).toBe('B')
  })

  it('handles empty dimensions config', () => {
    const emptyConfig: ICPConfig = {
      ...minimalConfig,
      dimensions: [],
    }
    const result = computeICPScore({ industry: 'Logistics' }, emptyConfig)
    expect(result.score).toBe(0)
    expect(result.tier).toBe('D')
    expect(result.top_reason).toBe('No dimensions evaluated')
    expect(result.dimensions).toHaveLength(0)
  })

  it('performs case-insensitive industry matching', () => {
    const lower = computeICPScore({ industry: 'logistics', employee_count: 1000 }, minimalConfig)
    const upper = computeICPScore({ industry: 'LOGISTICS', employee_count: 1000 }, minimalConfig)
    const mixed = computeICPScore({ industry: 'Logistics', employee_count: 1000 }, minimalConfig)
    expect(lower.score).toBe(upper.score)
    expect(lower.score).toBe(mixed.score)
  })

  it('produces max score 50 when weights sum to 0.5 and all dimensions are 100', () => {
    const halfWeightConfig: ICPConfig = {
      ...minimalConfig,
      dimensions: [
        {
          name: 'dim1',
          weight: 0.25,
          description: '',
          data_source: 'industry',
          scoring_tiers: [{ condition: 'in', values: ['Logistics'], score: 100, label: 'M' }, { condition: 'default', score: 0, label: 'N' }],
        },
        {
          name: 'dim2',
          weight: 0.25,
          description: '',
          data_source: 'employee_count',
          scoring_tiers: [{ condition: 'between', min: 1, max: 99999, score: 100, label: 'M' }, { condition: 'default', score: 0, label: 'N' }],
        },
      ],
    }
    const result = computeICPScore({ industry: 'Logistics', employee_count: 500 }, halfWeightConfig)
    // 100*0.25 + 100*0.25 = 50
    expect(result.score).toBe(50)
    expect(result.tier).toBe('C')
  })

  it('clamps score to 100 when weights sum to > 1.0 and all dimensions max out', () => {
    const heavyConfig: ICPConfig = {
      ...minimalConfig,
      dimensions: [
        {
          name: 'dim1', weight: 0.8, description: '', data_source: 'industry',
          scoring_tiers: [{ condition: 'in', values: ['Logistics'], score: 100, label: 'M' }, { condition: 'default', score: 0, label: 'N' }],
        },
        {
          name: 'dim2', weight: 0.8, description: '', data_source: 'employee_count',
          scoring_tiers: [{ condition: 'between', min: 1, max: 99999, score: 100, label: 'M' }, { condition: 'default', score: 0, label: 'N' }],
        },
      ],
    }
    const result = computeICPScore({ industry: 'Logistics', employee_count: 500 }, heavyConfig)
    // 100*0.8 + 100*0.8 = 160 → clamped to 100
    expect(result.score).toBe(100)
    expect(result.tier).toBe('A')
  })
})
