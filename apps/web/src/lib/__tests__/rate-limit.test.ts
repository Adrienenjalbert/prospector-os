import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit, rateLimitResponse } from '../rate-limit'

/**
 * The rate limiter for /api/agent. Pre-this-helper there was no
 * limiter at all on the most expensive endpoint we expose — a
 * hammering script could cost O($) / minute / attacker. The DB-backed
 * limiter survives cold-starts and horizontal scale (in-memory state
 * would be effectively unlimited because every Vercel function
 * instance has its own counter).
 *
 * These tests pin the contract so a refactor that breaks the count
 * source or the 429 response shape gets caught.
 */

function fakeSupabaseWithCount(count: number): SupabaseClient {
  const terminal = { count, error: null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, (..._: unknown[]) => unknown> = {
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

describe('checkRateLimit', () => {
  it('allows when usage is below the limit', async () => {
    const r = await checkRateLimit(fakeSupabaseWithCount(3), 'u1', { limit: 10 })
    expect(r.allowed).toBe(true)
    expect(r.used).toBe(3)
    expect(r.limit).toBe(10)
  })

  it('blocks at exactly the limit', async () => {
    const r = await checkRateLimit(fakeSupabaseWithCount(10), 'u1', { limit: 10 })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('over_limit')
    expect(r.retryAfterSec).toBeGreaterThan(0)
  })

  it('blocks when usage exceeds the limit', async () => {
    const r = await checkRateLimit(fakeSupabaseWithCount(15), 'u1', { limit: 10 })
    expect(r.allowed).toBe(false)
  })

  it('default limit is 10', async () => {
    const r = await checkRateLimit(fakeSupabaseWithCount(0), 'u1')
    expect(r.limit).toBe(10)
  })

  it('reports retryAfterSec rounded to the next second', async () => {
    const r = await checkRateLimit(fakeSupabaseWithCount(99), 'u1', {
      limit: 10,
      windowMs: 12_345,
    })
    expect(r.retryAfterSec).toBe(13)
  })
})

describe('rateLimitResponse', () => {
  it('returns 429 with Retry-After header', () => {
    const res = rateLimitResponse({
      allowed: false,
      used: 11,
      limit: 10,
      reason: 'over_limit',
      retryAfterSec: 60,
    })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  it('JSON body carries the limit context for client feedback', async () => {
    const res = rateLimitResponse({
      allowed: false,
      used: 11,
      limit: 10,
      reason: 'over_limit',
      retryAfterSec: 60,
    })
    const body = (await res.json()) as {
      error: string
      limit: number
      used: number
      retry_after_sec: number
    }
    expect(body.error).toBe('Rate limit exceeded')
    expect(body.limit).toBe(10)
    expect(body.used).toBe(11)
    expect(body.retry_after_sec).toBe(60)
  })
})
