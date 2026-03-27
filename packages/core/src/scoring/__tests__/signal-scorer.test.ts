import { describe, it, expect } from 'vitest'
import { computeSignalMomentum } from '../signal-scorer'
import type { Signal } from '../../types/ontology'
import type { SignalConfig } from '../../types/config'

const testSignalConfig: SignalConfig = {
  version: '1.0-test',
  business: 'test',
  signal_types: [
    { name: 'funding', display_name: 'Funding', description: '', source: 'apollo', weight_multiplier: 1.5, recency_decay_days: 60, min_relevance_threshold: 0.6, urgency_default: 'this_week', enrichment_depth: 'deep' },
    { name: 'hiring_surge', display_name: 'Hiring', description: '', source: 'apollo', weight_multiplier: 1.2, recency_decay_days: 30, min_relevance_threshold: 0.5, urgency_default: 'this_week', enrichment_depth: 'standard' },
  ],
  recency_decay: { formula: '', description: '' },
  composite_signal_score: { formula: '', max_signals_per_company: 10, description: '' },
  deep_research_config: { model: 'claude-sonnet', temperature: 0.2, max_tokens: 3000, only_for_tiers: ['A'] },
}

function makeSignal(overrides: Partial<Signal>): Signal {
  return {
    id: 'sig-1', tenant_id: 't1', company_id: 'c1',
    signal_type: 'funding', title: 'Series B',
    description: null, source_url: null, source: 'apollo',
    relevance_score: 0.8, weight_multiplier: 1.5,
    recency_days: 5, weighted_score: 1.2,
    recommended_action: null, urgency: 'this_week',
    detected_at: new Date().toISOString(),
    expires_at: null, created_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('computeSignalMomentum', () => {
  it('returns 0 for no signals with no previous score', () => {
    const result = computeSignalMomentum({ signals: [] }, testSignalConfig)
    expect(result.score).toBe(0)
  })

  it('detects "going dark" when signals vanish', () => {
    const result = computeSignalMomentum(
      { signals: [], previous_signal_score: 80 },
      testSignalConfig
    )
    expect(result.score).toBeLessThanOrEqual(5)
  })

  it('scores higher with multiple relevant signals', () => {
    const one = computeSignalMomentum(
      { signals: [makeSignal({})] },
      testSignalConfig
    )
    const two = computeSignalMomentum(
      { signals: [makeSignal({}), makeSignal({ id: 's2', signal_type: 'hiring_surge' })] },
      testSignalConfig
    )
    expect(two.score).toBeGreaterThan(one.score)
  })

  it('includes velocity dimension', () => {
    const result = computeSignalMomentum(
      { signals: [makeSignal({})], previous_signal_score: 20 },
      testSignalConfig
    )
    const velocityDim = result.dimensions.find(d => d.name === 'signal_velocity')
    expect(velocityDim).toBeDefined()
    expect(velocityDim!.score).toBeGreaterThan(50)
  })
})
