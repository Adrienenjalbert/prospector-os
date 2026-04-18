import { describe, expect, it } from 'vitest'
import {
  consumedSlicesFromResponse,
  extractUrnsFromText,
  type PackedContext,
} from '..'

/**
 * Tests for the response-side URN extraction that powers the
 * `context_slice_consumed` event. The bandit's signal quality depends on
 * this: false positives (counting URNs the agent didn't reference) bias
 * the priors, false negatives (missing URNs the agent did reference)
 * starve the priors.
 */

describe('extractUrnsFromText', () => {
  it('finds bare URN tokens', () => {
    const text = 'See urn:rev:opportunity:abc123 for context.'
    expect(extractUrnsFromText(text)).toEqual(['urn:rev:opportunity:abc123'])
  })

  it('finds URNs wrapped in backticks', () => {
    const text = 'The deal `urn:rev:deal:xyz` has stalled.'
    expect(extractUrnsFromText(text)).toEqual(['urn:rev:deal:xyz'])
  })

  it('deduplicates repeated URNs', () => {
    const text = 'urn:rev:company:a and urn:rev:company:a again.'
    expect(extractUrnsFromText(text)).toEqual(['urn:rev:company:a'])
  })

  it('finds multiple distinct URNs', () => {
    const text = 'company `urn:rev:company:a`, deal `urn:rev:deal:b`'
    const urns = extractUrnsFromText(text)
    expect(urns).toContain('urn:rev:company:a')
    expect(urns).toContain('urn:rev:deal:b')
    expect(urns.length).toBe(2)
  })

  it('returns empty array for text with no URNs', () => {
    expect(extractUrnsFromText('Just plain English with no URNs.')).toEqual([])
  })

  it('returns empty array for empty text', () => {
    expect(extractUrnsFromText('')).toEqual([])
  })
})

describe('consumedSlicesFromResponse', () => {
  function buildPacked(sections: { slug: string; markdown: string }[]): PackedContext {
    return {
      preamble: '',
      sections: sections.map((s) => ({
        slug: s.slug,
        title: s.slug,
        markdown: s.markdown,
        provenance: { fetched_at: '', source: 'db', duration_ms: 0 },
        tokens: 100,
        row_count: 1,
      })),
      citations: [],
      failed: [],
      hydrated: sections.map((s) => s.slug),
      tokens_used: 0,
      scored: [],
      legacy: null,
    }
  }

  it('emits one consumption per slice that contributed a referenced URN', () => {
    const packed = buildPacked([
      { slug: 'stalled-deals', markdown: 'urn:rev:opportunity:abc' },
      { slug: 'priority-accounts', markdown: 'urn:rev:company:xyz' },
      { slug: 'recent-signals', markdown: 'urn:rev:signal:s1' },
    ])
    const response = 'Acme `urn:rev:opportunity:abc` is stalled — call John.'
    const consumed = consumedSlicesFromResponse(packed, response)
    expect(consumed.map((c) => c.slug)).toEqual(['stalled-deals'])
    expect(consumed[0].urns_referenced).toEqual(['urn:rev:opportunity:abc'])
  })

  it('returns empty when the response references no slice URNs', () => {
    const packed = buildPacked([
      { slug: 'stalled-deals', markdown: 'urn:rev:opportunity:abc' },
    ])
    const response = 'I have no idea, sorry.'
    expect(consumedSlicesFromResponse(packed, response)).toEqual([])
  })

  it('counts each contributing slice when the response cites multiple', () => {
    const packed = buildPacked([
      { slug: 'stalled-deals', markdown: 'urn:rev:opportunity:abc' },
      { slug: 'priority-accounts', markdown: 'urn:rev:company:xyz' },
    ])
    const response =
      'The deal `urn:rev:opportunity:abc` at company `urn:rev:company:xyz` needs attention.'
    const consumed = consumedSlicesFromResponse(packed, response)
    const slugs = consumed.map((c) => c.slug).sort()
    expect(slugs).toEqual(['priority-accounts', 'stalled-deals'])
  })

  it('skips the meta coverage section when matching', () => {
    const packed = buildPacked([
      { slug: '_coverage-warnings', markdown: 'urn:rev:signal:gone' },
      { slug: 'recent-signals', markdown: 'urn:rev:signal:gone' },
    ])
    const response = 'I see `urn:rev:signal:gone`.'
    const consumed = consumedSlicesFromResponse(packed, response)
    expect(consumed.map((c) => c.slug)).toEqual(['recent-signals'])
  })
})
