import type { Company, Opportunity, Signal, Contact } from '../types/ontology'
import type { PriorityAccountSummary } from '../types/agent'

export type QueueType = 'today' | 'pipeline' | 'prospecting'

export interface QueueInput {
  companies: Company[]
  opportunities: Opportunity[]
  signals: Signal[]
  contacts: Contact[]
}

export function buildQueue(
  input: QueueInput,
  queueType: QueueType,
  limit: number = 10
): PriorityAccountSummary[] {
  const { companies, opportunities, signals, contacts } = input

  let filtered: Company[]

  switch (queueType) {
    case 'today':
      filtered = companies
        .filter((c) => c.priority_tier === 'HOT' || c.priority_tier === 'WARM' || hasUrgentSignal(c.id, signals) || hasStalledDeal(c.id, opportunities))
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

  const sorted = filtered.sort((a, b) => b.expected_revenue - a.expected_revenue)

  return sorted.slice(0, limit).map((c) => {
    const companyOpps = opportunities.filter((o) => o.company_id === c.id && !o.is_closed)
    const companySignals = signals.filter((s) => s.company_id === c.id)
    const companyContacts = contacts.filter((ct) => ct.company_id === c.id)
    const topOpp = companyOpps.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0]

    return {
      id: c.id,
      name: c.name,
      expected_revenue: c.expected_revenue,
      propensity: c.propensity,
      priority_tier: c.priority_tier,
      priority_reason: c.priority_reason,
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
