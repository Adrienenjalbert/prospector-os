import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Admin audit log — Phase 3 T2.1.
 *
 * Append-only record of every admin write to a tenant config or
 * proposal. Lives in `admin_audit_log` (migration 011). The shape:
 * action slug + target description + before/after JSONB snapshots +
 * caller-supplied metadata + actor user_id + occurred_at timestamp.
 *
 * Every admin write path that mutates tenant-visible state should
 * call `recordAdminAction` AFTER the underlying mutation succeeds.
 * Failed mutations do NOT write audit rows (the convention is
 * "record-what-actually-happened", not "record-what-was-attempted").
 *
 * Telemetry contract:
 *   - Failures are swallowed (warn + continue). The audit log is
 *     load-bearing for trust but NOT for correctness — if the
 *     audit-log insert fails, the underlying admin action still
 *     succeeded and the user shouldn't see an opaque error. Ops
 *     reads server logs for missing audit-row warnings.
 *   - Each call is a single fire-and-forget INSERT. No batching;
 *     admin actions are low-frequency by definition (~tens per
 *     tenant per week, not thousands per second like agent_events).
 */

/**
 * Closed enum of action slugs we record today. Adding a new slug
 * requires a UI update in `/admin/audit-log` to render it cleanly,
 * so we centralise the type to make missing UI cases a compile
 * error.
 *
 * Slug format: `<surface>.<verb>` where `<surface>` matches the
 * admin-route segment (`config`, `calibration`, `onboarding`,
 * `tier2` (T3.2), `retention` (T1.3 follow-up), `holdout` (T3.3),
 * `tenant` (T2.3 export)).
 */
export type AdminActionSlug =
  | 'config.upsert'
  | 'calibration.approve'
  | 'calibration.reject'
  | 'onboarding.apply_icp'
  | 'onboarding.apply_funnel'
  // Phase 3 T3.2 — `tier2.toggle` records every change to
  // `tenants.crm_write_config`. before/after capture the full
  // config blob; `metadata.acknowledged_in_this_request` flags
  // whether the admin signed the acknowledgement during this
  // particular update.
  | 'tier2.toggle'

/**
 * Input shape for a single audit record. Every field except
 * `user_id`, `before`, `after`, and `metadata` is required.
 */
export interface AdminAuditInput {
  /** Tenant the action affects. */
  tenant_id: string
  /**
   * Auth user performing the action. NULL only for system-level
   * actions (none in T2.1; reserved for future workflow-driven
   * admin paths).
   */
  user_id: string | null
  /** Slug from `AdminActionSlug` (or future extension). */
  action: AdminActionSlug | string
  /**
   * Description of WHAT was changed. Examples:
   *   - 'tenants.icp_config'
   *   - 'tenants.scoring_config.propensity_weights'
   *   - 'calibration_proposals[uuid:abc-123]'
   * Format is free-form; the audit-log UI renders it verbatim.
   */
  target: string
  /**
   * JSONB snapshot of the prior state. NULL means "no prior
   * state" (the action created the row). Capped by the helper at
   * 256KB to match the admin-config payload cap.
   */
  before?: unknown
  /**
   * JSONB snapshot of the resulting state. NULL means "no
   * resulting state" (the action deleted the row, or rejected a
   * proposal without applying it).
   */
  after?: unknown
  /**
   * Caller-supplied extras: proposal_id, http request id,
   * tier-2 acknowledgement signature, anything that gives an
   * auditor more context. Schemaless.
   */
  metadata?: Record<string, unknown>
}

/**
 * Hard cap on each JSONB column to mirror the admin-config payload
 * cap. Prevents a malicious or accidental large blob from bloating
 * the table.
 */
const MAX_JSONB_BYTES = 256 * 1024

/**
 * Truncate a JSONB blob to fit under the cap. Returns either the
 * original value or a sentinel object containing `__truncated: true`
 * + a length marker — auditors see "we tried to record this but it
 * was too large" rather than silent data loss.
 */
function capJsonb(value: unknown): unknown {
  if (value == null) return value
  let serialised: string
  try {
    serialised = JSON.stringify(value)
  } catch (err) {
    return {
      __serialise_error: err instanceof Error ? err.message : String(err),
    }
  }
  if (serialised.length <= MAX_JSONB_BYTES) return value
  return {
    __truncated: true,
    __original_size_bytes: serialised.length,
    __cap_bytes: MAX_JSONB_BYTES,
  }
}

/**
 * Record one admin action. Fire-and-forget — failures are logged
 * but never thrown. Returns the inserted row id on success, null
 * on failure (so callers that DO want to know can branch on it).
 */
export async function recordAdminAction(
  supabase: SupabaseClient,
  input: AdminAuditInput,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('admin_audit_log')
      .insert({
        tenant_id: input.tenant_id,
        user_id: input.user_id,
        action: input.action,
        target: input.target,
        before: capJsonb(input.before ?? null),
        after: capJsonb(input.after ?? null),
        metadata: input.metadata ?? {},
      })
      .select('id')
      .single()
    if (error) {
      console.warn(
        `[audit] admin_audit_log insert failed: action=${input.action} tenant=${input.tenant_id} err=${error.message}`,
      )
      return null
    }
    return (data as { id: string } | null)?.id ?? null
  } catch (err) {
    console.warn(
      `[audit] admin_audit_log insert threw: action=${input.action} tenant=${input.tenant_id}`,
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

// Re-export the cap so admin routes that pre-validate request size
// can match the audit cap (no point recording a payload bigger than
// the request would accept).
export { MAX_JSONB_BYTES as AUDIT_MAX_JSONB_BYTES }
