import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { bridgeOpportunitiesSlice } from '../bridge-opportunities'
import type { SliceLoadCtx } from '../../types'

/**
 * Phase 7 (Section 3.4) — bridge-opportunities pages-first contract.
 *
 * Same pages-first → atoms-fallback shape as the Phase 6 slices,
 * adapted for the bridges layer:
 *
 *   1. When an entity_company_neighbourhood page exists for the
 *      active company, the slice returns ONE page row + sets
 *      injectedPageIds.
 *   2. When no page but inbound bridges_to edges exist, the slice
 *      returns up to 3 edge rows.
 *   3. When neither exists, the slice returns empty.
 *
 * The supabase client is mocked at the .from(table)... chain level
 * (same builder pattern as icp-snapshot-pages-first.test.ts).
 */

interface MockData {
  page?: { id: string; title: string; body_md: string } | null
  edges?: Array<{
    id: string
    src_id: string
    src_kind: string
    weight: number
    evidence: Record<string, unknown>
  }>
  companies?: Array<{ id: string; name: string }>
}

function makePage(base: { id: string; title: string; body_md: string }) {
  return {
    ...base,
    tenant_id: 't',
    kind: 'entity_company_neighbourhood',
    slug: 'company-1',
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

function buildSupabase(data: MockData): SupabaseClient {
  const builder = (table: string) => {
    const filters: { col: string; val: string }[] = []
    function resolve(): { data: unknown; error: null } {
      if (table === 'wiki_pages') {
        return {
          data: data.page ? makePage(data.page) : null,
          error: null,
        }
      }
      if (table === 'memory_edges') {
        return { data: data.edges ?? [], error: null }
      }
      if (table === 'companies') {
        return { data: data.companies ?? [], error: null }
      }
      if (table === 'contacts') {
        return { data: [], error: null }
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
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => resolve(),
      then: (
        onFulfilled: (v: { data: unknown; error: null }) => unknown,
        onRejected?: (err: unknown) => unknown,
      ) => {
        try {
          const v = resolve()
          return Promise.resolve(onFulfilled(v))
        } catch (err) {
          return onRejected ? Promise.resolve(onRejected(err)) : Promise.reject(err)
        }
      },
    }
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
    activeUrn: 'urn:rev:t:company:company-1',
    activeObject: 'company',
    activeCompanyId: 'company-1',
    activeDealId: null,
    pageContext: undefined,
    intentClass: 'draft_outreach',
    crmType: 'hubspot',
    supabase,
    deadlineMs: Date.now() + 5000,
  }
}

describe('bridge-opportunities pages-first contract', () => {
  it('returns the entity_company_neighbourhood page when it exists', async () => {
    const supabase = buildSupabase({
      page: {
        id: 'page-bn-1',
        title: 'Warm-path neighbourhood: Acme Corp',
        body_md: '# Warm-path neighbourhood\n> body',
      },
    })
    const result = await bridgeOpportunitiesSlice.load(makeCtx(supabase))
    expect(result.rows).toHaveLength(1)
    expect((result.rows[0] as { source: string }).source).toBe('page')
    expect(result.injectedPageIds).toEqual(['page-bn-1'])
  })

  it('falls back to inbound edges when no page exists', async () => {
    const supabase = buildSupabase({
      page: null,
      edges: [
        {
          id: 'edge-1',
          src_id: 'co-source-1',
          src_kind: 'company',
          weight: 0.9,
          evidence: { miner: 'mine_reverse_alumni' },
        },
        {
          id: 'edge-2',
          src_id: 'co-source-2',
          src_kind: 'company',
          weight: 0.8,
          evidence: { miner: 'mine_coworker_triangles' },
        },
        // self-edge that must be filtered
        {
          id: 'edge-self',
          src_id: 'company-1',
          src_kind: 'company',
          weight: 1.0,
          evidence: {},
        },
      ],
      companies: [
        { id: 'co-source-1', name: 'Source Co 1' },
        { id: 'co-source-2', name: 'Source Co 2' },
      ],
    })
    const result = await bridgeOpportunitiesSlice.load(makeCtx(supabase))
    expect(result.rows.length).toBe(2)
    expect((result.rows[0] as { source: string }).source).toBe('edge')
    expect(result.injectedPageIds).toBeUndefined()
  })

  it('returns empty when no page AND no inbound edges', async () => {
    const supabase = buildSupabase({ page: null, edges: [] })
    const result = await bridgeOpportunitiesSlice.load(makeCtx(supabase))
    expect(result.rows).toHaveLength(0)
  })

  it('returns empty when no active company is in scope', async () => {
    const supabase = buildSupabase({})
    const ctx = makeCtx(supabase)
    ctx.activeCompanyId = null
    ctx.activeUrn = null
    const result = await bridgeOpportunitiesSlice.load(ctx)
    expect(result.rows).toHaveLength(0)
  })
})
