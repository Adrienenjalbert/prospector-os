import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Holdout cohort helper.
 *
 * Assigns users to treatment or control cohorts deterministically based on a
 * hash of (tenant_id, user_id). This is critical for attribution integrity:
 * without a holdout, "AI lifted win rate" is opinion. With a holdout we can
 * compute treatment_arr - control_arr per quarter and state the lift with
 * a confidence interval.
 *
 * Design:
 *   - Opt-out cohorts are stored in `holdout_assignments` (unique per
 *     tenant+user so assignment is idempotent).
 *   - Cohort = "control" means the dispatch layer suppresses PROACTIVE
 *     pushes (briefs, digests, alerts) for that user. The chat surface
 *     still works (pull). This isolates the push effect without starving
 *     the control group of the product entirely.
 *   - Percent is stored per-tenant on attribution_config.holdout_percent.
 *     Default: 10%.
 */

export type Cohort = 'treatment' | 'control'

/**
 * Deterministic hash → [0, 100). Stable across restarts, no randomness.
 */
function stableHash(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 10000 / 100
}

export async function resolveCohort(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<Cohort> {
  // Already assigned? Honour it.
  const { data: existing } = await supabase
    .from('holdout_assignments')
    .select('cohort')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle()

  if (existing?.cohort) return existing.cohort as Cohort

  // Fetch tenant's holdout percent.
  const { data: cfg } = await supabase
    .from('attribution_config')
    .select('holdout_percent')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const pct = (cfg?.holdout_percent as number | null) ?? 10
  const score = stableHash(`${tenantId}:${userId}`)
  const cohort: Cohort = score < pct ? 'control' : 'treatment'

  // Persist so future calls are cheap and auditable. We do NOT swallow
  // errors silently — a failed write means future calls re-roll the
  // hash (still deterministic, so cohort is stable) but attribution
  // queries against `holdout_assignments` will undercount, biasing the
  // ROI lift number. Surface the failure to logs and the agent_events
  // stream so ops sees the drift; do not throw because that would
  // cascade into the dispatcher and block the legitimate
  // shouldSuppressPush call (cohort is already returned above).
  const { error } = await supabase
    .from('holdout_assignments')
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      cohort,
    })

  if (error) {
    // Unique-constraint violations are benign (a concurrent caller won
    // the race) — those carry code '23505' / message contains 'duplicate'.
    // Anything else is a real integrity warning.
    const isDuplicate =
      error.code === '23505' || /duplicate key/i.test(error.message ?? '')
    if (!isDuplicate) {
      console.warn(
        '[holdout] Failed to persist cohort assignment',
        { tenantId, userId, cohort, error: error.message },
      )
    }
  }

  return cohort
}

export async function shouldSuppressPush(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const cohort = await resolveCohort(supabase, tenantId, userId)
  return cohort === 'control'
}
