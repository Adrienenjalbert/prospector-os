/**
 * Per-operation enrichment cost map. Replaces the flat `$0.50` assumption
 * the cron used to make about every Apollo call.
 *
 * Apollo's actual pricing varies by operation:
 *   - Company enrichment   ~$0.05  per call
 *   - Job postings         ~$0.05  per call (cheap)
 *   - Contact search       ~$0.10  per call (no phone reveal)
 *   - Person match         ~$0.20  per call (current org + history)
 *   - Phone unlock         ~$1.00  per contact (premium)
 *
 * The numbers here are deliberately conservative defaults — admins can
 * override per tenant via `tenants.enrichment_cost_overrides` (Phase 2)
 * once the bookkeeping path lands. The point of having them in code at
 * all is so:
 *
 *   1. Budget enforcement uses real prices, not a flat $0.50.
 *   2. The spend-by-op JSONB on tenants accumulates the right buckets
 *      so admins can see "phones cost us $400, jobs cost $20".
 *   3. Tier-based depth in cron/enrich can do meaningful trade-offs
 *      ("Tier A gets the $1.00 phone unlock; Tier C does not").
 *
 * Keep this list in sync with `applyCost()` callers and the
 * `enrichment_spend_by_op` JSONB keys.
 */

export type EnrichmentOperation =
  | 'company_enrich'
  | 'contact_search'
  | 'phone_unlock'
  | 'job_postings'
  | 'person_match'

export const ENRICHMENT_COSTS: Record<EnrichmentOperation, number> = {
  company_enrich: 0.05,
  contact_search: 0.1,
  phone_unlock: 1.0,
  job_postings: 0.05,
  person_match: 0.2,
}

/**
 * Sum a partial spend-by-op map into a single dollar number. Used by the
 * budget guard to compare against `enrichment_budget_monthly`.
 */
export function totalSpend(spendByOp: Partial<Record<EnrichmentOperation, number>>): number {
  return Object.values(spendByOp).reduce((sum, v) => sum + (v ?? 0), 0)
}

/**
 * Add `units` operations of `op` to the running spend ledger. Pure
 * function — caller is responsible for persisting.
 */
export function addCost(
  spendByOp: Partial<Record<EnrichmentOperation, number>>,
  op: EnrichmentOperation,
  units = 1,
): Partial<Record<EnrichmentOperation, number>> {
  const cost = ENRICHMENT_COSTS[op] * units
  return {
    ...spendByOp,
    [op]: (spendByOp[op] ?? 0) + cost,
  }
}

/**
 * Decide whether one more call of `op` would breach `monthlyBudget`.
 * Used by the cron and by ad-hoc workflows so the same gate runs in
 * every code path that hits Apollo.
 *
 * Returns `{ allowed: false, reason: 'over_budget' }` so the caller can
 * either skip silently or surface to the rep ("we'd need $2 to unlock
 * Sarah's phone; budget left is $0.30 — defer to next month?").
 */
export function canAfford(
  spendByOp: Partial<Record<EnrichmentOperation, number>>,
  monthlyBudget: number,
  op: EnrichmentOperation,
  units = 1,
): { allowed: boolean; reason?: 'over_budget' | 'budget_zero'; remaining: number; cost: number } {
  if (monthlyBudget <= 0) {
    return { allowed: false, reason: 'budget_zero', remaining: 0, cost: 0 }
  }
  const cost = ENRICHMENT_COSTS[op] * units
  const used = totalSpend(spendByOp)
  const remaining = monthlyBudget - used
  if (cost > remaining) {
    return { allowed: false, reason: 'over_budget', remaining, cost }
  }
  return { allowed: true, remaining, cost }
}
