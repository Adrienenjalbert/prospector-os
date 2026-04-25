import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  findSimilarAccountsHandler,
  extractMeddpiccGapsHandler,
  summariseAccountHealthHandler,
  type FindSimilarAccountsResult,
  type ExtractMeddpiccGapsResult,
  type SummariseAccountHealthResult,
} from '../account-intelligence'

/**
 * Tests for C2 account-intelligence tool bundle.
 *
 * These tools are tier-2-disciplined (Zod input, {data, citations}
 * output). The tests pin down:
 *   - Input validation works (missing required fields → error result,
 *     not throw)
 *   - Citations are emitted with the correct URN shape
 *   - Empty / not-found cases return data:null + descriptive error
 *   - The output shape matches what the citation extractor expects
 */

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const COMPANY_ID = '00000000-0000-0000-0000-000000000010'

interface MaybeSingle<T> {
  data: T | null
  error: { message: string } | null
}

function buildSupabase(opts: {
  company?: { id: string; name: string; embedding?: number[] | null } | null
  matchCompaniesResult?: Array<{ id: string; name: string; industry: string | null; similarity: number }>
  transcripts?: Array<{
    id: string
    occurred_at: string
    source_url: string | null
    meddpicc_extracted: Record<string, unknown> | null
  }>
  healthSnapshots?: Array<{
    id: string
    health_score: number | null
    status: string | null
    captured_at: string
    reason: string | null
  }>
  signals?: Array<{
    signal_type: string
    title: string
    weighted_score: number
  }>
}): SupabaseClient {
  return {
    from(table: string): unknown {
      if (table === 'companies') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle(): Promise<MaybeSingle<typeof opts.company>> {
                        return Promise.resolve({ data: opts.company ?? null, error: null })
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'transcripts') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      gte() {
                        return {
                          order() {
                            return {
                              limit() {
                                return Promise.resolve({ data: opts.transcripts ?? [], error: null })
                              },
                            }
                          },
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'health_snapshots') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      gte() {
                        return {
                          order() {
                            return {
                              limit() {
                                return Promise.resolve({ data: opts.healthSnapshots ?? [], error: null })
                              },
                            }
                          },
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'signals') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      gte() {
                        return {
                          order() {
                            return {
                              limit() {
                                return Promise.resolve({ data: opts.signals ?? [], error: null })
                              },
                            }
                          },
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      return {}
    },
    rpc(name: string) {
      if (name === 'match_companies') {
        return Promise.resolve({ data: opts.matchCompaniesResult ?? [], error: null })
      }
      return Promise.resolve({ data: [], error: null })
    },
  } as unknown as SupabaseClient
}

const baseCtx = {
  tenantId: TENANT_ID,
  repId: 'rep-1',
  userId: 'u-1',
  role: 'ae',
  activeUrn: null,
}

describe('find_similar_accounts (C2)', () => {
  it('returns an error when neither reference is provided', async () => {
    const supabase = buildSupabase({})
    const handler = findSimilarAccountsHandler.build({ ...baseCtx, supabase })
    const result = (await handler({})) as FindSimilarAccountsResult

    expect(result.data).toBeNull()
    expect(result.error).toMatch(/reference_company_id or reference_text/i)
    expect(result.citations).toEqual([])
  })

  it('returns matches with company URN citations when the RPC succeeds', async () => {
    const supabase = buildSupabase({
      company: { id: COMPANY_ID, name: 'Acme', embedding: new Array(1536).fill(0.1) },
      matchCompaniesResult: [
        { id: 'c2', name: 'Beta Corp', industry: 'tech', similarity: 0.91 },
        { id: 'c3', name: 'Gamma Ltd', industry: 'tech', similarity: 0.85 },
      ],
    })
    const handler = findSimilarAccountsHandler.build({ ...baseCtx, supabase })
    const result = (await handler({
      reference_company_id: COMPANY_ID,
      max_results: 5,
    })) as FindSimilarAccountsResult

    expect(result.data?.matches.length).toBe(2)
    expect(result.data?.matches[0].source_url).toMatch(/^urn:rev:.*:company:c2/)
    expect(result.citations.length).toBe(2)
    expect(result.citations[0].source_type).toBe('company')
  })

  it('drops the reference company itself from results when exclude_self is default', async () => {
    const supabase = buildSupabase({
      company: { id: COMPANY_ID, name: 'Acme', embedding: new Array(1536).fill(0.1) },
      matchCompaniesResult: [
        { id: COMPANY_ID, name: 'Acme', industry: null, similarity: 1.0 },
        { id: 'c2', name: 'Beta', industry: null, similarity: 0.9 },
      ],
    })
    const handler = findSimilarAccountsHandler.build({ ...baseCtx, supabase })
    const result = (await handler({ reference_company_id: COMPANY_ID })) as FindSimilarAccountsResult
    expect(result.data?.matches.length).toBe(1)
    expect(result.data?.matches[0].name).toBe('Beta')
  })

  it('errors out when the reference company has no embedding yet', async () => {
    const supabase = buildSupabase({
      company: { id: COMPANY_ID, name: 'Acme', embedding: null },
    })
    const handler = findSimilarAccountsHandler.build({ ...baseCtx, supabase })
    const result = (await handler({ reference_company_id: COMPANY_ID })) as FindSimilarAccountsResult
    expect(result.data).toBeNull()
    expect(result.error).toMatch(/no embedding/i)
  })
})

describe('extract_meddpicc_gaps (C2)', () => {
  it('flags every field as a gap when no transcripts exist', async () => {
    const supabase = buildSupabase({
      company: { id: COMPANY_ID, name: 'Acme' },
      transcripts: [],
    })
    const handler = extractMeddpiccGapsHandler.build({ ...baseCtx, supabase })
    const result = (await handler({ company_id: COMPANY_ID })) as ExtractMeddpiccGapsResult

    expect(result.data?.coverage_pct).toBe(0)
    expect(result.data?.gaps.length).toBe(8)
    // Always cites the company even with no transcripts.
    expect(result.citations.find((c) => c.source_type === 'company')).toBeDefined()
  })

  it('counts coverage when transcripts contain meddpicc fields', async () => {
    const supabase = buildSupabase({
      company: { id: COMPANY_ID, name: 'Acme' },
      transcripts: [
        {
          id: 't1',
          occurred_at: new Date().toISOString(),
          source_url: 'https://gong.io/call/t1',
          meddpicc_extracted: {
            economic_buyer: 'Jane Smith, CFO',
            champion: 'John Doe, VP Eng',
            metrics: '20% efficiency improvement',
          },
        },
      ],
    })
    const handler = extractMeddpiccGapsHandler.build({ ...baseCtx, supabase })
    const result = (await handler({ company_id: COMPANY_ID })) as ExtractMeddpiccGapsResult

    expect(result.data?.coverage.economic_buyer.covered).toBe(true)
    expect(result.data?.coverage.champion.covered).toBe(true)
    expect(result.data?.coverage.metrics.covered).toBe(true)
    expect(result.data?.coverage.competition.covered).toBe(false)
    expect(result.data?.coverage_pct).toBeGreaterThan(0)
    // Transcript is cited because it contributed values.
    expect(result.citations.find((c) => c.source_type === 'transcript')).toBeDefined()
  })

  it('errors out cleanly when the company is not found', async () => {
    const supabase = buildSupabase({ company: null })
    const handler = extractMeddpiccGapsHandler.build({ ...baseCtx, supabase })
    const result = (await handler({ company_id: COMPANY_ID })) as ExtractMeddpiccGapsResult
    expect(result.data).toBeNull()
    expect(result.error).toMatch(/not found/i)
  })
})

describe('summarise_account_health (C2)', () => {
  it('returns a stable headline + citations for an account with one snapshot', async () => {
    const supabase = buildSupabase({
      company: { id: COMPANY_ID, name: 'Acme' },
      healthSnapshots: [
        {
          id: 'h1',
          health_score: 78,
          status: 'green',
          captured_at: new Date().toISOString(),
          reason: 'positive sentiment',
        },
      ],
      signals: [
        { signal_type: 'champion_strong', title: 'CFO booked QBR', weighted_score: 0.9 },
      ],
    })
    const handler = summariseAccountHealthHandler.build({ ...baseCtx, supabase })
    const result = (await handler({ company_id: COMPANY_ID })) as SummariseAccountHealthResult
    expect(result.data?.latest?.health_score).toBe(78)
    expect(result.data?.trend).toBe('stable')
    expect(result.data?.headline).toContain('78/100')
    expect(result.citations.find((c) => c.source_type === 'company')).toBeDefined()
    expect(result.citations.find((c) => c.source_type === 'health_snapshot')).toBeDefined()
  })

  it('marks declining trend correctly with two snapshots', async () => {
    const supabase = buildSupabase({
      company: { id: COMPANY_ID, name: 'Acme' },
      healthSnapshots: [
        {
          id: 'h2',
          health_score: 60,
          status: 'amber',
          captured_at: new Date().toISOString(),
          reason: 'champion left',
        },
        {
          id: 'h1',
          health_score: 80,
          status: 'green',
          captured_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          reason: null,
        },
      ],
      signals: [],
    })
    const handler = summariseAccountHealthHandler.build({ ...baseCtx, supabase })
    const result = (await handler({ company_id: COMPANY_ID })) as SummariseAccountHealthResult
    expect(result.data?.trend).toBe('declining')
    expect(result.data?.delta).toBe(-20)
  })

  it('handles no snapshots cleanly', async () => {
    const supabase = buildSupabase({
      company: { id: COMPANY_ID, name: 'Acme' },
      healthSnapshots: [],
      signals: [],
    })
    const handler = summariseAccountHealthHandler.build({ ...baseCtx, supabase })
    const result = (await handler({ company_id: COMPANY_ID })) as SummariseAccountHealthResult
    expect(result.data?.trend).toBe('unknown')
    expect(result.data?.headline).toContain('no snapshot')
  })
})
