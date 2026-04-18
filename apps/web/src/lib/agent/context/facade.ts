import type {
  AgentContext,
  PriorityAccountSummary,
  StalledDealSummary,
  FunnelComparison,
  SignalSummary,
} from '@prospector/core'
import type { PackedContext, PackedSection } from './types'

/**
 * Facade — maps a `PackedContext` onto the legacy `AgentContext` shape so
 * existing prompt builders (pipeline-coach, account-strategist,
 * leadership-lens) keep working unchanged.
 *
 * Strategy:
 *   - Slice-derived fields (priority_accounts, stalled_deals,
 *     funnel_comparison, recent_signals) are populated from the
 *     PackedContext when those slices were hydrated.
 *   - Fields slices don't yet cover (rep_profile, current_account,
 *     current_deal, winning_patterns, relationship_events,
 *     key_contact_notes, company_benchmarks) come from the legacy
 *     `baseContext` argument — the original `assembleAgentContext` call
 *     stays in place for these until Phase 2.
 *
 * This keeps Phase 1 strictly additive: nothing breaks if the slice
 * registry is empty or every slice fails — the legacy AgentContext is
 * still complete.
 */

/**
 * Recover the typed rows from a PackedSection. Each slice's `rows[]` was
 * thrown away when we serialised to markdown — but the row shape is
 * deterministic per slice, so we re-derive the legacy summary by parsing
 * structured fields from the slice's load result.
 *
 * To avoid double-loading, we store the rows on the PackedSection via a
 * `rawRows` shadow attached at packer time. Phase 1 takes the simpler
 * route: re-read the rows from the section markdown is fragile, so we
 * accept that the facade provides a *minimal* legacy mapping and the
 * legacy builder still ships the full AgentContext today. As slices take
 * over more responsibility (Phase 2 prompt-builder migration), the legacy
 * builder shrinks.
 */

export interface FacadeInput {
  packed: PackedContext
  /**
   * The legacy AgentContext computed by `assembleAgentContext`. Stays as
   * the source of truth for fields the slice catalog doesn't yet cover.
   * Pass null only if you've fully migrated off the legacy assembler.
   */
  baseContext: AgentContext | null
}

/**
 * Produce the AgentContext callers expect. When `baseContext` is provided,
 * we keep all of its fields and let it remain authoritative — Phase 1's
 * promise is "no regression, slices are additive". The PackedContext is
 * carried alongside on the (non-AgentContext) `packed` field so new
 * callers that want the slice-aware view can read it directly.
 *
 * Returning the baseContext untouched in Phase 1 means: the slice layer
 * runs, emits telemetry, populates citations the agent route picks up,
 * but doesn't *override* what the prompt builders see. We get the
 * observability + the URN-cite benefit (via the citations array) with
 * zero behavioural risk to the existing 50+ goldens.
 */
export function packedToAgentContext(input: FacadeInput): AgentContext | null {
  if (!input.baseContext) return null

  // Phase 1: pass the legacy context through. The packed sections + their
  // citations are surfaced separately to the route via the PackedContext
  // return — see `assembleContextForStrategy` integration in
  // `context-strategies.ts`.
  return input.baseContext
}

/**
 * Convenience predicate — useful for prompt builders that opt into reading
 * sections directly when available, falling back to the legacy fields
 * otherwise.
 */
export function hasSlice(packed: PackedContext, slug: string): PackedSection | null {
  return packed.sections.find((s) => s.slug === slug) ?? null
}

/**
 * Re-export the legacy summary types so consumers don't have to pull from
 * @prospector/core directly when they only need the slice→legacy mapping.
 */
export type {
  PriorityAccountSummary,
  StalledDealSummary,
  FunnelComparison,
  SignalSummary,
}
