/**
 * Phase 3 T2.4 — pure helpers for the baseline-survey nag.
 *
 * Lives outside `app/actions/` because Next.js's `'use server'`
 * directive prohibits non-async exports. The server action module
 * (`onboarding-instrumentation.ts`) imports these.
 */

/**
 * How long a snooze lasts. The proposal called for 7 days; surfaced
 * here so a future operator-config can override it if the nag is
 * dismissed too aggressively.
 */
export const BASELINE_NAG_SNOOZE_DAYS = 7

export const BASELINE_NAG_SNOOZE_KEY = 'baseline_nag_snoozed_until'

/**
 * Decodes the raw snooze value stored in
 * `user_profiles.metadata.baseline_nag_snoozed_until`.
 *
 * Returns the ISO timestamp if the snooze is still active, or
 * `null` if the value is missing, malformed, or expired. The
 * fail-safe stance (return null on any malformed input) means the
 * nag re-shows by default — better to surface an actionable
 * prompt than to let a corrupt metadata blob suppress it forever.
 */
export function decodeSnoozeValue(
  rawValue: unknown,
  now: number = Date.now(),
): string | null {
  if (typeof rawValue !== 'string') return null
  const parsedDate = Date.parse(rawValue)
  if (!Number.isFinite(parsedDate)) return null
  if (parsedDate <= now) return null
  return rawValue
}

/**
 * Compute the next snooze-until timestamp from a given "now" in ms
 * since epoch. Pure for unit testing.
 */
export function computeSnoozeUntil(nowMs: number): string {
  return new Date(
    nowMs + BASELINE_NAG_SNOOZE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
}
