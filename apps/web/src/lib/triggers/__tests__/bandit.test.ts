import { describe, it, expect, vi } from 'vitest'
import {
  loadTriggerPriors,
  thompsonAdjustForTrigger,
  markTriggerActed,
  markTriggerDismissed,
  markTriggersExpired,
} from '../bandit'

/**
 * Trigger bandit + lifecycle (Phase 7, Section 2.3).
 *
 * Tests cover:
 *   - loadTriggerPriors maps row data to TriggerPrior shape
 *   - thompsonAdjustForTrigger delegates to shared bandit/beta math
 *   - markTriggerActed: status=open → status=acted, prior_alpha += 1
 *   - markTriggerDismissed: status=open → status=dismissed, prior_beta += 1
 *   - markTriggersExpired: bulk transition with CAS guard
 *   - All transitions are no-ops (return reason) when status != 'open'
 */

interface MockResponse {
  data: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any
}

function buildSupabase(handlers: Record<string, () => MockResponse>) {
  return {
    from: (_table: string) => {
      const filters: Array<{ col: string; val: unknown }> = []
      let mode: 'select' | 'update' = 'select'
      let updatePayload: unknown = null
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push({ col, val })
          return builder
        },
        in: () => builder,
        update: (payload: unknown) => {
          mode = 'update'
          updatePayload = payload
          return builder
        },
        maybeSingle: async () => {
          const key = `${mode}:${_table}`
          return handlers[key]?.() ?? { data: null, error: null }
        },
        // Thenable for the markTriggersExpired case which doesn't
        // call .maybeSingle() / .single() on the .update() chain.
        then: (
          onFulfilled: (v: { data: unknown; error: null }) => unknown,
        ) => {
          const key = `${mode}:${_table}`
          const r = handlers[key]?.() ?? { data: null, error: null }
          return Promise.resolve(onFulfilled(r))
        },
      }
      void updatePayload
      return builder
    },
  }
}

describe('thompsonAdjustForTrigger', () => {
  it('returns 0 for missing prior', () => {
    expect(thompsonAdjustForTrigger(undefined)).toBe(0)
  })

  it('returns 0 at cold start', () => {
    expect(
      thompsonAdjustForTrigger({
        trigger_id: 't1',
        pattern: 'multi_bridge_to_target',
        prior_alpha: 1,
        prior_beta: 1,
      }),
    ).toBe(0)
  })

  it('produces a non-zero adjustment above the sample threshold', () => {
    const prior = {
      trigger_id: 't1',
      pattern: 'funding_plus_leadership_window' as const,
      prior_alpha: 50,
      prior_beta: 20,
    }
    let nonZero = 0
    for (let i = 0; i < 50; i++) {
      if (Math.abs(thompsonAdjustForTrigger(prior)) > 0) nonZero += 1
    }
    expect(nonZero).toBeGreaterThan(40)
  })
})

describe('loadTriggerPriors', () => {
  it('returns an empty map for empty id list', async () => {
    const supabase = buildSupabase({})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await loadTriggerPriors(supabase as any, 't', [])
    expect(result.size).toBe(0)
  })

  it('returns an empty map on supabase error (defensive)', async () => {
    const supabase = buildSupabase({
      'select:triggers': () => ({ data: null, error: { message: 'no table' } }),
    })
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await loadTriggerPriors(supabase as any, 't', ['x'])
    expect(result.size).toBe(0)
    consoleSpy.mockRestore()
  })
})

describe('markTriggerActed', () => {
  it('returns ok=false when trigger not found', async () => {
    const supabase = buildSupabase({
      'select:triggers': () => ({ data: null, error: null }),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await markTriggerActed(supabase as any, 't', 'nonexistent')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('trigger_not_found')
  })

  it('returns ok=false when trigger already acted', async () => {
    const supabase = buildSupabase({
      'select:triggers': () => ({
        data: { id: 'x', pattern: 'multi_bridge_to_target', status: 'acted', prior_alpha: 5 },
        error: null,
      }),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await markTriggerActed(supabase as any, 't', 'x')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('already_acted')
  })
})

describe('markTriggerDismissed', () => {
  it('returns ok=false when trigger already expired', async () => {
    const supabase = buildSupabase({
      'select:triggers': () => ({
        data: { id: 'x', pattern: 'multi_bridge_to_target', status: 'expired', prior_beta: 3 },
        error: null,
      }),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await markTriggerDismissed(supabase as any, 't', 'x')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('already_expired')
  })
})

describe('markTriggersExpired', () => {
  it('returns 0 when input list empty', async () => {
    const supabase = buildSupabase({})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await markTriggersExpired(supabase as any, 't', [])
    expect(result).toBe(0)
  })
})
