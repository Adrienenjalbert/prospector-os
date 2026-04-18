import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCohort, shouldSuppressPush } from '../holdout'

/**
 * Build a fake Supabase client whose `holdout_assignments` and
 * `attribution_config` tables return user-controlled values. Every other
 * call returns `{ data: null, error: null }`.
 */
function fakeSupabase(opts: {
  existingCohort?: 'treatment' | 'control'
  holdoutPercent?: number
  insertSpy?: (row: unknown) => void
}): SupabaseClient {
  const insertSpy = opts.insertSpy ?? (() => {})
  return {
    from(table: string) {
      if (table === 'holdout_assignments') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle() {
                        return Promise.resolve({
                          data: opts.existingCohort
                            ? { cohort: opts.existingCohort }
                            : null,
                          error: null,
                        })
                      },
                    }
                  },
                }
              },
            }
          },
          insert(row: unknown) {
            insertSpy(row)
            return Promise.resolve({ data: null, error: null }).then(
              (v) => v,
              (v) => v,
            )
          },
        }
      }
      if (table === 'attribution_config') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data:
                        opts.holdoutPercent !== undefined
                          ? { holdout_percent: opts.holdoutPercent }
                          : null,
                      error: null,
                    })
                  },
                }
              },
            }
          },
        }
      }
      return {} as never
    },
  } as unknown as SupabaseClient
}

describe('holdout cohort assignment', () => {
  it('returns the persisted cohort when one already exists', async () => {
    const sb = fakeSupabase({ existingCohort: 'control' })
    expect(await resolveCohort(sb, 't1', 'u1')).toBe('control')
  })

  it('assigns deterministically based on (tenant, user) hash', async () => {
    const sb = fakeSupabase({ holdoutPercent: 10 })
    // Same (tenant, user) twice → same cohort.
    const a = await resolveCohort(sb, 't1', 'u1')
    const b = await resolveCohort(sb, 't1', 'u1')
    expect(a).toBe(b)
  })

  it('respects the tenant-configured holdout percent', async () => {
    // 100% holdout means everyone is control.
    const sb = fakeSupabase({ holdoutPercent: 100 })
    expect(await resolveCohort(sb, 't1', 'user-a')).toBe('control')
    expect(await resolveCohort(sb, 't1', 'user-b')).toBe('control')
    expect(await resolveCohort(sb, 't1', 'user-c')).toBe('control')
  })

  it('0% holdout puts everyone in treatment', async () => {
    const sb = fakeSupabase({ holdoutPercent: 0 })
    expect(await resolveCohort(sb, 't1', 'user-a')).toBe('treatment')
    expect(await resolveCohort(sb, 't1', 'user-b')).toBe('treatment')
  })

  it('shouldSuppressPush is true for control, false for treatment', async () => {
    const sbControl = fakeSupabase({ existingCohort: 'control' })
    const sbTreatment = fakeSupabase({ existingCohort: 'treatment' })
    expect(await shouldSuppressPush(sbControl, 't1', 'u1')).toBe(true)
    expect(await shouldSuppressPush(sbTreatment, 't1', 'u1')).toBe(false)
  })

  it('persists the assignment so the next call is cheap', async () => {
    const inserted: unknown[] = []
    const sb = fakeSupabase({
      holdoutPercent: 50,
      insertSpy: (row) => inserted.push(row),
    })
    await resolveCohort(sb, 't1', 'u-fresh')
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ tenant_id: 't1', user_id: 'u-fresh' })
  })
})
