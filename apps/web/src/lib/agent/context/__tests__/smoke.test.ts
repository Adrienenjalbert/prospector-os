import { describe, expect, it } from 'vitest'
import {
  SLICES,
  SLICE_SLUGS,
  STRATEGY_BUNDLES,
  buildSelectorInput,
  selectSlices,
  renderContextPreamble,
} from '..'

/**
 * Smoke tests — quick sanity checks on the public surface so a future
 * import-path refactor surfaces here before it hits the agent route.
 *
 * Intentionally minimal: heavy logic lives in selector.test.ts.
 */

describe('context pack public surface', () => {
  it('exports the expected slice slugs', () => {
    expect(SLICE_SLUGS).toContain('priority-accounts')
    expect(SLICE_SLUGS).toContain('stalled-deals')
    expect(SLICE_SLUGS).toContain('funnel-comparison')
    expect(SLICE_SLUGS).toContain('recent-signals')
    expect(SLICE_SLUGS).toContain('current-deal-health')
    expect(SLICE_SLUGS).toContain('current-company-snapshot')
    expect(SLICE_SLUGS).toContain('transcript-summaries')
    expect(SLICE_SLUGS).toContain('key-contact-notes')
  })

  it('exports four named strategy bundles', () => {
    expect(Object.keys(STRATEGY_BUNDLES).sort()).toEqual([
      'account_centric',
      'portfolio_centric',
      'rep_centric',
      'team_centric',
    ])
  })

  it('every slice in the registry has a non-empty title', () => {
    for (const slice of Object.values(SLICES)) {
      expect(slice.title.length).toBeGreaterThan(0)
    }
  })

  it('preamble renders cleanly with empty packed context', () => {
    const out = renderContextPreamble({
      intentClass: 'general_query',
      role: 'ae',
      activeObjectSummary: null,
      packed: {
        preamble: '',
        sections: [],
        citations: [],
        failed: [],
        hydrated: [],
        tokens_used: 0,
        scored: [],
        legacy: null,
      },
    })
    expect(out).toContain('Intent detected')
    expect(out).toContain('general_query')
    expect(out.length).toBeGreaterThan(0)
  })

  it('selector + preamble compose end-to-end without throwing', () => {
    const input = buildSelectorInput({
      role: 'ae',
      activeObject: 'deal',
      activeUrn: 'urn:rev:deal:abc',
      intentClass: 'risk_analysis',
      isStalled: true,
    })
    const result = selectSlices(input)
    expect(result.slugs.length).toBeGreaterThan(0)
    expect(result.scored.length).toBeGreaterThan(0)
  })
})
