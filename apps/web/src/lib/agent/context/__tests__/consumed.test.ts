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

  // Canonical URN format is `urn:rev:{tenantId}:{type}:{id}` where
  // tenantId is a UUID. The earlier regex `urn:rev:[a-z]+:[A-Za-z0-9_-]+`
  // could not match a UUID-tenant segment because `[a-z]+` rejects
  // digits + hyphens. Result: every canonical URN emitted by `urn.*`
  // helpers was invisible to the bandit's `context_slice_consumed`
  // event stream. These tests pin the canonical-URN parsing contract.
  it('finds canonical URNs with a UUID tenant segment', () => {
    const text =
      'See `urn:rev:11111111-2222-3333-4444-555555555555:opportunity:abc-123` for context.'
    expect(extractUrnsFromText(text)).toEqual([
      'urn:rev:11111111-2222-3333-4444-555555555555:opportunity:abc-123',
    ])
  })

  it('finds canonical URNs whose tenant segment starts with a digit', () => {
    // Most real UUIDs start with a digit — a regression here would
    // silently lose URN-consumption signal for ~60% of tenants.
    const text = 'urn:rev:9abcde00-0000-0000-0000-000000000000:company:co-1'
    expect(extractUrnsFromText(text)).toEqual([
      'urn:rev:9abcde00-0000-0000-0000-000000000000:company:co-1',
    ])
  })

  it('still finds shorthand URNs for backwards compat with un-migrated text', () => {
    // Some seeded prompts and goldens still emit the legacy 4-segment
    // form; the regex must accept both during the rollout window.
    const text = 'See urn:rev:opportunity:abc and `urn:rev:company:xyz` together.'
    const urns = extractUrnsFromText(text)
    expect(urns).toContain('urn:rev:opportunity:abc')
    expect(urns).toContain('urn:rev:company:xyz')
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
