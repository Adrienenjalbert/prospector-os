import type { SupabaseClient } from '@supabase/supabase-js'
import {
  emitAgentEvent,
  urn,
  type TriggerPattern,
  type TriggerStatus,
} from '@prospector/core'
import { thompsonAdjust, type BetaPrior } from '@/lib/bandit/beta'

/**
 * Trigger bandit + lifecycle (Phase 7, Section 2.3).
 *
 * Per-trigger Beta posterior on `triggers.prior_alpha/beta` mirrors
 * the per-memory and per-wiki-page bandits from Phase 6. Same math
 * (extracted into `lib/bandit/beta.ts`), same Beta(1,1) cold start.
 *
 * Posterior update conventions:
 *
 *   - Trigger created             → Beta(1,1)              (no signal yet)
 *   - Trigger ACTED               → prior_alpha += 1       (success)
 *   - Trigger EXPIRED w/o action  → prior_beta += 1        (failure)
 *   - Trigger DISMISSED by admin  → prior_beta += 1        (failure)
 *   - Trigger surfaced & cited    → no per-row update; tracked at
 *                                   the PATTERN level by reflectMemories
 *                                   (Section 7.2) which observes
 *                                   "pattern X has 12 acted / 40 detected
 *                                   this week" and adjusts pattern-level
 *                                   confidence.
 *
 * Lifecycle transitions through `markTriggerActed` /
 * `markTriggerDismissed` / `markTriggerExpired`. Each emits the
 * matching telemetry event and lands a calibration_ledger row when
 * the transition is admin-driven.
 */

export interface TriggerPrior extends BetaPrior {
  trigger_id: string
  pattern: TriggerPattern
}

/**
 * Bulk-load triggers' priors. Used by the priority queue + the
 * `trigger-now` slice when ranking open triggers.
 */
export async function loadTriggerPriors(
  supabase: SupabaseClient,
  tenantId: string,
  triggerIds: string[],
): Promise<Map<string, TriggerPrior>> {
  const out = new Map<string, TriggerPrior>()
  if (triggerIds.length === 0) return out
  try {
    const { data, error } = await supabase
      .from('triggers')
      .select('id, pattern, prior_alpha, prior_beta')
      .eq('tenant_id', tenantId)
      .in('id', triggerIds)
    if (error) {
      console.warn('[trigger-bandit] load failed:', error.message)
      return out
    }
    for (const row of data ?? []) {
      out.set(row.id as string, {
        trigger_id: row.id as string,
        pattern: row.pattern as TriggerPattern,
        prior_alpha: Number(row.prior_alpha) || 1,
        prior_beta: Number(row.prior_beta) || 1,
      })
    }
  } catch (err) {
    console.warn('[trigger-bandit] load threw:', err)
  }
  return out
}

/**
 * Thompson-sample a trigger prior. Same magnitudes as the slice +
 * memory bandits ([-2, +2] adjustment) so callers can compose them
 * additively.
 */
export function thompsonAdjustForTrigger(prior: TriggerPrior | undefined): number {
  return thompsonAdjust(prior)
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

/**
 * Transition a trigger to `acted` and increment alpha.
 *
 *   - Called from /admin/triggers when an admin manually marks acted.
 *   - Called from the agent route when a recommended_tool tied to a
 *     trigger gets invoked.
 *   - Called from the attribution workflow when an outcome event
 *     correlates with the trigger within 14d.
 */
export async function markTriggerActed(
  supabase: SupabaseClient,
  tenantId: string,
  triggerId: string,
  opts: {
    actedBy?: string | null
    outcomeEventId?: string | null
  } = {},
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { data: row, error } = await supabase
      .from('triggers')
      .select('id, pattern, status, prior_alpha')
      .eq('tenant_id', tenantId)
      .eq('id', triggerId)
      .maybeSingle()
    if (error || !row) {
      return { ok: false, reason: 'trigger_not_found' }
    }
    if (row.status !== 'open') {
      return { ok: false, reason: `already_${row.status}` }
    }

    const { error: updateErr } = await supabase
      .from('triggers')
      .update({
        status: 'acted' as TriggerStatus,
        prior_alpha: Number(row.prior_alpha ?? 1) + 1,
        acted_at: new Date().toISOString(),
        acted_by: opts.actedBy ?? null,
        acted_outcome_event_id: opts.outcomeEventId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', triggerId)
      .eq('tenant_id', tenantId)
    if (updateErr) {
      return { ok: false, reason: updateErr.message }
    }

    await emitAgentEvent(supabase, {
      tenant_id: tenantId,
      event_type: 'trigger_acted',
      subject_urn: urn.trigger(tenantId, triggerId),
      payload: {
        trigger_id: triggerId,
        pattern: row.pattern,
        by_user: opts.actedBy ?? null,
        outcome_event_id: opts.outcomeEventId ?? null,
      },
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: String(err).slice(0, 200) }
  }
}

/**
 * Transition a trigger to `dismissed` (admin override) and
 * increment beta. Behaviourally identical to expired but tracked
 * separately so the pattern-level reflection workflow can
 * distinguish "the system was right, the rep declined" from "the
 * window passed silently".
 */
export async function markTriggerDismissed(
  supabase: SupabaseClient,
  tenantId: string,
  triggerId: string,
  opts: { reason?: string; dismissedBy?: string | null } = {},
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { data: row, error } = await supabase
      .from('triggers')
      .select('id, pattern, status, prior_beta')
      .eq('tenant_id', tenantId)
      .eq('id', triggerId)
      .maybeSingle()
    if (error || !row) return { ok: false, reason: 'trigger_not_found' }
    if (row.status !== 'open') return { ok: false, reason: `already_${row.status}` }

    const { error: updateErr } = await supabase
      .from('triggers')
      .update({
        status: 'dismissed' as TriggerStatus,
        prior_beta: Number(row.prior_beta ?? 1) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', triggerId)
      .eq('tenant_id', tenantId)
    if (updateErr) return { ok: false, reason: updateErr.message }

    await emitAgentEvent(supabase, {
      tenant_id: tenantId,
      event_type: 'trigger_dismissed',
      subject_urn: urn.trigger(tenantId, triggerId),
      payload: {
        trigger_id: triggerId,
        pattern: row.pattern,
        reason: opts.reason ?? null,
        by_user: opts.dismissedBy ?? null,
      },
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: String(err).slice(0, 200) }
  }
}

/**
 * Transition a trigger to `expired` and increment beta. Called by
 * `lintTriggers` (Section 7.1) for any trigger whose `expires_at`
 * has passed without action.
 *
 * Returns the count of rows transitioned. Bulk-update friendly:
 * lint-triggers passes the full set of (tenant, ids) once per
 * nightly run rather than per-row.
 */
export async function markTriggersExpired(
  supabase: SupabaseClient,
  tenantId: string,
  triggerIds: string[],
): Promise<number> {
  if (triggerIds.length === 0) return 0
  try {
    // Read priors in one round trip so the update batch increments
    // beta correctly. Read-modify-write is fine here — this runs
    // once nightly with no concurrent writers on the same row.
    const { data: rows } = await supabase
      .from('triggers')
      .select('id, pattern, prior_beta')
      .eq('tenant_id', tenantId)
      .in('id', triggerIds)
      .eq('status', 'open')
    if (!rows || rows.length === 0) return 0

    let transitioned = 0
    for (const row of rows) {
      const { error } = await supabase
        .from('triggers')
        .update({
          status: 'expired' as TriggerStatus,
          prior_beta: Number(row.prior_beta ?? 1) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id as string)
        .eq('tenant_id', tenantId)
        .eq('status', 'open') // CAS guard against races
      if (!error) {
        transitioned += 1
        await emitAgentEvent(supabase, {
          tenant_id: tenantId,
          event_type: 'trigger_expired',
          subject_urn: urn.trigger(tenantId, row.id as string),
          payload: {
            trigger_id: row.id,
            pattern: row.pattern,
          },
        })
      }
    }
    return transitioned
  } catch (err) {
    console.warn('[trigger-bandit] markTriggersExpired threw:', err)
    return 0
  }
}
