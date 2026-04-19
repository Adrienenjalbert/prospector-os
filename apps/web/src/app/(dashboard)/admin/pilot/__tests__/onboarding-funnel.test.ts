import { describe, expect, it } from 'vitest'
import { computeOnboardingFunnel } from '../page'

/**
 * Phase 3 T2.4 — onboarding funnel computation. Pure function, easy
 * to test with synthetic event arrays. Pins the contract that the
 * widget on /admin/pilot relies on: per-step started count, completed
 * count, completion %, median + p95 duration in ms.
 *
 * Edge cases worth pinning explicitly:
 *
 *   - Started without completed → counts as started, contributes
 *     no duration sample.
 *   - Completed without started → counts as completed, contributes
 *     no duration sample (we cannot compute duration without a
 *     start anchor).
 *   - Multiple started events for the same user (they bounced back)
 *     → use the earliest one.
 *   - Completed BEFORE started (clock skew / out-of-order delivery)
 *     → ignore that completion; do not produce negative duration.
 *   - Unknown event_type or unknown step → ignored entirely.
 *   - Missing user_id → ignored (we attribute duration per user).
 */

const step = (
  type: 'onboarding_step_started' | 'onboarding_step_completed',
  step: string,
  userId: string | null,
  isoTime: string,
) => ({
  user_id: userId,
  event_type: type,
  payload: { step },
  occurred_at: isoTime,
})

describe('computeOnboardingFunnel', () => {
  it('returns one row per known step in declaration order', () => {
    const rows = computeOnboardingFunnel([])
    expect(rows.map((r) => r.step)).toEqual([
      'welcome',
      'crm',
      'sync',
      'icp',
      'funnel',
      'preferences',
    ])
    for (const row of rows) {
      expect(row.started).toBe(0)
      expect(row.completed).toBe(0)
      expect(row.completionPct).toBe(0)
      expect(row.medianMs).toBeNull()
      expect(row.p95Ms).toBeNull()
    }
  })

  it('counts started + completed per user', () => {
    const events = [
      step('onboarding_step_started', 'crm', 'u1', '2026-04-18T10:00:00Z'),
      step('onboarding_step_completed', 'crm', 'u1', '2026-04-18T10:00:30Z'),
      step('onboarding_step_started', 'crm', 'u2', '2026-04-18T11:00:00Z'),
      step('onboarding_step_started', 'crm', 'u3', '2026-04-18T12:00:00Z'),
      step('onboarding_step_completed', 'crm', 'u3', '2026-04-18T12:01:00Z'),
    ]
    const crm = computeOnboardingFunnel(events).find((r) => r.step === 'crm')!
    expect(crm.started).toBe(3)
    expect(crm.completed).toBe(2)
    expect(crm.completionPct).toBe(67)
    // Two duration samples: 30s and 60s. Median (length 2 → idx 1) = 60000.
    expect(crm.medianMs).toBe(60_000)
  })

  it('ignores completed events before the earliest started (clock skew safety)', () => {
    // Completion arrives 10 minutes before any started event.
    const events = [
      step('onboarding_step_completed', 'crm', 'u1', '2026-04-18T10:00:00Z'),
      step('onboarding_step_started', 'crm', 'u1', '2026-04-18T10:10:00Z'),
    ]
    const crm = computeOnboardingFunnel(events).find((r) => r.step === 'crm')!
    expect(crm.started).toBe(1)
    expect(crm.completed).toBe(1)
    // No valid completion-after-start → no duration sample.
    expect(crm.medianMs).toBeNull()
    expect(crm.p95Ms).toBeNull()
  })

  it('uses earliest started when a user bounces back to the same step', () => {
    const events = [
      step('onboarding_step_started', 'crm', 'u1', '2026-04-18T10:00:00Z'),
      step('onboarding_step_started', 'crm', 'u1', '2026-04-18T10:30:00Z'),
      step('onboarding_step_completed', 'crm', 'u1', '2026-04-18T11:00:00Z'),
    ]
    const crm = computeOnboardingFunnel(events).find((r) => r.step === 'crm')!
    expect(crm.started).toBe(1)
    expect(crm.completed).toBe(1)
    // Duration = 11:00:00 - 10:00:00 = 60 minutes = 3_600_000 ms.
    expect(crm.medianMs).toBe(3_600_000)
  })

  it('ignores events with no user_id', () => {
    const events = [
      step('onboarding_step_started', 'crm', null, '2026-04-18T10:00:00Z'),
      step('onboarding_step_completed', 'crm', null, '2026-04-18T10:00:30Z'),
    ]
    const crm = computeOnboardingFunnel(events).find((r) => r.step === 'crm')!
    expect(crm.started).toBe(0)
    expect(crm.completed).toBe(0)
  })

  it('ignores events with an unknown step', () => {
    const events = [
      step('onboarding_step_started', 'mystery', 'u1', '2026-04-18T10:00:00Z'),
    ]
    const rows = computeOnboardingFunnel(events)
    for (const row of rows) {
      expect(row.started).toBe(0)
    }
  })

  it('computes p95 over the duration distribution', () => {
    // 10 users on the sync step with linearly-spaced durations
    // 10s, 20s, …, 100s. P95 lands on the second-from-last sample
    // (index 9 with floor(0.95 * 10) = 9 → 100_000 ms).
    const base = Date.parse('2026-04-18T10:00:00Z')
    const events: ReturnType<typeof step>[] = []
    for (let i = 0; i < 10; i++) {
      const startIso = new Date(base + i * 60_000).toISOString()
      const completeIso = new Date(
        base + i * 60_000 + (i + 1) * 10_000,
      ).toISOString()
      events.push(
        step('onboarding_step_started', 'sync', `u${i}`, startIso),
        step('onboarding_step_completed', 'sync', `u${i}`, completeIso),
      )
    }
    const sync = computeOnboardingFunnel(events).find((r) => r.step === 'sync')!
    expect(sync.started).toBe(10)
    expect(sync.completed).toBe(10)
    expect(sync.completionPct).toBe(100)
    // Sorted durations: 10000, 20000, ..., 100000.
    // floor(0.5 * 10) = 5 → median = sorted[5] = 60000.
    expect(sync.medianMs).toBe(60_000)
    expect(sync.p95Ms).toBe(100_000)
  })

  it('treats users with completed-only as completed without a sample', () => {
    const events = [
      step('onboarding_step_completed', 'icp', 'u1', '2026-04-18T10:00:00Z'),
    ]
    const icp = computeOnboardingFunnel(events).find((r) => r.step === 'icp')!
    expect(icp.started).toBe(0)
    expect(icp.completed).toBe(1)
    // 0% completion among started since nobody started.
    expect(icp.completionPct).toBe(0)
    expect(icp.medianMs).toBeNull()
  })
})
