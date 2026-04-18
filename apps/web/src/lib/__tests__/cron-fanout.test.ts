import { describe, it, expect, vi } from 'vitest'
import { forEachTenantChunked, statusFor } from '../cron-fanout'

/**
 * `forEachTenantChunked` is the canonical fan-out helper for cron
 * routes. Pre-this-helper, every cron processed tenants sequentially
 * — one slow tenant blocked the rest. The helper extracts the
 * proven `cron/learning` pattern so other crons (sync, score,
 * signals, enrich) can use the same shape.
 *
 * These tests pin the contract a refactor would otherwise drift on:
 *
 *   1. **Bounded concurrency** — chunks of N at a time, never more
 *      (the connection pool depends on this).
 *   2. **Failure isolation** — one tenant's reject never aborts the
 *      others (Promise.allSettled, not Promise.all).
 *   3. **Outcome aggregation** — the result faithfully reports
 *      ok/failed/records/errors so the caller can record an honest
 *      `partial`/`success`/`error` cron status.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('forEachTenantChunked', () => {
  it('runs every tenant exactly once', async () => {
    const tenants = [{ id: 't1' }, { id: 't2' }, { id: 't3' }]
    const seen: string[] = []
    const result = await forEachTenantChunked(tenants, async (t) => {
      seen.push(t.id)
      return 1
    })
    expect(seen.sort()).toEqual(['t1', 't2', 't3'])
    expect(result.ok).toBe(3)
    expect(result.failed).toBe(0)
    expect(result.records).toBe(3)
  })

  it('isolates one tenant failure from the rest', async () => {
    const tenants = [{ id: 't1' }, { id: 't2' }, { id: 't3' }]
    const result = await forEachTenantChunked(tenants, async (t) => {
      if (t.id === 't2') throw new Error('boom')
      return 5
    })
    expect(result.ok).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.records).toBe(10)
    expect(result.errors).toEqual([{ tenantId: 't2', error: 'boom' }])
  })

  it('respects chunk size by limiting concurrent in-flight calls', async () => {
    const tenants = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}` }))
    let inFlight = 0
    let maxInFlight = 0
    await forEachTenantChunked(
      tenants,
      async () => {
        inFlight++
        if (inFlight > maxInFlight) maxInFlight = inFlight
        await sleep(5)
        inFlight--
        return 1
      },
      { chunkSize: 3 },
    )
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  it('logs per-tenant failure with the supplied prefix', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await forEachTenantChunked(
      [{ id: 't1' }],
      async () => {
        throw new Error('test failure')
      },
      { logPrefix: '[cron/test]' },
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[cron/test] tenant=t1 fan-out failure: test failure'),
    )
    warn.mockRestore()
  })

  it('handles empty tenant list gracefully', async () => {
    const result = await forEachTenantChunked([], async () => 1)
    expect(result.ok).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.records).toBe(0)
  })

  it('non-numeric returns are stored in values but do not increment records', async () => {
    const result = await forEachTenantChunked([{ id: 't1' }], async () => ({
      hello: 'world',
    }))
    expect(result.ok).toBe(1)
    expect(result.records).toBe(0)
    expect(result.values).toEqual([{ hello: 'world' }])
  })
})

describe('statusFor', () => {
  it('all-success → success', () => {
    expect(statusFor({ ok: 3, failed: 0, records: 0, errors: [], values: [] })).toBe(
      'success',
    )
  })

  it('all-failed → error', () => {
    expect(statusFor({ ok: 0, failed: 3, records: 0, errors: [], values: [] })).toBe(
      'error',
    )
  })

  it('mixed → partial', () => {
    expect(statusFor({ ok: 2, failed: 1, records: 0, errors: [], values: [] })).toBe(
      'partial',
    )
  })

  it('zero/zero (no work) → partial (caller should treat as warning)', () => {
    expect(statusFor({ ok: 0, failed: 0, records: 0, errors: [], values: [] })).toBe(
      'partial',
    )
  })
})
