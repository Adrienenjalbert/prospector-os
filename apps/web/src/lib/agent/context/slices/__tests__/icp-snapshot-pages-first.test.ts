import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { icpSnapshotSlice } from '../icp-snapshot'
import type { SliceLoadCtx } from '../../types'

/**
 * Phase 6 (Section 2.4) — icp-snapshot pages-first contract test.
 *
 * Asserts that:
 *   1. When a published `entity_industry` page exists for the active
 *      company's industry, the slice returns ONE page row, sets
 *      `injectedPageIds`, and emits a wiki_page citation.
 *   2. When no industry-scoped page but a `concept_icp/tenant-wide`
 *      page exists, the slice returns the tenant-wide page.
 *   3. When no page exists, the slice falls back to atoms via
 *      loadMemoriesByScope and sets `injectedMemoryIds` instead.
 *
 * The supabase client is mocked at the .from(table)... chain level.
 * The chain is "thenable" so `await query` and `await query.single()`
 * both work — same shape as the real PostgrestQueryBuilder.
 */

interface MockData {
  company?: { industry: string | null }
  industryPage?: { id: string; title: string; body_md: string } | null
  conceptPage?: { id: string; title: string; body_md: string } | null
  atoms?: Array<{
    id: string
    kind: string
    title: string
    body: string
    scope: { industry?: string }
    evidence: { urns?: string[] }
    confidence: number
  }>
}

function makePage(
  base: { id: string; title: string; body_md: string },
  kind: string,
  slug: string,
) {
  return {
    ...base,
    tenant_id: 't',
    kind,
    slug,
    frontmatter: {},
    status: 'published',
    confidence: 0.7,
    decay_score: 1.0,
    prior_alpha: 1,
    prior_beta: 1,
    source_atoms: [],
    source_atoms_hash: null,
    last_compiled_at: null,
    compiler_version: null,
    superseded_by: null,
    embedding: null,
    embedding_content_hash: null,
    embedding_updated_at: null,
    created_at: '',
    updated_at: '',
  }
}

/**
 * Build a thenable, chainable query mock that mirrors PostgrestQueryBuilder.
 * Methods return `this`; await on the chain (or `.maybeSingle()` /
 * `.single()`) resolves to `{ data, error }`. The resolution is computed
 * once when await happens, based on accumulated filters.
 */
function buildSupabase(data: MockData): SupabaseClient {
  const builder = (table: string) => {
    const filters: { col: string; val: string }[] = []
    let isMaybeSingle = false

    function resolve(): { data: unknown; error: null } {
      if (table === 'companies') {
        return { data: data.company ?? null, error: null }
      }
      if (table === 'wiki_pages') {
        const kind = filters.find((f) => f.col === 'kind')?.val
        const slug = filters.find((f) => f.col === 'slug')?.val
        if (kind === 'entity_industry') {
          return {
            data: data.industryPage
              ? makePage(data.industryPage, 'entity_industry', slug ?? '')
              : null,
            error: null,
          }
        }
        if (kind === 'concept_icp') {
          return {
            data: data.conceptPage
              ? makePage(data.conceptPage, 'concept_icp', 'tenant-wide')
              : null,
            error: null,
          }
        }
        return { data: null, error: null }
      }
      if (table === 'tenant_memories') {
        const industry = filters
          .find((f) => f.col === 'scope->>industry')
          ?.val
        if (industry) {
          return {
            data: (data.atoms ?? []).filter((a) => a.scope.industry === industry),
            error: null,
          }
        }
        // No industry filter → tenant-wide rows.
        return {
          data: (data.atoms ?? []).filter((a) => !a.scope.industry),
          error: null,
        }
      }
      return { data: null, error: null }
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: string) => {
        filters.push({ col, val })
        return chain
      },
      in: () => chain,
      not: () => chain,
      order: () => chain,
      gte: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        isMaybeSingle = true
        return resolve()
      },
      // Thenable so `await chain` works without an explicit terminator.
      then: (
        onFulfilled: (v: { data: unknown; error: null }) => unknown,
        onRejected?: (err: unknown) => unknown,
      ) => {
        try {
          const v = resolve()
          // For tenant_memories the result is an array; resolve as data.
          return Promise.resolve(onFulfilled(v))
        } catch (err) {
          return onRejected ? Promise.resolve(onRejected(err)) : Promise.reject(err)
        }
      },
    }
    void isMaybeSingle
    return chain as unknown as ReturnType<SupabaseClient['from']>
  }

  return { from: builder } as unknown as SupabaseClient
}

function makeCtx(supabase: SupabaseClient): SliceLoadCtx {
  return {
    tenantId: 't',
    repId: 'r',
    userId: 'u',
    role: 'ae',
    activeUrn: 'urn:rev:t:company:c1',
    activeObject: 'company',
    activeCompanyId: 'c1',
    activeDealId: null,
    pageContext: undefined,
    intentClass: 'lookup',
    crmType: 'hubspot',
    supabase,
    deadlineMs: Date.now() + 5000,
  }
}

describe('icp-snapshot pages-first contract', () => {
  it('returns the entity_industry page when one exists for the active industry', async () => {
    const supabase = buildSupabase({
      company: { industry: 'Manufacturing' },
      industryPage: {
        id: 'page-001',
        title: 'Manufacturing — your ICP',
        body_md: '# Manufacturing — your ICP\n> body',
      },
    })
    const result = await icpSnapshotSlice.load(makeCtx(supabase))
    expect(result.rows).toHaveLength(1)
    const first = result.rows[0]
    expect(first).toMatchObject({ source: 'page' })
    expect((first as { source: 'page'; page: { id: string } }).page.id).toBe('page-001')
    expect(result.injectedPageIds).toEqual(['page-001'])
    expect(result.injectedMemoryIds).toBeUndefined()
  })

  it('falls back to tenant-wide concept_icp page when no industry-scoped page exists', async () => {
    const supabase = buildSupabase({
      company: { industry: 'Manufacturing' },
      industryPage: null,
      conceptPage: {
        id: 'page-002',
        title: 'Tenant-wide ICP',
        body_md: '# Tenant-wide ICP\n> body',
      },
    })
    const result = await icpSnapshotSlice.load(makeCtx(supabase))
    expect(result.rows).toHaveLength(1)
    expect((result.rows[0] as { source: string }).source).toBe('page')
    expect(result.injectedPageIds).toEqual(['page-002'])
  })

  it('falls back to atoms when no page exists (cold-start)', async () => {
    const supabase = buildSupabase({
      company: { industry: 'Manufacturing' },
      industryPage: null,
      conceptPage: null,
      atoms: [
        {
          id: 'atom-1',
          kind: 'icp_pattern',
          title: 'A',
          body: 'b',
          scope: { industry: 'Manufacturing' },
          evidence: { urns: [] },
          confidence: 0.7,
        },
      ],
    })
    const result = await icpSnapshotSlice.load(makeCtx(supabase))
    expect(result.rows.length).toBeGreaterThan(0)
    expect((result.rows[0] as { source: string }).source).toBe('atom')
    expect(result.injectedMemoryIds).toContain('atom-1')
    expect(result.injectedPageIds).toBeUndefined()
  })

  it('returns empty + a coverage warning when neither page nor atoms exist', async () => {
    const supabase = buildSupabase({
      company: { industry: 'Manufacturing' },
      atoms: [],
    })
    const result = await icpSnapshotSlice.load(makeCtx(supabase))
    expect(result.rows).toHaveLength(0)
    expect(result.warnings?.[0]).toMatch(/No ICP memories yet/)
  })
})
