import type { SignalType, SignalUrgency } from '@prospector/core'

/**
 * IntentDataAdapter — Phase 7 (Section 4.1) of the Composite Triggers
 * + Relationship Graph plan.
 *
 * Pluggable interface for B2B intent data vendors (Bombora, 6sense,
 * Demandbase, Tavily News). Each implementation maps its own
 * vendor-specific shape into a typed `IntentSignalRow[]` that the
 * signals cron can batch-insert directly into `signals`.
 *
 * Per-tenant adapter selection lives in
 * `tenants.business_config.intent_adapters: ['tavily_news', 'bombora']`.
 * The signals cron loads adapters by name and calls `fetchIntent`
 * per tenant per night. No per-vendor coupling outside the adapter
 * file — adding Bombora when a customer brings keys is one PR.
 *
 * Cost gating: each adapter declares its `costPerCall` and uses the
 * shared cost ledger from `enrichment/cost.ts`. Per-tenant monthly
 * budgets cap spend.
 */

/**
 * Output shape — maps 1:1 to a `signals` row insert. Producers
 * MUST set `signal_type` to a value the DB CHECK accepts (migration
 * 024 widened the enum to include `intent_topic`, `press_event`,
 * `tradeshow_attendance`, etc.).
 */
export interface IntentSignalRow {
  // Tenant + company are set by the caller (the signals cron) via
  // the input opts; the adapter only needs to identify which input
  // company each output row belongs to.
  domain: string                   // matched back to companies.domain by the caller
  signal_type: SignalType          // intent_topic | press_event | tradeshow_attendance
  title: string                    // human-facing one-liner
  description: string | null       // longer detail; may include event slug
  source_url: string | null
  source: string                   // adapter vendor slug (e.g. 'bombora')
  relevance_score: number          // 0..1
  weighted_score: number           // 0..100 — feeds composite-scorer
  urgency: SignalUrgency
  detected_at: string              // ISO; adapter-attested timestamp
  // Free-form vendor-specific payload, surfaced in signals.description
  // or in admin debug views. Avoid PII.
  raw?: Record<string, unknown>
}

export interface IntentAdapterCapabilities {
  /** Tenant-level topic-of-interest scoring (Bombora-shape). */
  topics: boolean
  /** Per-account anonymous web-page visit counts (6sense-shape). */
  pageVisits: boolean
  /** Firmographic lookup by domain (vendor-specific enrichment). */
  firmographicsLookup: boolean
}

export interface FetchIntentOpts {
  tenantId: string
  /** Domains the tenant cares about. Adapter SHOULD filter to these. */
  domains: string[]
  /** Topics from the tenant's sales motion (concept_glossary, ICP). */
  topicsOfInterest: string[]
  /** Lookback window. Adapters cap to their own retention. */
  sinceDays: number
  /** Max signals to return — used for cost gating. */
  limit?: number
}

export interface IntentDataAdapter {
  /** Vendor slug. Used in `tenants.business_config.intent_adapters`. */
  vendor: string
  capabilities: IntentAdapterCapabilities
  /**
   * Approximate cost per call in USD, declared by the adapter so the
   * signals cron can apply per-tenant budget gating via cost.ts.
   */
  costPerCall: number
  /**
   * Returns 0..N intent signals. Implementations MUST be idempotent
   * — if the same intent fact is queried twice, return the same
   * (signal_type, title) tuple so the signals-cron upsert dedupes.
   *
   * Adapters that have no API key configured for the tenant SHOULD
   * return an empty array (not throw). Throws are reserved for
   * transient errors (HTTP 5xx, rate limit) which the cron retries.
   */
  fetchIntent(opts: FetchIntentOpts): Promise<IntentSignalRow[]>
}
