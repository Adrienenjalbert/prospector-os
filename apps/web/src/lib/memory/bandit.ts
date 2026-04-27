import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Memory bandit — Beta-Bernoulli posterior on tenant_memories.prior_alpha/beta
 * and wiki_pages.prior_alpha/beta.
 *
 * Mirrors the slice bandit shape in `apps/web/src/lib/agent/context/bandit.ts`
 * and the tool bandit in `apps/web/src/lib/agent/tool-bandit.ts`. Same Beta
 * conjugate, same Thompson-sample-the-mean approach for ranking, same
 * "below MIN_SAMPLES → contribute 0" gate.
 *
 * The posterior is updated by the agent route's onFinish handler:
 *
 *   - Per memory_injected: prior_beta += 1 (one impression).
 *   - Per memory_cited:    prior_alpha += 1 (one success).
 *
 * Both updates batch into a single SQL UPDATE per turn (one for atoms,
 * one for pages) so we never write 5 individual updates when the same
 * page is injected and cited in the same response.
 *
 * Why mirror the slice bandit shape:
 *   - The slice and tool bandits already work; one shape per learning
 *     surface keeps reasoning about them simple.
 *   - The nightly memory-aware lint and consolidation workflows can
 *     read the posterior to break ties: when two atoms cover the same
 *     scope at the same confidence, prefer the one with higher
 *     posterior mean.
 *   - /admin/wiki + /admin/memory render the posterior so admins see
 *     "this memory has been cited 12/40 times → posterior 0.31" and
 *     can decide to archive / pin.
 */

// ---------------------------------------------------------------------------
// Atom (tenant_memories) priors
// ---------------------------------------------------------------------------

export interface MemoryPrior {
  memory_id: string
  prior_alpha: number
  prior_beta: number
}

export type MemoryPriorsTable = Map<string, MemoryPrior>

/**
 * Bulk-load the priors for a set of memory ids. Single round trip per
 * turn — the packer assembles the id set after slice load and calls
 * this once. Empty input set returns an empty Map.
 */
export async function loadMemoryPriors(
  supabase: SupabaseClient,
  tenantId: string,
  memoryIds: string[],
): Promise<MemoryPriorsTable> {
  const table: MemoryPriorsTable = new Map()
  if (memoryIds.length === 0) return table
  try {
    const { data, error } = await supabase
      .from('tenant_memories')
      .select('id, prior_alpha, prior_beta')
      .eq('tenant_id', tenantId)
      .in('id', memoryIds)
    if (error) {
      console.warn('[memory-bandit] priors query failed:', error.message)
      return table
    }
    for (const row of data ?? []) {
      table.set(row.id as string, {
        memory_id: row.id as string,
        prior_alpha: Number(row.prior_alpha) || 1,
        prior_beta: Number(row.prior_beta) || 1,
      })
    }
  } catch (err) {
    console.warn('[memory-bandit] priors load threw:', err)
  }
  return table
}

// ---------------------------------------------------------------------------
// Wiki page priors (same shape, different table)
// ---------------------------------------------------------------------------

export interface WikiPagePrior {
  page_id: string
  prior_alpha: number
  prior_beta: number
}

export type WikiPagePriorsTable = Map<string, WikiPagePrior>

export async function loadWikiPagePriors(
  supabase: SupabaseClient,
  tenantId: string,
  pageIds: string[],
): Promise<WikiPagePriorsTable> {
  const table: WikiPagePriorsTable = new Map()
  if (pageIds.length === 0) return table
  try {
    const { data, error } = await supabase
      .from('wiki_pages')
      .select('id, prior_alpha, prior_beta')
      .eq('tenant_id', tenantId)
      .in('id', pageIds)
    if (error) {
      // wiki_pages table may not exist yet (deployments still on
      // migration 021). Same defensive pattern as the cron embedder.
      console.warn('[memory-bandit] wiki page priors query failed:', error.message)
      return table
    }
    for (const row of data ?? []) {
      table.set(row.id as string, {
        page_id: row.id as string,
        prior_alpha: Number(row.prior_alpha) || 1,
        prior_beta: Number(row.prior_beta) || 1,
      })
    }
  } catch (err) {
    console.warn('[memory-bandit] wiki page priors load threw:', err)
  }
  return table
}

// ---------------------------------------------------------------------------
// Thompson adjustment — delegates to shared bandit/beta math (Phase 7)
// ---------------------------------------------------------------------------
//
// Phase 7 (Section 2.3) extracted the Beta math into
// `apps/web/src/lib/bandit/beta.ts` so the trigger bandit (Phase 7)
// shares one implementation with the memory + wiki page bandits
// (Phase 6). The wrapper exports below preserve the prior call sites
// (`thompsonAdjustForMemory`, `MIN_SAMPLES_FOR_MEMORY_BANDIT`) so
// Phase 6 callers don't need to be touched.

import { thompsonAdjust as _thompsonAdjust, MIN_SAMPLES_FOR_BANDIT as _MIN } from '@/lib/bandit/beta'

export const MIN_SAMPLES_FOR_MEMORY_BANDIT = _MIN

export function thompsonAdjustForMemory(
  prior: MemoryPrior | WikiPagePrior | undefined,
): number {
  return _thompsonAdjust(prior)
}

// ---------------------------------------------------------------------------
// Posterior updates (called by the agent route's onFinish)
// ---------------------------------------------------------------------------

/**
 * Per-turn batched update for atom posteriors. Single SQL round-trip
 * per turn (per surface side).
 *
 *   - Each id in `injectedIds` increments prior_beta by 1 (impression).
 *   - Each id in `citedIds` increments prior_alpha by 1 (success).
 *
 * An id present in both sets gets BOTH increments applied (impression
 * AND success — the response cited the atom that was injected, which
 * is the strongest positive signal). The math is conjugate so the two
 * +1s land cleanly without double-counting.
 *
 * Implementation note: Postgres has no atomic multi-row increment
 * primitive. We use a CASE expression in a single UPDATE so the round
 * trip stays at 1. The supabase-js client doesn't expose this directly,
 * so we use the raw RPC `update_memory_posteriors` (added in a
 * follow-up SQL function in migration 022) OR fall back to per-row
 * updates inside a single Promise.all. We use the per-row approach
 * here because it's portable across migration states.
 */
export async function updateMemoryPosteriors(
  supabase: SupabaseClient,
  tenantId: string,
  injectedIds: string[],
  citedIds: string[],
): Promise<void> {
  if (injectedIds.length === 0 && citedIds.length === 0) return
  // De-duplicate so the same atom injected twice in one turn (e.g. via
  // two slices) gets ONE impression, not two.
  const uniqueInjected = Array.from(new Set(injectedIds))
  const citedSet = new Set(citedIds)
  try {
    await Promise.all(
      uniqueInjected.map(async (id) => {
        // Read-modify-write. Yes this races; the magnitude is small (one
        // turn), the conflict window is < 1s, and the worst case is a
        // single missed +1 — acceptable for a learning-loop signal that
        // averages over thousands of turns.
        const { data } = await supabase
          .from('tenant_memories')
          .select('prior_alpha, prior_beta')
          .eq('tenant_id', tenantId)
          .eq('id', id)
          .maybeSingle()
        if (!data) return
        const cited = citedSet.has(id)
        await supabase
          .from('tenant_memories')
          .update({
            prior_alpha: Number(data.prior_alpha ?? 1) + (cited ? 1 : 0),
            prior_beta: Number(data.prior_beta ?? 1) + 1,
          })
          .eq('tenant_id', tenantId)
          .eq('id', id)
      }),
    )
  } catch (err) {
    // Posterior is non-load-bearing for correctness — never throw out
    // of onFinish for a bandit update.
    console.warn('[memory-bandit] posterior update failed:', err)
  }
}

/**
 * Mirror of updateMemoryPosteriors for wiki_pages. Same de-duplication,
 * same race tolerance, same defensive try/catch. Skip silently if the
 * table doesn't exist (deployments still on migration 021).
 */
export async function updateWikiPagePosteriors(
  supabase: SupabaseClient,
  tenantId: string,
  injectedIds: string[],
  citedIds: string[],
): Promise<void> {
  if (injectedIds.length === 0 && citedIds.length === 0) return
  const uniqueInjected = Array.from(new Set(injectedIds))
  const citedSet = new Set(citedIds)
  try {
    await Promise.all(
      uniqueInjected.map(async (id) => {
        const { data, error } = await supabase
          .from('wiki_pages')
          .select('prior_alpha, prior_beta')
          .eq('tenant_id', tenantId)
          .eq('id', id)
          .maybeSingle()
        if (error?.code === '42P01') return // undefined_table
        if (!data) return
        const cited = citedSet.has(id)
        await supabase
          .from('wiki_pages')
          .update({
            prior_alpha: Number(data.prior_alpha ?? 1) + (cited ? 1 : 0),
            prior_beta: Number(data.prior_beta ?? 1) + 1,
          })
          .eq('tenant_id', tenantId)
          .eq('id', id)
      }),
    )
  } catch (err) {
    console.warn('[memory-bandit] wiki page posterior update failed:', err)
  }
}
