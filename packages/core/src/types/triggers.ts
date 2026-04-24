/**
 * Composite Trigger Layer (migration 024, Phase 7).
 *
 * A trigger is a typed N-ary composite of (signal × bridge ×
 * enrichment × time window) that says "act on this account NOW".
 * Replaces the heuristic urgency scoring with explicit, debuggable,
 * single-decision rows.
 *
 * Each trigger:
 *   - is keyed by a typed `pattern` (closed enum so a typo can't ship
 *     a row no slice filters on)
 *   - lists its `components` (signal ids, bridge edge ids, contact
 *     ids that produced the match) so /admin/triggers can render the
 *     chain end-to-end
 *   - carries a Beta posterior — same shape as tenant_memories so
 *     the bandit math extracts cleanly into shared lib/bandit/beta.ts
 *   - has a lifecycle: open → acted | expired | dismissed
 *
 * Authoritative schema:
 * `packages/db/migrations/024_phase7_triggers_and_graph.sql`.
 */

export const TRIGGER_PATTERNS = [
  // Funding event + leadership_change at the same company within 90 days.
  // The "money is here, decision-maker is new" combo — strongest single
  // intent signal in B2B sales by empirical conversion data.
  'funding_plus_leadership_window',

  // Inbound bridges_to edge + recent intent_topic / hiring_surge /
  // funding / expansion within 30 days. The "warm path AND active
  // buyer" combo — the rep has both an in and a reason.
  'warm_path_at_active_buyer',

  // tech_stack overlap >= 60% with a recent win + competitor_mention
  // signal. The "they look like the win, and they're shopping" combo.
  'hot_lookalike_in_market',

  // 3+ bridges_to edges converging on one company. The strongest
  // possible warm-intro graph — the rep effectively has a quorum
  // of ways in.
  'multi_bridge_to_target',

  // contact moved roles internally at a company we already sell to
  // (or are pursuing). New role = re-evaluation window.
  'job_change_at_existing_account',

  // N target accounts at the same upcoming public event. Field-trip
  // ROI: one trip, multiple meetings.
  'tradeshow_cluster',

  // Removed a competitor from tech_stack AND added a complementary
  // tech (BuiltWith-shaped). The "they swapped, you're next" combo.
  'tech_stack_competitor_swap',
] as const

export type TriggerPattern = (typeof TRIGGER_PATTERNS)[number]

export const TRIGGER_STATUSES = [
  'open',       // surfaced in priority queue + trigger-now slice
  'acted',      // rep invoked recommended_tool OR outcome event correlates
  'expired',    // window passed without action (lintTriggers daily)
  'dismissed',  // explicit kill via /admin/triggers
] as const

export type TriggerStatus = (typeof TRIGGER_STATUSES)[number]

/**
 * The provenance JSONB blob. Every trigger carries the URNs / IDs
 * that produced the match so /admin/triggers can render "VP Eng
 * joined 21d ago after Series B" with cited links to the underlying
 * rows.
 *
 * `natural_key` is the idempotency anchor — mineCompositeTriggers
 * uses it to skip duplicate inserts when the same pattern matches
 * the same component set on a re-run. The unique partial index on
 * (tenant_id, pattern, components->>'natural_key') enforces this at
 * the DB level.
 */
export interface TriggerComponents {
  signals?: string[]        // signals.id[]
  bridges?: string[]        // memory_edges.id[]
  contacts?: string[]       // contacts.id[]
  companies?: string[]      // companies.id[] (for multi-company triggers)
  opportunities?: string[]  // opportunities.id[]
  natural_key?: string      // dedup anchor — pattern-specific composition
  // Free-form. Pattern matchers may stash matcher-specific context
  // here (e.g. tech_stack overlap %, days_apart, score breakdown).
  [key: string]: unknown
}

export interface Trigger {
  id: string
  tenant_id: string
  company_id: string | null
  opportunity_id: string | null
  pattern: TriggerPattern
  components: TriggerComponents
  trigger_score: number
  rationale: string
  recommended_action: string | null
  recommended_tool: string | null
  status: TriggerStatus
  prior_alpha: number
  prior_beta: number
  detected_at: string
  expires_at: string | null
  acted_at: string | null
  acted_by: string | null
  acted_outcome_event_id: string | null
  created_at: string
  updated_at: string
}

/**
 * Input for the canonical trigger writer used by mineCompositeTriggers.
 * The miner picks `expires_at` per-pattern (each lifespan differs).
 */
export interface ProposeTriggerInput {
  tenant_id: string
  company_id?: string | null
  opportunity_id?: string | null
  pattern: TriggerPattern
  components: TriggerComponents
  trigger_score: number
  rationale: string
  recommended_action?: string | null
  recommended_tool?: string | null
  expires_at?: string | null
}

/**
 * Stable label map for /admin/triggers and the agent prompt formatter
 * so the rep sees "Funding + Leadership Change" not the snake_case slug.
 */
export const TRIGGER_PATTERN_LABELS: Record<TriggerPattern, string> = {
  funding_plus_leadership_window: 'Funding + leadership change',
  warm_path_at_active_buyer: 'Warm path at active buyer',
  hot_lookalike_in_market: 'Hot lookalike in market',
  multi_bridge_to_target: 'Multiple warm bridges',
  job_change_at_existing_account: 'Internal job change',
  tradeshow_cluster: 'Tradeshow cluster',
  tech_stack_competitor_swap: 'Tech stack swap',
}

/**
 * Default lifespan per pattern. mineCompositeTriggers uses these to
 * set `expires_at = detected_at + DEFAULT_LIFESPAN_DAYS[pattern]`
 * unless the pattern has a more specific anchor (e.g.
 * tradeshow_cluster expires at event_date).
 */
export const DEFAULT_TRIGGER_LIFESPAN_DAYS: Record<TriggerPattern, number> = {
  funding_plus_leadership_window: 60,   // funding window is ~6mo; halfway through = 60d
  warm_path_at_active_buyer: 30,        // intent freshness decays fast
  hot_lookalike_in_market: 21,          // competitor mentions move fast
  multi_bridge_to_target: 90,           // bridges don't expire quickly
  job_change_at_existing_account: 90,   // re-evaluation window
  tradeshow_cluster: 60,                // overridden by event_date
  tech_stack_competitor_swap: 45,       // tech rollouts are fast
}
