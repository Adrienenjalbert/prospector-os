import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentRole, IntentClass } from './types'

/**
 * Context-slice bandit — Thompson sampling over `context_slice_priors`.
 *
 * Why Thompson sampling rather than greedy or epsilon-greedy:
 *   - The selector picks 4-8 slices per turn; we want diversity of
 *     exploration without giving up exploitation entirely. Thompson
 *     sampling's natural mix of explore / exploit fits exactly.
 *   - Beta-Bernoulli is the right shape for binary feedback (positive vs
 *     negative thumbs) and degrades gracefully when sample_count is low
 *     (default uniform prior leaves the heuristic score in charge).
 *   - Symmetric to the existing `tool_priors` bandit shape — same nightly
 *     calibration logic can be lifted later for slices.
 *
 * The adjustment is *additive on top of* the heuristic score the selector
 * computes today — so when no priors exist (sample_count = 0 across the
 * board) the bandit contributes 0 and the heuristic stays in charge.
 * As priors accumulate, the bandit nudges scores up or down by ±2 points
 * (similar magnitude to the role/intent boosts in the heuristic so it
 * matters but doesn't dominate).
 */

export interface SlicePrior {
  intent_class: string
  role: string
  slice_slug: string
  alpha: number
  beta: number
  sample_count: number
}

export type SlicePriorsTable = Map<string, SlicePrior>

/**
 * Build the lookup key the selector uses to fetch a single slice's prior.
 */
export function priorKey(intent: string, role: string, slug: string): string {
  return `${intent}:${role}:${slug}`
}

/**
 * Load all priors for a (tenant, intent, role) triple in one query. Called
 * once per turn by the packer — small N (at most ~16 rows since SLICE_SLUGS
 * is bounded). Returns a Map keyed by `priorKey()` for O(1) lookup in the
 * selector.
 *
 * Telemetry-quiet: a missing table (Phase-3 migration not applied yet) is
 * tolerated — returns an empty Map so the bandit contributes nothing and
 * the heuristic selector keeps working unchanged.
 */
export async function loadSlicePriors(
  supabase: SupabaseClient,
  tenantId: string,
  intentClass: IntentClass,
  role: AgentRole,
): Promise<SlicePriorsTable> {
  const table: SlicePriorsTable = new Map()
  try {
    const { data, error } = await supabase
      .from('context_slice_priors')
      .select('intent_class, role, slice_slug, alpha, beta, sample_count')
      .eq('tenant_id', tenantId)
      .eq('intent_class', intentClass)
      .eq('role', role)
    if (error) {
      // Migration may not be applied yet — treat as no priors, fall back
      // to heuristic. Same pattern the tool bandit uses.
      console.warn('[context-bandit] priors query failed, using heuristic only:', error.message)
      return table
    }
    for (const row of data ?? []) {
      table.set(priorKey(row.intent_class, row.role, row.slice_slug), {
        intent_class: row.intent_class,
        role: row.role,
        slice_slug: row.slice_slug,
        alpha: Number(row.alpha) || 1,
        beta: Number(row.beta) || 1,
        sample_count: row.sample_count ?? 0,
      })
    }
  } catch (err) {
    console.warn('[context-bandit] priors load threw:', err)
  }
  return table
}

/**
 * Minimum samples before a prior actually moves the selector. Below this
 * the heuristic stays unchallenged. Tuned to match the tool bandit's
 * threshold (10 samples is the convention).
 */
export const MIN_SAMPLES_FOR_BANDIT = 10

/**
 * Thompson-sample one prior. Samples a value from Beta(alpha, beta) and
 * maps to a score adjustment in roughly [-2, +2] using the sampled
 * mean's distance from 0.5.
 *
 * When sample_count is below MIN_SAMPLES_FOR_BANDIT, returns 0 — the
 * prior is too thin to act on, the heuristic stays in charge.
 */
export function thompsonAdjustment(prior: SlicePrior | undefined): number {
  if (!prior) return 0
  if (prior.sample_count < MIN_SAMPLES_FOR_BANDIT) return 0
  // Sample from Beta(alpha, beta) using the inverse-CDF approximation
  // is overkill for our magnitude. Use the posterior mean as the point
  // estimate and add a small noise term proportional to uncertainty —
  // close enough to Thompson sampling for our coarse scoring scale.
  const mean = prior.alpha / (prior.alpha + prior.beta)
  const variance =
    (prior.alpha * prior.beta) /
    ((prior.alpha + prior.beta) ** 2 * (prior.alpha + prior.beta + 1))
  // Box-Muller half — single normal sample.
  const u1 = Math.max(Math.random(), 1e-9)
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  const sampled = Math.max(0, Math.min(1, mean + z * Math.sqrt(variance)))
  // Scale to ±2 around 0.5: a slice with sampled posterior 0.8 → +1.2
  // boost, sampled 0.2 → -1.2 penalty. Matches the magnitude of the
  // intent / role heuristic boosts (3-5 pts) so the bandit nudges
  // without dominating.
  return Math.round((sampled - 0.5) * 4 * 10) / 10
}
