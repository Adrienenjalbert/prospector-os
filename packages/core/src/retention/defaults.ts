/**
 * Phase 3 T1.3 — retention defaults.
 *
 * The retention-sweep workflow (`apps/web/src/lib/workflows/retention-sweep.ts`)
 * reads the platform default window for each table from this map. Per-tenant
 * overrides live in the `retention_policies` table (see migration
 * `packages/db/migrations/010_retention_policies.sql`).
 *
 * Hard rule from OQ-4: per-tenant overrides may only LENGTHEN the window,
 * never shorten. Enforced at the write boundary in the admin config route
 * (`apps/web/src/app/api/admin/config/route.ts`).
 *
 * Hard ceiling: 7 years (2555 days). Enforced via DB CHECK constraint.
 *
 * Adding a new retention target requires:
 *   1. Adding the entry here.
 *   2. Adding the literal to the CHECK constraint in migration 010.
 *      (A new migration if 010 is already shipped — never edit a shipped
 *      migration; write a new one.)
 *   3. Adding a switch branch in the retention-sweep workflow handler.
 *
 * Each entry's comment explains the rationale, ESPECIALLY where the value
 * differs from the OQ-4 owner answer.
 */

export type RetentionTableName =
  | 'agent_events'
  | 'outcome_events'
  | 'attributions'
  | 'transcripts_raw_text'
  | 'transcripts_summary'
  | 'ai_conversations'
  | 'ai_conversation_notes'
  | 'agent_citations'
  | 'webhook_deliveries'

/**
 * Platform-wide default retention windows in days. Per-tenant overrides
 * are written to `retention_policies` and may only LENGTHEN these.
 */
export const RETENTION_DEFAULT_DAYS: Record<RetentionTableName, number> = {
  /**
   * **`agent_events` — 730 days (24 months).**
   *
   * **Cursor disagreement with OQ-4.** Owner answer: 12 months. Cursor
   * pushback: the bandit and exemplar miner derive long-lived signal from
   * `agent_events`. The champion-alumni detector specifically uses a
   * 730-day lookback (`apps/web/src/lib/workflows/champion-alumni-detector.ts:48`).
   * Twelve-month retention starves these consumers. The proper long-term
   * fix is to snapshot derived state (`tool_priors`, `exemplars`,
   * `retrieval_priors`) into long-lived tables BEFORE purge — that work
   * lives in T7.7. Until then, this default is 24 months.
   *
   * Re-reduce to 365 once T7.7 ships.
   */
  agent_events: 730,

  /**
   * **`outcome_events` — 1095 days (36 months).** CFO-facing ROI claims
   * (influenced ARR, win-rate lift, holdout-cohort lift) read this table
   * across multi-quarter windows. Three years gives quarterly business
   * reviews enough history to show lift over a renewal cycle.
   */
  outcome_events: 1095,

  /**
   * **`attributions` — 1095 days (36 months).** Tied to `outcome_events`
   * — every attribution joins to one. Truncating attributions earlier
   * would orphan outcome events from their cause. Match the linked table.
   */
  attributions: 1095,

  /**
   * **`transcripts.raw_text` — 90 days, COLUMN-LEVEL NULL (not row
   * delete).** Raw transcripts contain the most sensitive PII (third-
   * party names, off-the-cuff remarks, sensitive commercial discussion).
   * The product value lives in the derived `summary` + embedding (which
   * survive at 1095 days). The retention-sweep workflow special-cases
   * this entry: it UPDATEs `transcripts SET raw_text = NULL` rather than
   * DELETEing the row.
   */
  transcripts_raw_text: 90,

  /**
   * **`transcripts.summary` (and the row itself) — 1095 days (36 months).**
   * The summary + embedding are the cite-able product value the brief
   * generator + search_transcripts read for years after the call. Match
   * the outcome-event horizon so attribution between calls and won deals
   * stays intact.
   */
  transcripts_summary: 1095,

  /**
   * **`ai_conversations` — 180 days (6 months rolling).** Chat history
   * is high-volume and quick to drift out of relevance. Six months
   * preserves enough context for the conversation-memory slice to find
   * recent threads while bounding the table size.
   */
  ai_conversations: 180,

  /**
   * **`ai_conversation_notes` — 90 days.** Per OQ-4 owner directive:
   * "ai_conversation_notes retention should equal raw_text retention or
   * shorter, because those notes frequently quote transcripts verbatim
   * — long-retained notes become a backdoor around the 90-day transcript
   * limit." Matched to raw_text at 90 days.
   */
  ai_conversation_notes: 90,

  /**
   * **`agent_citations` — 730 days (24 months).** Tied to `agent_events`
   * — every citation row references an `interaction_id`. Match the
   * agent_events window so citations don't dangle.
   */
  agent_citations: 730,

  /**
   * **`webhook_deliveries` — 30 days.** Used purely for replay-protection
   * idempotency. After 30 days the source system has long forgotten the
   * delivery; we don't need to remember it either.
   */
  webhook_deliveries: 30,
}

/**
 * Hard ceiling on any per-tenant override. Per OQ-4: "Cap the max at 7
 * years." Enforced both here (for admin-route validation) and via the DB
 * CHECK constraint (defence in depth).
 */
export const RETENTION_MAX_DAYS = 2555

/**
 * The complete set of allowed table names. Used by validators that don't
 * import the type directly (e.g. JSON-Schema generators).
 */
export const RETENTION_TABLE_NAMES: ReadonlyArray<RetentionTableName> =
  Object.keys(RETENTION_DEFAULT_DAYS) as RetentionTableName[]

/**
 * Type guard for caller-supplied table names (e.g. from a request body).
 */
export function isRetentionTableName(s: unknown): s is RetentionTableName {
  return typeof s === 'string' && (s in RETENTION_DEFAULT_DAYS)
}

/**
 * Get the platform default for a table. Throws on unknown table — callers
 * should validate via `isRetentionTableName` first when input may be
 * untrusted.
 */
export function defaultRetentionDays(table: RetentionTableName): number {
  return RETENTION_DEFAULT_DAYS[table]
}

/**
 * Validate a proposed per-tenant override against the platform rules:
 *   - Must be at least the platform default (longer-only — OQ-4).
 *   - Must not exceed the hard ceiling (7 years — OQ-4).
 * Returns either `{ ok: true }` or `{ ok: false, reason }`.
 */
export type RetentionOverrideValidation =
  | { ok: true }
  | { ok: false; reason: string }

export function validateRetentionOverride(
  table: RetentionTableName,
  proposedDays: number,
): RetentionOverrideValidation {
  if (!Number.isInteger(proposedDays) || proposedDays < 1) {
    return { ok: false, reason: 'retention_days must be a positive integer' }
  }
  const min = RETENTION_DEFAULT_DAYS[table]
  if (proposedDays < min) {
    return {
      ok: false,
      reason: `Per-tenant overrides may only lengthen retention. Default for ${table} is ${min} days; proposed ${proposedDays} is shorter.`,
    }
  }
  if (proposedDays > RETENTION_MAX_DAYS) {
    return {
      ok: false,
      reason: `Retention cannot exceed ${RETENTION_MAX_DAYS} days (7 years).`,
    }
  }
  return { ok: true }
}
