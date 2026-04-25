import type { SignalType, SignalUrgency } from '@prospector/core'

/**
 * JobChangeAdapter — Phase 7 (Section 4.1).
 *
 * Pluggable interface for job-change-detection vendors:
 *
 *   - Apollo enrichPerson (already wired via refresh-contacts; the
 *     ApolloJobChangeAdapter wraps it for adapter-pattern symmetry)
 *   - LinkedIn Sales Navigator (PhantomBuster proxy)
 *   - Cognism / ZoomInfo
 *
 * Detects two events per tracked contact:
 *
 *   - external move: contact left for a new company
 *   - internal move: contact stayed but switched role
 *
 * Both map to `job_change` signals (Phase 7-added signal_type) with
 * a payload distinguishing the two cases. The composite-trigger
 * patterns `job_change_at_existing_account` and (transitively)
 * `warm_path_at_active_buyer` consume these.
 *
 * Same per-tenant config + cost-gating pattern as the other Phase 7
 * adapters.
 */

export interface JobChangeRow {
  // The contact id we observed the change for. Caller (signals cron
  // / refresh-contacts) maps to companies via the new domain.
  contact_id: string
  signal_type: 'job_change'
  /** Was the change to a new company? false = internal role change. */
  external_move: boolean
  /** Domain of the NEW employer (when external_move=true). */
  new_domain: string | null
  /** New role title. */
  new_title: string | null
  title: string
  description: string
  source: string
  relevance_score: number
  weighted_score: number
  urgency: SignalUrgency
  detected_at: string
  raw?: Record<string, unknown>
}

const _typeCheck: SignalType = 'job_change'
void _typeCheck

export interface JobChangeAdapterCapabilities {
  /** Detects external job changes (different company). */
  detectExternal: boolean
  /** Detects internal job changes (same company, new role). */
  detectInternal: boolean
  /** Provides confidence on the detection. */
  confidenceScored: boolean
}

export interface FetchJobChangesOpts {
  tenantId: string
  /** Contact identifiers to check (typically email; LinkedIn URL for SN). */
  contacts: Array<{ contact_id: string; email: string | null; linkedin_url: string | null }>
  sinceDays: number
  limit?: number
}

export interface JobChangeAdapter {
  vendor: string
  capabilities: JobChangeAdapterCapabilities
  costPerCall: number
  fetchChanges(opts: FetchJobChangesOpts): Promise<JobChangeRow[]>
}
