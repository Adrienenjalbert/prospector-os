/**
 * Shared Beta-Bernoulli bandit math (Phase 7, Section 2.3 extraction).
 *
 * Phase 6 introduced two Beta posteriors:
 *   - per-memory in tenant_memories.prior_alpha/beta
 *   - per-wiki_page in wiki_pages.prior_alpha/beta
 *
 * Phase 7 adds a third:
 *   - per-trigger in triggers.prior_alpha/beta
 *
 * All three use IDENTICAL math (same conjugate, same Thompson sample,
 * same MIN_SAMPLES gate). Before this extraction the math lived in
 * apps/web/src/lib/memory/bandit.ts as `thompsonAdjustForMemory`. As
 * the third caller landed, the duplication risk grew — one tweak in
 * one file leaves the other two stale.
 *
 * This module owns the math. Callers (memory bandit, wiki page
 * bandit, trigger bandit) provide their own load + update logic for
 * their respective tables; the scoring math is shared.
 */

/**
 * Threshold below which the Thompson sample is suppressed (returns 0).
 * Below this, the posterior is too thin to act on and the call site
 * falls back to its heuristic (confidence DESC for atoms, score DESC
 * for triggers, etc.).
 *
 * 10 = the convention shared by tool_priors, slice priors, and
 * memory bandit. Tweaking this here moves all three callers in
 * lockstep.
 */
export const MIN_SAMPLES_FOR_BANDIT = 10

export interface BetaPrior {
  prior_alpha: number
  prior_beta: number
}

/**
 * Thompson-sample one prior. Returns a score adjustment in roughly
 * [-2, +2] using the sampled posterior's distance from 0.5.
 *
 * Same formula across memory / wiki page / trigger bandits so the
 * magnitudes are interchangeable when ranking surfaces compose
 * multiple bandits.
 *
 * Returns 0 below MIN_SAMPLES_FOR_BANDIT — the posterior is not yet
 * trustworthy enough to sway ordering. Cold-start rows defer to the
 * caller's heuristic.
 */
export function thompsonAdjust(prior: BetaPrior | undefined): number {
  if (!prior) return 0
  // alpha + beta - 2 = number of observed events. (Beta(1,1) is the
  // uniform prior; subtract the 2 prior pseudo-counts so cold-start
  // rows don't count themselves.)
  const sampleCount = prior.prior_alpha + prior.prior_beta - 2
  if (sampleCount < MIN_SAMPLES_FOR_BANDIT) return 0

  const mean = prior.prior_alpha / (prior.prior_alpha + prior.prior_beta)
  const variance =
    (prior.prior_alpha * prior.prior_beta) /
    ((prior.prior_alpha + prior.prior_beta) ** 2 *
      (prior.prior_alpha + prior.prior_beta + 1))

  // Box-Muller half — single normal sample. Math.random() can return
  // exactly 0; cap at 1e-9 to avoid -Infinity from log(0).
  const u1 = Math.max(Math.random(), 1e-9)
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  const sampled = Math.max(0, Math.min(1, mean + z * Math.sqrt(variance)))

  // Map [0,1] → [-2, +2] centred on 0.5. Round to 1 decimal to
  // match the slice / tool bandit magnitudes.
  return Math.round((sampled - 0.5) * 4 * 10) / 10
}

/**
 * Posterior mean — used by surfaces that want the "expected success
 * rate" without sampling noise (e.g. /admin/triggers showing
 * `E[acted]: 0.74`). Returns null when the prior is below the
 * sample threshold so consumers can show "—" instead of a noisy
 * cold-start number.
 */
export function posteriorMean(prior: BetaPrior | undefined): number | null {
  if (!prior) return null
  const sampleCount = prior.prior_alpha + prior.prior_beta - 2
  if (sampleCount < MIN_SAMPLES_FOR_BANDIT) return null
  return prior.prior_alpha / (prior.prior_alpha + prior.prior_beta)
}

/**
 * Returns the integer count of observed events behind the posterior.
 * Useful for sorting "most observed" / "least observed" rows in
 * admin UIs.
 */
export function sampleCount(prior: BetaPrior | undefined): number {
  if (!prior) return 0
  return Math.max(0, Math.round(prior.prior_alpha + prior.prior_beta - 2))
}
