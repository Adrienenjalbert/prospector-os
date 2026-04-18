import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AgentContext,
  PageContext,
  PendingCitation,
} from '@prospector/core'

/**
 * Context Pack — the slice-based replacement for the monolithic
 * `assembleAgentContext` in `apps/web/src/lib/agent/context-builder.ts`.
 *
 * One slice = one self-contained unit of evidence the agent is allowed to
 * quote. Each slice owns its own loader, budget, freshness contract,
 * URN-cited citations, and prompt format. The selector picks 3-8 slices per
 * turn based on (intent, role, active object, deal stage, signals,
 * tenant overrides). The packer hydrates them in parallel with per-slice
 * timeouts, formats them for the prompt, and emits telemetry — without
 * which the bandit + attribution workflows have nothing to learn from.
 *
 * Design intent baked into this file:
 *
 *   1. URN-first      — every row a slice emits ships with a URN-bearing
 *                       PendingCitation; the citation engine harvests them
 *                       automatically. Cite-or-shut-up at the source.
 *   2. Budgeted        — every slice declares an approximate token budget;
 *                       the packer trims/skips slices to keep the total
 *                       within the global ceiling.
 *   3. Provenanced     — every load result carries `fetched_at` + `source`
 *                       so the cache layer (Phase 2) can reason about
 *                       freshness, and so the learning layer can tell
 *                       cached hits from fresh fetches.
 *   4. Event-sourced   — the packer emits `context_slice_loaded` per slice
 *                       per turn; Phase 3 adds `context_slice_consumed`.
 *                       Without these the bandit cannot learn.
 *   5. Type-driven     — IntentClass + AgentRole + StageBucket are unions
 *                       so the selector pattern-matches at compile time,
 *                       not by string typo.
 */

// ---------------------------------------------------------------------------
// Domain enums — single source of truth
// ---------------------------------------------------------------------------

/**
 * Intent classes the route's `classifyIntent` already produces. We mirror
 * the union here so the slice selector can match on it at compile time
 * rather than passing magic strings around.
 *
 * If `classifyIntent` learns a new intent, add it here; the selector + any
 * slice that uses it will fail to compile until updated. That's the point.
 */
export type IntentClass =
  | 'unknown'
  | 'draft_outreach'
  | 'risk_analysis'
  | 'meeting_prep'
  | 'diagnosis'
  | 'forecast'
  | 'signal_triage'
  | 'stakeholder_mapping'
  | 'portfolio_health'
  | 'lookup'
  | 'general_query'

/**
 * Coarse pipeline stage bucket — CRMs disagree on stage names, so slices
 * match on these buckets, not on raw stage strings. The mapping happens in
 * `selector.ts#stageBucketFromString`.
 */
export type StageBucket =
  | 'discovery'
  | 'qualification'
  | 'proposal'
  | 'negotiation'
  | 'closing'
  | 'other'

/**
 * Roles the platform routes for. Mirrors `AgentRole` in tools/index.ts; we
 * re-declare to avoid an import cycle (slices live below tools in the
 * dependency graph).
 */
export type AgentRole =
  | 'nae'
  | 'ae'
  | 'growth_ae'
  | 'ad'
  | 'csm'
  | 'leader'
  | 'admin'
  | 'rep'

export type ActiveObjectType =
  | 'company'
  | 'deal'
  | 'contact'
  | 'signal'
  | 'none'

/**
 * Slugs of workflows / cron routes whose execution invalidates a slice's
 * cache. Kept as a union so slice authors can't typo a slug that doesn't
 * exist; the cache layer (Phase 2) reads `agent_events` for these.
 */
export type WorkflowSlug =
  | 'cron/sync'
  | 'cron/score'
  | 'cron/signals'
  | 'cron/enrich'
  | 'cron/learning'
  | 'cron/workflows'
  | 'webhooks/transcripts'
  | 'webhooks/hubspot-meeting'
  | 'transcript_ingest'
  | 'exemplar_miner'
  | 'prompt_optimizer'
  | 'scoring_calibration'
  | 'attribution'
  | 'self_improve'

// ---------------------------------------------------------------------------
// SliceLoadCtx — what every loader receives
// ---------------------------------------------------------------------------

/**
 * Everything a slice loader needs at runtime, derived once per turn by the
 * packer. Kept narrow on purpose — adding fields here forces every loader
 * to consider them, which keeps the contract explicit.
 */
export interface SliceLoadCtx {
  tenantId: string
  repId: string
  userId: string
  role: AgentRole

  /** URN of the object the user is currently viewing, if any. */
  activeUrn: string | null
  activeObject: ActiveObjectType
  /** Resolved company id when activeUrn is a company OR when the active deal carries one. */
  activeCompanyId: string | null
  /** Resolved deal id when activeUrn is a deal/opportunity. */
  activeDealId: string | null

  /** Page context as the route received it (for back-compat with rep-centric assembler). */
  pageContext: PageContext | undefined

  /** Intent class from `classifyIntent` in the route. */
  intentClass: IntentClass

  /** CRM source of the tenant — used by URN deep-link helpers. */
  crmType: string | null

  /** Service-role Supabase client. Loaders should always tenant-scope queries. */
  supabase: SupabaseClient

  /** Hard deadline (epoch ms) — loaders should bail before this. */
  deadlineMs: number
}

// ---------------------------------------------------------------------------
// Slice contract
// ---------------------------------------------------------------------------

/**
 * Triggers — declarative matchers the selector evaluates. Every field is
 * optional; an unset field means "no constraint". Additive scoring lives
 * in the selector, not here, so slices declare WHAT they care about, not
 * HOW much.
 */
export interface SliceTriggers {
  intents?: IntentClass[]
  roles?: AgentRole[]
  objects?: ActiveObjectType[]
  stages?: StageBucket[]
  /** When true, slice is preferred when active deal is flagged stalled. */
  whenStalled?: boolean
  /** Substring-match against signal_type — first match awards points. */
  signalTypes?: string[]
  /** When true, slice always loads regardless of other matchers (meta slices). */
  always?: boolean
}

/**
 * Freshness contract — when a Phase-2 cache lookup hits, the entry stays
 * valid until either the TTL elapses OR an `agent_events` row with
 * `event_type IN invalidate_on` lands after `fetched_at`.
 */
export interface SliceStaleness {
  ttl_ms: number
  invalidate_on: WorkflowSlug[]
}

/**
 * Provenance metadata attached to every load result — feeds the cache
 * layer's freshness decision and the learning layer's per-slice telemetry.
 */
export interface SliceProvenance {
  fetched_at: string
  source: 'db' | 'adapter' | 'cache'
  /** Wall time the load took, for telemetry. */
  duration_ms: number
}

export interface SliceLoadResult<TRow> {
  rows: TRow[]
  citations: PendingCitation[]
  provenance: SliceProvenance
  /**
   * Optional contract violations the slice itself detected. Surfaced into
   * `data-coverage-warnings` (Phase 2) so the agent can mention them
   * honestly. Examples: "no signals in 14 days", "no champion identified".
   */
  warnings?: string[]
}

/**
 * The canonical slice shape. Three pure functions, plus declarative
 * metadata. Everything routable, scoreable, citeable, observable.
 *
 * `TRow` is the slice's row type; `TArgs` is reserved for slice-specific
 * args the on-demand `hydrate_context` tool can pass through (Phase 2).
 */
export interface ContextSlice<TRow = unknown, TArgs = void> {
  slug: string
  title: string
  category: 'pipeline' | 'account' | 'people' | 'learning' | 'health' | 'meta'

  triggers: SliceTriggers
  staleness: SliceStaleness

  /** Approximate max tokens when serialised — packer trims rows to fit. */
  token_budget: number

  /** Per-slice timeout — loader is skipped (logged) if it exceeds this. */
  soft_timeout_ms: number

  load: (
    ctx: SliceLoadCtx,
    args?: TArgs,
  ) => Promise<SliceLoadResult<TRow>>

  /** Compact markdown for the prompt — never raw JSON. URNs inline. */
  formatForPrompt: (rows: TRow[]) => string

  /** Single-row URN citation. Used by the on-demand tool to cite one item. */
  citeRow: (row: TRow) => PendingCitation
}

// ---------------------------------------------------------------------------
// Selector input + result
// ---------------------------------------------------------------------------

/**
 * The selector reads this shape, scores every slice, returns the top-N
 * that fit within `token_budget`. Pure function — no IO, no state.
 */
export interface ContextSelectorInput {
  role: AgentRole
  activeObject: ActiveObjectType
  activeUrn: string | null
  dealStage: StageBucket
  isStalled: boolean
  signalTypes: string[]
  intentClass: IntentClass

  /** Total token ceiling for the context section. Default 2000. */
  token_budget: number

  /**
   * Tenant-level overrides resolved from `business_profiles.role_definitions`.
   * Today wires up the dead `context_strategy` field; Phase 2 adds
   * `context_slices_allow|deny|pinned` for explicit per-tenant control.
   */
  tenant_overrides?: TenantContextOverrides

  /**
   * Optional Phase-3 bandit input. When present, the selector applies a
   * Thompson-sampling adjustment per slice on top of the heuristic score.
   * When absent (or below the MIN_SAMPLES_FOR_BANDIT threshold per slice),
   * the bandit contributes 0 and the heuristic remains in charge.
   * Loaded by the packer via `loadSlicePriors()`.
   */
  bandit_priors?: BanditPriorsInput
}

export interface BanditPriorsInput {
  /** Map of priorKey(intent, role, slug) -> sampled adjustment. */
  adjustment: (slug: string) => number
}

export interface TenantContextOverrides {
  /** Bundle default — maps to a starter slice allow-list. */
  strategy?: 'rep_centric' | 'account_centric' | 'portfolio_centric' | 'team_centric'
  /** Slice-slug whitelist. When set, selector ignores any slug not in the list. */
  allow?: string[]
  /** Slice-slug blacklist. Overrides allow. */
  deny?: string[]
  /** Force-include even if the score is sub-threshold. */
  pinned?: string[]
  /** Override the global token_budget for this role. */
  token_budget?: number
}

export interface ScoredSlice {
  slug: string
  score: number
  /** Component breakdown — useful for debugging / admin heatmap (Phase 4). */
  reasons: string[]
}

export interface SelectorResult {
  /** Slice slugs ordered by score desc, after budget trimming. */
  slugs: string[]
  /** Approximate total tokens consumed by the selected slices. */
  budget_used: number
  /** Full per-slice scoring detail — for telemetry + admin views. */
  scored: ScoredSlice[]
}

// ---------------------------------------------------------------------------
// Packer output — the PackedContext consumers receive
// ---------------------------------------------------------------------------

export interface PackedSection {
  slug: string
  title: string
  /** Markdown body produced by `slice.formatForPrompt(rows)`. */
  markdown: string
  /** Provenance metadata for telemetry + cache decisions. */
  provenance: SliceProvenance
  /** Approximate token count of the markdown. */
  tokens: number
  /** Raw row count — useful for "0 rows means empty" logic in the agent. */
  row_count: number
}

export interface PackedContext {
  /** Always-on header (tenant + role + active-object summary + freshness). */
  preamble: string
  /**
   * Hydrated slices in the order the packer produced them. The packer
   * applies lost-in-the-middle ordering (active-object first, behaviour
   * rules last); consumers should not re-sort.
   */
  sections: PackedSection[]
  /** Every PendingCitation produced by every slice's loader. */
  citations: PendingCitation[]
  /** Slugs that were attempted but skipped (timeout, error, denied). */
  failed: { slug: string; reason: string }[]
  /** Slugs that were selected — for telemetry symmetry. */
  hydrated: string[]
  /** Sum of `tokens` across `sections` — for budget book-keeping. */
  tokens_used: number
  /** Selector scoring detail (debug + admin heatmap). */
  scored: ScoredSlice[]
  /**
   * Snapshot of what the legacy `AgentContext` would look like, derived by
   * the facade. Keeps every existing prompt builder working without
   * modification (`pipeline-coach.ts` etc. still consume `AgentContext`).
   */
  legacy: AgentContext | null
}

// ---------------------------------------------------------------------------
// Helper type re-exports for consumers
// ---------------------------------------------------------------------------

export type { PendingCitation }
