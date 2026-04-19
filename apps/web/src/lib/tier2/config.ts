import { z } from 'zod'

/**
 * Phase 3 T3.2 — pure helpers for the tenant tier-2 CRM write-back
 * enablement config.
 *
 * Lives outside the API route + the tool-loader because both need
 * the same `isCrmWriteEnabled` predicate, and the config shape +
 * validation rules are easier to unit-test as a pure module.
 */

// ---------------------------------------------------------------------------
// Slug → config-key mapping
// ---------------------------------------------------------------------------

/**
 * The three CRM write tool slugs T3.2 governs. Each maps to a
 * config key on `tenants.crm_write_config`. Any future write tool
 * needs an entry here AND a matching column-key in the migration's
 * default JSONB.
 */
export const TIER2_WRITE_TOOL_KEY: Record<string, keyof Tier2WriteToggles> = {
  log_crm_activity: 'log_activity',
  update_crm_property: 'update_property',
  create_crm_task: 'create_task',
}

export const TIER2_WRITE_TOOL_SLUGS: ReadonlyArray<string> = Object.keys(
  TIER2_WRITE_TOOL_KEY,
)

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

/** The boolean toggle keys. Each maps 1:1 to a CRM write tool slug. */
export interface Tier2WriteToggles {
  log_activity: boolean
  update_property: boolean
  create_task: boolean
}

/** Sticky audit-trail fields on the config blob. */
export interface Tier2AuditMarkers {
  /** ISO timestamp of last toggle ON of any tool. */
  _enabled_at: string | null
  /** user_id of the toggler. */
  _enabled_by: string | null
  /**
   * True after the admin has signed the acknowledgement at least
   * once. Sticky — does not reset when a tool toggles back off.
   * Re-signing required only after a 365-day expiry (TBD; not in
   * T3.2 scope) or after the platform's tier-2-writes.md docs
   * change materially.
   */
  _acknowledgement_signed: boolean
  _acknowledgement_signed_at: string | null
  _acknowledgement_signed_by: string | null
}

export type Tier2WriteConfig = Tier2WriteToggles & Tier2AuditMarkers

/** Default for any tenant whose `crm_write_config` is null/missing. */
export const DEFAULT_TIER2_CONFIG: Tier2WriteConfig = {
  log_activity: false,
  update_property: false,
  create_task: false,
  _enabled_at: null,
  _enabled_by: null,
  _acknowledgement_signed: false,
  _acknowledgement_signed_at: null,
  _acknowledgement_signed_by: null,
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

/**
 * Zod schema for the full config shape. Used by the API route to
 * validate POST bodies before persisting. JSONB lets garbage land
 * if we don't validate; this schema is the second line of defence
 * after the UI.
 */
export const tier2WriteConfigSchema = z.object({
  log_activity: z.boolean(),
  update_property: z.boolean(),
  create_task: z.boolean(),
  _enabled_at: z.string().datetime().nullable(),
  _enabled_by: z.string().uuid().nullable(),
  _acknowledgement_signed: z.boolean(),
  _acknowledgement_signed_at: z.string().datetime().nullable(),
  _acknowledgement_signed_by: z.string().uuid().nullable(),
})

// ---------------------------------------------------------------------------
// Pure predicates
// ---------------------------------------------------------------------------

/**
 * Decode a raw JSONB blob (untyped Supabase return) into a typed
 * `Tier2WriteConfig`. Tolerates:
 *   - null / undefined → DEFAULT_TIER2_CONFIG.
 *   - missing keys → backfilled with DEFAULT.
 *   - wrong types → backfilled with DEFAULT for that key.
 *
 * Fail-safe: any malformed input → DEFAULT (everything OFF). Better
 * to under-enable than over-enable when the config drifts.
 */
export function decodeTier2Config(raw: unknown): Tier2WriteConfig {
  if (raw == null || typeof raw !== 'object') return { ...DEFAULT_TIER2_CONFIG }
  const r = raw as Record<string, unknown>
  return {
    log_activity: typeof r.log_activity === 'boolean' ? r.log_activity : false,
    update_property:
      typeof r.update_property === 'boolean' ? r.update_property : false,
    create_task: typeof r.create_task === 'boolean' ? r.create_task : false,
    _enabled_at: typeof r._enabled_at === 'string' ? r._enabled_at : null,
    _enabled_by: typeof r._enabled_by === 'string' ? r._enabled_by : null,
    _acknowledgement_signed:
      typeof r._acknowledgement_signed === 'boolean'
        ? r._acknowledgement_signed
        : false,
    _acknowledgement_signed_at:
      typeof r._acknowledgement_signed_at === 'string'
        ? r._acknowledgement_signed_at
        : null,
    _acknowledgement_signed_by:
      typeof r._acknowledgement_signed_by === 'string'
        ? r._acknowledgement_signed_by
        : null,
  }
}

/**
 * Returns true when the given write tool slug is enabled for the
 * tenant. Used by the tool-loader to decide whether to include the
 * tool in the agent's available set.
 *
 * Semantics:
 *   - Slug not in the tier-2 list → returns true (the gate doesn't
 *     apply; tool authorization is governed by the existing
 *     `available_to_roles` + `enabled` checks).
 *   - Slug in the list, config flag false → returns false (tool
 *     excluded).
 *   - Slug in the list, config flag true → returns true.
 */
export function isCrmWriteEnabled(
  slug: string,
  config: Tier2WriteConfig,
): boolean {
  const key = TIER2_WRITE_TOOL_KEY[slug]
  if (!key) return true
  return config[key] === true
}

/**
 * Computes which slugs from the tier-2 list are currently disabled
 * for the tenant. Used by the loader to optionally emit telemetry
 * for "tenant has the registry row but config gates it off".
 */
export function disabledTier2Slugs(config: Tier2WriteConfig): string[] {
  const disabled: string[] = []
  for (const slug of TIER2_WRITE_TOOL_SLUGS) {
    if (!isCrmWriteEnabled(slug, config)) disabled.push(slug)
  }
  return disabled
}

// ---------------------------------------------------------------------------
// Update validation
// ---------------------------------------------------------------------------

export interface Tier2UpdateInput {
  next: Tier2WriteToggles
  acknowledged: boolean
  userId: string
  now: Date
}

/**
 * Apply a toggle update on top of the previous config, enforcing
 * the acknowledgement rule:
 *
 *   - If ANY tool is being turned from OFF → ON, the previous
 *     config must already have `_acknowledgement_signed === true`,
 *     OR the update payload must include `acknowledged: true`.
 *   - Toggling a tool OFF never requires the acknowledgement.
 *   - Re-saving an unchanged config never requires the
 *     acknowledgement.
 *
 * Returns either the new merged config (with updated audit markers)
 * or a structured error the API route can surface to the UI.
 */
export type Tier2UpdateResult =
  | { ok: true; config: Tier2WriteConfig }
  | { ok: false; error: string }

export function applyTier2Update(
  prev: Tier2WriteConfig,
  input: Tier2UpdateInput,
): Tier2UpdateResult {
  const turningOn =
    (input.next.log_activity && !prev.log_activity) ||
    (input.next.update_property && !prev.update_property) ||
    (input.next.create_task && !prev.create_task)

  if (turningOn) {
    if (!prev._acknowledgement_signed && !input.acknowledged) {
      return {
        ok: false,
        error:
          'Enabling a CRM write tool requires the tier-2 acknowledgement. Tick the acknowledgement box and resubmit.',
      }
    }
  }

  const nowIso = input.now.toISOString()

  const ackSigned = prev._acknowledgement_signed || input.acknowledged
  const ackSignedAt = prev._acknowledgement_signed
    ? prev._acknowledgement_signed_at
    : input.acknowledged
      ? nowIso
      : null
  const ackSignedBy = prev._acknowledgement_signed
    ? prev._acknowledgement_signed_by
    : input.acknowledged
      ? input.userId
      : null

  // Update _enabled_at + _enabled_by only when something is toggling
  // ON in this update. Toggle-OFF or no-change preserves the prior
  // markers — they're a record of the most recent activation, not
  // the most recent change.
  const enabledAt = turningOn ? nowIso : prev._enabled_at
  const enabledBy = turningOn ? input.userId : prev._enabled_by

  return {
    ok: true,
    config: {
      log_activity: input.next.log_activity,
      update_property: input.next.update_property,
      create_task: input.next.create_task,
      _enabled_at: enabledAt,
      _enabled_by: enabledBy,
      _acknowledgement_signed: ackSigned,
      _acknowledgement_signed_at: ackSignedAt,
      _acknowledgement_signed_by: ackSignedBy,
    },
  }
}
