import type { SignalType, SignalUrgency } from '@prospector/core'

/**
 * TechStackAdapter — Phase 7 (Section 4.1).
 *
 * Pluggable interface for tech-stack-detection vendors (BuiltWith,
 * HG Insights, G2 Reviews). Detects two events per tracked company:
 *
 *   - tech additions: company started using vendor X
 *   - tech removals: company stopped using vendor X (esp. competitor)
 *
 * Each event maps to a `tech_stack_change` signal (Phase 7-added
 * signal_type). The composite-trigger pattern
 * `tech_stack_competitor_swap` consumes them.
 *
 * Same per-tenant config + cost-gating pattern as IntentDataAdapter.
 */

export interface TechStackChangeRow {
  domain: string
  signal_type: 'tech_stack_change'
  title: string
  description: string  // includes 'swap:competitor=<vendor>' or 'add:tech=<vendor>'
  source_url: string | null
  source: string
  relevance_score: number
  weighted_score: number
  urgency: SignalUrgency
  detected_at: string
  raw?: Record<string, unknown>
}

// Compile-time assertion: signal_type is in the enum after migration 024.
const _typeCheck: SignalType = 'tech_stack_change'
void _typeCheck

export interface TechStackAdapterCapabilities {
  /** Detects vendor additions over time. */
  detectAdds: boolean
  /** Detects vendor removals over time. */
  detectRemoves: boolean
  /** Provides confidence score on detection (vs binary present/absent). */
  confidenceScored: boolean
}

export interface FetchTechStackChangesOpts {
  tenantId: string
  domains: string[]
  /**
   * Vendors to watch — typically the tenant's competitor list +
   * complementary tech list. Adapter scopes detection to these.
   */
  watchedVendors: string[]
  sinceDays: number
  limit?: number
}

export interface TechStackAdapter {
  vendor: string
  capabilities: TechStackAdapterCapabilities
  costPerCall: number
  fetchChanges(
    opts: FetchTechStackChangesOpts,
  ): Promise<TechStackChangeRow[]>
}
