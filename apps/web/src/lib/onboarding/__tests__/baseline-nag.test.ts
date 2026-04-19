import { describe, expect, it } from 'vitest'
import {
  BASELINE_NAG_SNOOZE_DAYS,
  BASELINE_NAG_SNOOZE_KEY,
  computeSnoozeUntil,
  decodeSnoozeValue,
} from '../baseline-nag'

/**
 * Phase 3 T2.4 — pure helpers for the baseline-survey nag.
 *
 * These pin the contract that determines whether the inbox
 * /admin nag re-shows after a snooze. Critical because:
 *
 *   - A bug that returns "still snoozed" forever silently kills
 *     ROI tracking for that user (they never anchor a baseline).
 *   - A bug that ignores valid snoozes is a low-severity UX
 *     annoyance.
 *
 * Fail-safe stance: any malformed input → `null` → nag re-shows.
 * The tests assert this stance by construction.
 */

describe('decodeSnoozeValue', () => {
  const NOW = Date.parse('2026-04-18T12:00:00Z')

  it('returns null for null / undefined', () => {
    expect(decodeSnoozeValue(null, NOW)).toBeNull()
    expect(decodeSnoozeValue(undefined, NOW)).toBeNull()
  })

  it('returns null for non-string inputs', () => {
    expect(decodeSnoozeValue(42, NOW)).toBeNull()
    expect(decodeSnoozeValue({}, NOW)).toBeNull()
    expect(decodeSnoozeValue([], NOW)).toBeNull()
    expect(decodeSnoozeValue(true, NOW)).toBeNull()
  })

  it('returns null for unparseable date strings', () => {
    expect(decodeSnoozeValue('', NOW)).toBeNull()
    expect(decodeSnoozeValue('not a date', NOW)).toBeNull()
    expect(decodeSnoozeValue('2026-13-99', NOW)).toBeNull()
  })

  it('returns null for snoozes that have already expired', () => {
    expect(decodeSnoozeValue('2026-04-18T11:59:59Z', NOW)).toBeNull()
    expect(decodeSnoozeValue('2025-01-01T00:00:00Z', NOW)).toBeNull()
  })

  it('returns null for snoozes whose timestamp equals "now"', () => {
    // Boundary: equality counts as expired so the nag re-shows
    // immediately. Better to over-show than to under-show.
    expect(decodeSnoozeValue('2026-04-18T12:00:00Z', NOW)).toBeNull()
  })

  it('returns the original ISO string for active snoozes', () => {
    const future = '2026-04-25T12:00:00Z'
    expect(decodeSnoozeValue(future, NOW)).toBe(future)
  })

  it('respects timezone offsets in the stored value', () => {
    // Stored as +02:00; equivalent to 10:00:00Z. Snooze is 7 days
    // out, well past NOW.
    expect(decodeSnoozeValue('2026-04-25T12:00:00+02:00', NOW)).toBe(
      '2026-04-25T12:00:00+02:00',
    )
  })
})

describe('computeSnoozeUntil', () => {
  it('returns now + 7 days as ISO string', () => {
    const now = Date.parse('2026-04-18T12:00:00Z')
    const untilIso = computeSnoozeUntil(now)
    expect(untilIso).toBe('2026-04-25T12:00:00.000Z')
  })

  it('survives a round-trip through decodeSnoozeValue', () => {
    const now = Date.parse('2026-04-18T12:00:00Z')
    const untilIso = computeSnoozeUntil(now)
    expect(decodeSnoozeValue(untilIso, now)).toBe(untilIso)
  })

  it('uses the BASELINE_NAG_SNOOZE_DAYS constant', () => {
    // If someone bumps the constant to e.g. 14 we want the test to
    // mechanically agree (vs hard-coding 7).
    const now = Date.parse('2026-04-18T12:00:00Z')
    const expectedMs = now + BASELINE_NAG_SNOOZE_DAYS * 24 * 60 * 60 * 1000
    expect(Date.parse(computeSnoozeUntil(now))).toBe(expectedMs)
  })
})

describe('module constants', () => {
  it('BASELINE_NAG_SNOOZE_KEY matches the value persisted to user_profiles.metadata', () => {
    // Migration 012 documents the key in the COMMENT; the snooze
    // server action writes this key. If they drift, snooze writes
    // succeed but reads return null → nag never goes away. Pin it.
    expect(BASELINE_NAG_SNOOZE_KEY).toBe('baseline_nag_snoozed_until')
  })

  it('BASELINE_NAG_SNOOZE_DAYS matches the proposal (7 days)', () => {
    expect(BASELINE_NAG_SNOOZE_DAYS).toBe(7)
  })
})
