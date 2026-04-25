import { describe, it, expect } from 'vitest'
import {
  slugify,
  extractCitationsFromPageBody,
  formatPageForPrompt,
} from '../wiki-loader'
import type { WikiPage } from '@prospector/core'

/**
 * Unit tests for the pure-function pieces of wiki-loader (Phase 6,
 * Section 2.4).
 *
 *   1. slugify must agree with compileWikiPages's slugify so loaders
 *      and compilers find the same page given the same scope value.
 *   2. extractCitationsFromPageBody walks body_md for inline URN
 *      tokens and emits one PendingCitation per unique URN. The
 *      first citation is always the page itself.
 *   3. formatPageForPrompt prepends a "From the tenant wiki" framer
 *      with a confidence label and the page URN, then emits body_md.
 */

function fakePage(over: Partial<WikiPage>): WikiPage {
  return {
    id: 'page-uuid-001',
    tenant_id: 'tenant-uuid-001',
    kind: 'concept_icp',
    slug: 'tenant-wide',
    title: 'Your ICP',
    body_md: '# Your ICP\n\n> **TL;DR** — body.',
    frontmatter: {},
    status: 'published',
    confidence: 0.7,
    decay_score: 1.0,
    prior_alpha: 1,
    prior_beta: 1,
    source_atoms: [],
    last_compiled_at: null,
    compiler_version: null,
    superseded_by: null,
    embedding: null,
    embedding_content_hash: null,
    embedding_updated_at: null,
    created_at: '2026-04-24T00:00:00Z',
    updated_at: '2026-04-24T00:00:00Z',
    ...over,
  }
}

describe('slugify', () => {
  it('lowercases and kebab-cases', () => {
    expect(slugify('Manufacturing')).toBe('manufacturing')
    expect(slugify('Sales Operations')).toBe('sales-operations')
  })

  it('strips punctuation and collapses repeats', () => {
    expect(slugify('Workday Inc.')).toBe('workday-inc')
    expect(slugify('  Healthcare / Payers  ')).toBe('healthcare-payers')
  })

  it('caps at 80 chars', () => {
    const long = 'a'.repeat(200)
    expect(slugify(long).length).toBeLessThanOrEqual(80)
  })

  it('agrees with compileWikiPages: same input → same slug', () => {
    // The compiler's slugify and the loader's slugify must match
    // exactly for the loadWikiPage(kind, slug) path to find pages
    // compiled with the same scope value. This test pins the output
    // of three real-world inputs.
    expect(slugify('Manufacturing')).toBe('manufacturing')
    expect(slugify('champion')).toBe('champion')
    expect(slugify('Workday')).toBe('workday')
    expect(slugify('mid_market')).toBe('mid-market')
  })
})

describe('extractCitationsFromPageBody', () => {
  it('always emits the page itself as the first citation', () => {
    const page = fakePage({ body_md: 'No URNs here.' })
    const citations = extractCitationsFromPageBody(page, page.tenant_id)
    expect(citations).toHaveLength(1)
    expect(citations[0]).toEqual({
      claim_text: page.title,
      source_type: 'wiki_page',
      source_id: page.id,
    })
  })

  it('emits one citation per unique URN found in body', () => {
    const page = fakePage({
      body_md: `# Hello
- Cited \`urn:rev:tenant-uuid-001:memory:abc-123\`
- And again \`urn:rev:tenant-uuid-001:memory:abc-123\` (dup)
- Plus \`urn:rev:tenant-uuid-001:opportunity:deal-1\``,
    })
    const citations = extractCitationsFromPageBody(page, page.tenant_id)
    // 1 page citation + 2 unique URNs (dedup of memory:abc-123).
    expect(citations).toHaveLength(3)
    expect(citations[1]).toMatchObject({
      source_type: 'memory',
      source_id: 'abc-123',
    })
    expect(citations[2]).toMatchObject({
      source_type: 'opportunity',
      source_id: 'deal-1',
    })
  })

  it('drops URNs that belong to a different tenant (defence in depth)', () => {
    const page = fakePage({
      body_md: 'cross-tenant: \`urn:rev:OTHER-TENANT:memory:abc\`',
    })
    const citations = extractCitationsFromPageBody(page, page.tenant_id)
    // Only the page citation; the cross-tenant URN is dropped.
    expect(citations).toHaveLength(1)
  })

  it('handles wiki_page URNs', () => {
    const page = fakePage({
      body_md: 'see also \`urn:rev:tenant-uuid-001:wiki_page:another-page-id\`',
    })
    const citations = extractCitationsFromPageBody(page, page.tenant_id)
    expect(citations[1]).toMatchObject({
      source_type: 'wiki_page',
      source_id: 'another-page-id',
    })
  })
})

describe('formatPageForPrompt', () => {
  it('prepends a framer with the page URN and emits body_md', () => {
    const page = fakePage({ confidence: 0.9 })
    const out = formatPageForPrompt(page, page.tenant_id)
    expect(out).toContain('### From the tenant wiki')
    expect(out).toContain('high-confidence')
    expect(out).toContain(`\`urn:rev:${page.tenant_id}:wiki_page:${page.id}\``)
    expect(out).toContain(page.body_md)
  })

  it('marks low-confidence pages', () => {
    const page = fakePage({ confidence: 0.3 })
    const out = formatPageForPrompt(page, page.tenant_id)
    expect(out).toContain('low-confidence')
  })

  it('does not annotate medium-confidence pages', () => {
    const page = fakePage({ confidence: 0.6 })
    const out = formatPageForPrompt(page, page.tenant_id)
    expect(out).not.toContain('low-confidence')
    expect(out).not.toContain('high-confidence')
  })
})
