import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentContext, RepProfile } from '@prospector/core'

/**
 * Thin profile loader for the post-PR3 packer-success path.
 *
 * The legacy `assembleAgentContext` (in `context-builder.ts`) issues
 * 7-9 parallel Supabase queries to build the full `AgentContext` —
 * priority accounts, funnel benchmarks, stalled deals, signals,
 * contacts. When the Context Pack succeeds, the prompt builders
 * already render slice data via `formatPackedSections(packed)` and
 * the legacy slice arrays go unused (see the `if (packedSection) ...
 * else if (ctx)` branches in `agents/pipeline-coach.ts` L489-503,
 * `agents/account-strategist.ts`, `agents/leadership-lens.ts`).
 *
 * The ONE field the prompt builders still need from the legacy
 * AgentContext is `rep_profile` — driving:
 *   - `formatRepPreferences(ctx?.rep_profile)` (every surface)
 *   - the rep name in the agent header (`formatAgentHeader`)
 *   - the dashboard route's `responseTokenCap` (reads
 *     `agentContext?.rep_profile?.comm_style`)
 *
 * This loader fetches just that one row and returns a synthesized
 * AgentContext shell with `rep_profile` populated and every other
 * field zeroed out (empty arrays, null singletons). Prompt builders
 * already null-check, so the empty path renders cleanly.
 *
 * Saving vs the full legacy assembler: 7-9 parallel queries → 1
 * query, plus elimination of the 2× DB cost the strategic review
 * called out (legacy + packer running in parallel for transitional
 * months).
 *
 * Quality trade-off: when packer succeeds, the framework selector
 * (`selectForAgentContext`) sees null `current_deal` / empty
 * `stalled_deals` / empty `recent_signals` and falls back to
 * role-only framework picks. This matches the existing Slack
 * behaviour (Slack already calls assembleContextPack without
 * intent hints — see `run-agent.ts` packer call). Buyers don't
 * see a regression because Slack and dashboard finally agree.
 */

export interface LoadedProfiles {
  /**
   * The rep profile row, or null when no rep matches `(tenantId,
   * repId)`. Callers that need a non-null AgentContext can use
   * `synthesizePackerSuccessContext` below to fold this into the
   * legacy shape.
   */
  rep_profile: RepProfile | null
}

/**
 * Single round-trip rep_profile load. Mirrors the
 * `assembleAgentContext` query at L61-66 of context-builder.ts so
 * the rep_profile shape is byte-identical to what the legacy path
 * returned — same column set, same join keys.
 *
 * The `(tenant_id, crm_id)` predicate matches the legacy assembler.
 * `repId` here is the CRM rep id, not the Supabase auth uid — both
 * the dashboard route and the Slack route already resolve to the
 * crm_id before calling the assembler.
 */
export async function loadProfilesForPrompt(
  supabase: SupabaseClient,
  tenantId: string,
  repId: string,
): Promise<LoadedProfiles> {
  const { data } = await supabase
    .from('rep_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('crm_id', repId)
    .maybeSingle()

  return {
    rep_profile: (data as RepProfile | null) ?? null,
  }
}

/**
 * Wrap the loaded profiles in the AgentContext shape the prompt
 * builders expect. Everything other than `rep_profile` is empty/null
 * — when packer succeeds, the prompt builders skip the legacy slice
 * branches entirely (they're inside `else if (ctx)` blocks gated on
 * `packedSection` being empty).
 *
 * Returns `null` when no rep_profile exists for this (tenant, rep) —
 * caller should fall back to the legacy assembler in that case so a
 * misconfigured tenant doesn't silently lose the rep header.
 */
export function synthesizePackerSuccessContext(
  loaded: LoadedProfiles,
): AgentContext | null {
  if (!loaded.rep_profile) return null

  return {
    rep_profile: loaded.rep_profile,
    priority_accounts: [],
    funnel_comparison: [],
    stalled_deals: [],
    recent_signals: [],
    company_benchmarks: [],
    current_page: null,
    current_account: null,
    current_deal: null,
  }
}
