import type { Company, Opportunity, Signal, Contact, FunnelBenchmark, RepProfile } from '../types/ontology'
import type { DailyBriefing, BriefingItem, StalledDealSummary, SignalSummary, FunnelComparison } from '../types/agent'
import { generateNextBestAction } from './action-generator'

export interface BriefingInput {
  rep: RepProfile
  companies: Company[]
  opportunities: Opportunity[]
  signals: Signal[]
  contacts: Contact[]
  repBenchmarks: FunnelBenchmark[]
  companyBenchmarks: FunnelBenchmark[]
}

export function assembleDailyBriefing(input: BriefingInput): DailyBriefing {
  const { rep, companies, opportunities, signals, contacts, repBenchmarks, companyBenchmarks } = input

  const sortedCompanies = [...companies].sort(
    (a, b) => b.expected_revenue - a.expected_revenue
  )

  const topActions = buildTopActions(sortedCompanies.slice(0, 8), opportunities, signals, contacts)

  const stalledDeals = buildStalledDeals(opportunities, companies, companyBenchmarks)

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const recentSignals = buildSignalSummaries(
    signals.filter((s) => new Date(s.detected_at) >= fourteenDaysAgo),
    companies
  )

  const funnelSnapshot = buildFunnelComparison(repBenchmarks, companyBenchmarks)

  const openOpps = opportunities.filter((o) => !o.is_closed)
  const totalValue = openOpps.reduce((s, o) => s + (o.value ?? 0), 0)
  const expectedValue = companies.reduce((s, c) => s + c.expected_revenue, 0)

  const allActions = topActions.slice(0, 3)
  const primaryAction = allActions[0] ?? null
  const secondaryActions = allActions.slice(1)

  return {
    rep_id: rep.crm_id,
    date: new Date().toISOString().split('T')[0],
    greeting: buildGreeting(rep.name, rep.comm_style),
    primary_action: primaryAction,
    secondary_actions: secondaryActions,
    top_actions: allActions,
    stalled_deals: stalledDeals,
    new_signals: recentSignals.slice(0, 5),
    funnel_snapshot: funnelSnapshot,
    pipeline_summary: {
      total_value: Math.round(totalValue),
      expected_value: Math.round(expectedValue),
      deal_count: openOpps.length,
      hot_count: companies.filter((c) => c.priority_tier === 'HOT').length,
      stall_count: stalledDeals.length,
    },
  }
}

function buildTopActions(
  companies: Company[],
  opportunities: Opportunity[],
  signals: Signal[],
  contacts: Contact[]
): BriefingItem[] {
  const seen = new Set<string>()
  const items: BriefingItem[] = []

  for (const company of companies) {
    const companyOpps = opportunities.filter((o) => o.company_id === company.id && !o.is_closed)
    const companySignals = signals.filter((s) => s.company_id === company.id)
    const companyContacts = contacts.filter((c) => c.company_id === company.id)
    const topOpp = companyOpps[0] ?? null

    const triggerType = determineTriggerType(company, topOpp, companySignals)
    if (seen.has(triggerType) && items.length >= 2) continue
    seen.add(triggerType)

    const action = generateNextBestAction(company, topOpp, companySignals, companyContacts)

    items.push({
      rank: items.length + 1,
      account_id: company.id,
      account_name: company.name,
      severity: topOpp?.is_stalled ? 'critical' : companySignals.some((s) => s.urgency === 'immediate') ? 'high' : 'medium',
      trigger_type: triggerType,
      reason: company.priority_reason ?? 'High expected revenue',
      action,
      deal_value: topOpp?.value ?? null,
      expected_revenue: company.expected_revenue,
    })

    if (items.length >= 5) break
  }

  return items
}

function determineTriggerType(
  company: Company,
  opp: Opportunity | null,
  signals: Signal[]
): string {
  if (opp?.is_stalled) return 'stall'
  if (signals.some((s) => s.urgency === 'immediate')) return 'signal'
  if (!opp) return 'prospect'
  return 'pipeline'
}

function buildStalledDeals(
  opportunities: Opportunity[],
  companies: Company[],
  benchmarks: FunnelBenchmark[]
): StalledDealSummary[] {
  return opportunities
    .filter((o) => o.is_stalled && !o.is_closed)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .map((o) => {
      const company = companies.find((c) => c.id === o.company_id)
      const bench = benchmarks.find((b) => b.stage_name === o.stage)
      return {
        id: o.id,
        name: o.name,
        company_name: company?.name ?? 'Unknown',
        company_id: o.company_id,
        stage: o.stage,
        value: o.value,
        days_in_stage: o.days_in_stage,
        median_days: bench?.median_days_in_stage ?? 14,
        stall_reason: o.stall_reason,
        last_activity_date: company?.last_activity_date ?? null,
      }
    })
}

function buildSignalSummaries(signals: Signal[], companies: Company[]): SignalSummary[] {
  return signals
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .map((s) => {
      const company = companies.find((c) => c.id === s.company_id)
      return {
        id: s.id,
        company_id: s.company_id,
        company_name: company?.name ?? 'Unknown',
        signal_type: s.signal_type,
        title: s.title,
        urgency: s.urgency,
        relevance_score: s.relevance_score,
        detected_at: s.detected_at,
      }
    })
}

function buildFunnelComparison(
  repBenchmarks: FunnelBenchmark[],
  companyBenchmarks: FunnelBenchmark[]
): FunnelComparison[] {
  return repBenchmarks.map((rb) => {
    const cb = companyBenchmarks.find((c) => c.stage_name === rb.stage_name)
    const deltaDrop = rb.drop_rate - (cb?.drop_rate ?? 0)
    const deltaConv = rb.conversion_rate - (cb?.conversion_rate ?? 0)
    const isHighDrop = deltaDrop >= 5
    const isHighVolume = rb.deal_count >= (cb?.deal_count ?? 1)

    let status: FunnelComparison['status']
    if (isHighDrop && isHighVolume) status = 'CRITICAL'
    else if (isHighDrop) status = 'MONITOR'
    else if (isHighVolume) status = 'OPPORTUNITY'
    else status = 'HEALTHY'

    return {
      stage: rb.stage_name,
      rep_conv: rb.conversion_rate,
      rep_drop: rb.drop_rate,
      rep_deals: rb.deal_count,
      rep_avg_days: rb.avg_days_in_stage,
      bench_conv: cb?.conversion_rate ?? 0,
      bench_drop: cb?.drop_rate ?? 0,
      delta_conv: Math.round(deltaConv * 100) / 100,
      delta_drop: Math.round(deltaDrop * 100) / 100,
      impact_score: rb.impact_score,
      stall_count: rb.stall_count,
      status,
    }
  })
}

function buildGreeting(name: string, style: string): string {
  const firstName = name.split(' ')[0]
  const hour = new Date().getHours()

  const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  if (style === 'brief') return `${timeGreeting}, ${firstName}.`
  if (style === 'casual') return `Hey ${firstName}! Here's your day.`
  return `${timeGreeting}, ${firstName}. Here is your priority briefing for today.`
}
