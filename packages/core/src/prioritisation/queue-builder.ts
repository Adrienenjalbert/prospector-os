import type { Company, Opportunity, Signal, Contact } from '../types/ontology'
import type { PriorityAccountSummary } from '../types/agent'

export type QueueType = 'today' | 'pipeline' | 'prospecting'

/**
 * Phase 7 (Section 2.4): a thin shape for the open triggers feeding
 * the queue. Importers (queue-builder callers) load triggers via
 * `loadOpenTriggersForQueue` in the workflow / API layer, then pass
 * them in here. Pure to keep queue-builder's "no IO" contract.
 */
export interface OpenTriggerForQueue {
  id: string
  company_id: string | null
  pattern: string
  trigger_score: number
  rationale: string
}

/**
 * Phase 7 — composite triggers with score >= 0.7 win the today
 * queue regardless of expected_revenue. Below this threshold the
 * trigger is too uncertain to override the existing tier ordering.
 *
 * Push budget caps still apply at the dispatcher (alert_frequency:
 * high=3, medium=2, low=1). Triggers don't bypass UX guarantees;
 * they re-order WHICH accounts get the limited push slots.
 */
export const TRIGGER_TIER1_SCORE_THRESHOLD = 0.7

export interface QueueInput {
  companies: Company[]
  opportunities: Opportunity[]
  signals: Signal[]
  contacts: Contact[]
  /**
   * Open triggers for the tenant (loaded by the caller). Pass an
   * empty array if Phase 7 isn't wired yet OR when the queue is
   * built for a context that doesn't care (e.g. backfill scoring).
   */
  triggers?: OpenTriggerForQueue[]
}

export function buildQueue(
  input: QueueInput,
  queueType: QueueType,
  limit: number = 10
): PriorityAccountSummary[] {
  const { companies, opportunities, signals, contacts, triggers = [] } = input

  // Phase 7 (Section 2.4) — companies anchored to a tier-1 trigger
  // get a precedence boost in the today queue. We compute the set
  // here once so the filter + the row decoration can both reference
  // it without re-walking the triggers array.
  const tier1Triggers = triggers.filter(
    (t) => t.trigger_score >= TRIGGER_TIER1_SCORE_THRESHOLD && t.company_id,
  )
  const tier1ByCompany = new Map<string, OpenTriggerForQueue>()
  for (const t of tier1Triggers) {
    if (!t.company_id) continue
    const existing = tier1ByCompany.get(t.company_id)
    // Keep the highest-score trigger per company (the queue can only
    // surface one row per account; we promote the strongest signal).
    if (!existing || t.trigger_score > existing.trigger_score) {
      tier1ByCompany.set(t.company_id, t)
    }
  }

  let filtered: Company[]

  switch (queueType) {
    case 'today':
      filtered = companies.filter(
        (c) =>
          c.priority_tier === 'HOT' ||
          c.priority_tier === 'WARM' ||
          hasUrgentSignal(c.id, signals) ||
          hasStalledDeal(c.id, opportunities) ||
          // Phase 7: any open trigger with score >= threshold puts the
          // company on today's queue regardless of tier.
          tier1ByCompany.has(c.id),
      )
      break

    case 'pipeline':
      filtered = companies.filter((c) =>
        opportunities.some((o) => o.company_id === c.id && !o.is_closed)
      )
      break

    case 'prospecting':
      filtered = companies.filter((c) =>
        !opportunities.some((o) => o.company_id === c.id && !o.is_closed) &&
        (c.icp_tier === 'A' || c.icp_tier === 'B')
      )
      break

    default:
      filtered = companies
  }

  // Phase 7 sort: companies with a tier-1 trigger come FIRST, ordered
  // by trigger_score DESC. Within either bucket, expected_revenue DESC
  // breaks ties (preserves the pre-Phase-7 ordering for trigger-less
  // companies).
  const sorted = filtered.sort((a, b) => {
    const aTrigger = tier1ByCompany.get(a.id)
    const bTrigger = tier1ByCompany.get(b.id)
    if (aTrigger && !bTrigger) return -1
    if (!aTrigger && bTrigger) return 1
    if (aTrigger && bTrigger && aTrigger.trigger_score !== bTrigger.trigger_score) {
      return bTrigger.trigger_score - aTrigger.trigger_score
    }
    return b.expected_revenue - a.expected_revenue
  })

  return sorted.slice(0, limit).map((c) => {
    const companyOpps = opportunities.filter((o) => o.company_id === c.id && !o.is_closed)
    const companySignals = signals.filter((s) => s.company_id === c.id)
    const companyContacts = contacts.filter((ct) => ct.company_id === c.id)
    const topOpp = companyOpps.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0]
    const topTrigger = tier1ByCompany.get(c.id) ?? null

    return {
      id: c.id,
      name: c.name,
      expected_revenue: c.expected_revenue,
      propensity: c.propensity,
      // Phase 7: a tier-1 trigger overrides the priority_reason with
      // the trigger's rationale so the rep sees WHY it's on today's
      // queue (one decision instead of N component signals).
      priority_tier: c.priority_tier,
      priority_reason: topTrigger ? topTrigger.rationale : c.priority_reason,
      icp_tier: c.icp_tier,
      deal_value: topOpp?.value ?? null,
      stage: topOpp?.stage ?? null,
      days_in_stage: topOpp?.days_in_stage ?? null,
      is_stalled: topOpp?.is_stalled ?? false,
      signal_count: companySignals.length,
      top_signal: companySignals[0]?.title ?? null,
      contact_count: companyContacts.length,
    }
  })
}

function hasUrgentSignal(companyId: string, signals: Signal[]): boolean {
  return signals.some(
    (s) => s.company_id === companyId && s.urgency === 'immediate'
  )
}

function hasStalledDeal(companyId: string, opps: Opportunity[]): boolean {
  return opps.some(
    (o) => o.company_id === companyId && o.is_stalled && !o.is_closed
  )
}
