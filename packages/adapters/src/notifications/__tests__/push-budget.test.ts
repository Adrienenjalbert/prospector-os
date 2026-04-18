import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkPushBudget } from '../push-budget'

/**
 * Build a fake supabase whose `agent_events` count returns `count`.
 * `head: true` calls go through `select(...).eq(...).eq(...).eq(...).eq(...).gte(...)`
 * and resolve to `{ count }`.
 */
function fakeSupabaseWithCount(count: number): SupabaseClient {
  const terminal = { count, error: null }
  const chain: Record<string, (..._a: unknown[]) => unknown> = {
    select() {
      return chain
    },
    eq() {
      return chain
    },
    gte() {
      return Promise.resolve(terminal)
    },
  }
  return {
    from() {
      return chain
    },
  } as unknown as SupabaseClient
}

describe('checkPushBudget', () => {
  it('high frequency cap is 3/day', async () => {
    const r = await checkPushBudget(fakeSupabaseWithCount(2), 't1', 'u1', 'high')
    expect(r.allowed).toBe(true)
    expect(r.limit).toBe(3)
    expect(r.used).toBe(2)
  })

  it('high frequency blocks at 3/day', async () => {
    const r = await checkPushBudget(fakeSupabaseWithCount(3), 't1', 'u1', 'high')
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('over_budget')
  })

  it('medium frequency cap is 2/day', async () => {
    const r = await checkPushBudget(fakeSupabaseWithCount(2), 't1', 'u1', 'medium')
    expect(r.allowed).toBe(false)
    expect(r.limit).toBe(2)
  })

  it('low frequency cap is 1/day', async () => {
    const r = await checkPushBudget(fakeSupabaseWithCount(0), 't1', 'u1', 'low')
    expect(r.allowed).toBe(true)
    const r2 = await checkPushBudget(fakeSupabaseWithCount(1), 't1', 'u1', 'low')
    expect(r2.allowed).toBe(false)
  })

  it('defaults to medium when frequency is omitted', async () => {
    const r = await checkPushBudget(fakeSupabaseWithCount(2), 't1', 'u1')
    expect(r.limit).toBe(2)
  })
})
