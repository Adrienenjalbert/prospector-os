import { createClient } from '@supabase/supabase-js'
import type {
  AgentContext,
  PriorityAccountSummary,
  FunnelComparison,
  StalledDealSummary,
  SignalSummary,
  PageContext,
} from '@prospector/core'

export async function assembleAgentContext(
  repId: string,
  tenantId: string,
  pageContext?: PageContext
): Promise<AgentContext> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const [
    repResult,
    accountsResult,
    repBenchResult,
    companyBenchResult,
    stalledResult,
  ] = await Promise.all([
    supabase
      .from('rep_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('crm_id', repId)
      .single(),
    supabase
      .from('companies')
      .select('id, name, expected_revenue, propensity, priority_tier, priority_reason, icp_tier, icp_score, signal_score')
      .eq('tenant_id', tenantId)
      .eq('owner_crm_id', repId)
      .order('expected_revenue', { ascending: false })
      .limit(20),
    supabase
      .from('funnel_benchmarks')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('scope', 'rep')
      .eq('scope_id', repId),
    supabase
      .from('funnel_benchmarks')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('scope', 'company')
      .eq('scope_id', 'all'),
    supabase
      .from('opportunities')
      .select('id, name, company_id, stage, value, days_in_stage, stall_reason, is_stalled')
      .eq('tenant_id', tenantId)
      .eq('owner_crm_id', repId)
      .eq('is_stalled', true)
      .eq('is_closed', false),
  ])

  const repProfile = repResult.data
  if (!repProfile) throw new Error(`Rep not found: ${repId}`)

  const accountIds = (accountsResult.data ?? []).map((a) => a.id)

  const safeIds = accountIds.length > 0 ? accountIds : ['none']

  const [signalsResult, oppsForAccounts, contactCounts] = await Promise.all([
    supabase
      .from('signals')
      .select('id, company_id, signal_type, title, urgency, relevance_score, detected_at')
      .eq('tenant_id', tenantId)
      .in('company_id', safeIds)
      .gte('detected_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .order('weighted_score', { ascending: false })
      .limit(20),
    supabase
      .from('opportunities')
      .select('company_id, stage, value, days_in_stage, is_stalled')
      .eq('tenant_id', tenantId)
      .in('company_id', safeIds)
      .eq('is_closed', false),
    supabase
      .from('contacts')
      .select('company_id')
      .eq('tenant_id', tenantId)
      .in('company_id', safeIds),
  ])

  const oppsByCompany = new Map<string, typeof oppsForAccounts.data>()
  for (const opp of oppsForAccounts.data ?? []) {
    const list = oppsByCompany.get(opp.company_id) ?? []
    list.push(opp)
    oppsByCompany.set(opp.company_id, list)
  }

  const contactCountMap = new Map<string, number>()
  for (const c of contactCounts.data ?? []) {
    contactCountMap.set(c.company_id, (contactCountMap.get(c.company_id) ?? 0) + 1)
  }

  const signalsByCompany = new Map<string, typeof signalsResult.data>()
  for (const sig of signalsResult.data ?? []) {
    const list = signalsByCompany.get(sig.company_id) ?? []
    list.push(sig)
    signalsByCompany.set(sig.company_id, list)
  }

  const priorityAccounts: PriorityAccountSummary[] = (accountsResult.data ?? []).map((a) => {
    const opps = oppsByCompany.get(a.id) ?? []
    const topOpp = opps.sort((x, y) => (y.value ?? 0) - (x.value ?? 0))[0]
    const sigs = signalsByCompany.get(a.id) ?? []

    return {
      id: a.id,
      name: a.name,
      expected_revenue: a.expected_revenue,
      propensity: a.propensity,
      priority_tier: a.priority_tier,
      priority_reason: a.priority_reason,
      icp_tier: a.icp_tier,
      deal_value: topOpp?.value ?? null,
      stage: topOpp?.stage ?? null,
      days_in_stage: topOpp?.days_in_stage ?? null,
      is_stalled: topOpp?.is_stalled ?? false,
      signal_count: sigs.length,
      top_signal: sigs[0]?.title ?? null,
      contact_count: contactCountMap.get(a.id) ?? 0,
    }
  })

  const benchmarksByStage = new Map(
    (companyBenchResult.data ?? []).map((b) => [b.stage_name, b])
  )

  const funnelComparison: FunnelComparison[] = (repBenchResult.data ?? []).map((rb) => {
    const cb = benchmarksByStage.get(rb.stage_name)
    const deltaDrop = rb.drop_rate - (cb?.drop_rate ?? 0)
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
      delta_conv: Math.round((rb.conversion_rate - (cb?.conversion_rate ?? 0)) * 100) / 100,
      delta_drop: Math.round(deltaDrop * 100) / 100,
      impact_score: rb.impact_score,
      stall_count: rb.stall_count,
      status,
    }
  })

  const stalledDeals: StalledDealSummary[] = (stalledResult.data ?? []).map((o) => {
    const company = (accountsResult.data ?? []).find((a) => a.id === o.company_id)
    const stageBench = benchmarksByStage.get(o.stage)
    return {
      id: o.id,
      name: o.name,
      company_name: company?.name ?? 'Unknown',
      company_id: o.company_id,
      stage: o.stage,
      value: o.value,
      days_in_stage: o.days_in_stage,
      median_days: stageBench?.median_days_in_stage ?? 14,
      stall_reason: o.stall_reason,
      last_activity_date: null,
    }
  })

  const recentSignals: SignalSummary[] = (signalsResult.data ?? []).map((s) => {
    const company = (accountsResult.data ?? []).find((a) => a.id === s.company_id)
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

  let currentAccount = null
  let currentDeal = null

  if (pageContext?.accountId) {
    const { data } = await supabase
      .from('companies')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', pageContext.accountId)
      .single()
    currentAccount = data
  }

  if (pageContext?.dealId) {
    const { data } = await supabase
      .from('opportunities')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', pageContext.dealId)
      .single()
    currentDeal = data
  }

  return {
    rep_profile: repProfile,
    priority_accounts: priorityAccounts,
    funnel_comparison: funnelComparison,
    stalled_deals: stalledDeals,
    recent_signals: recentSignals,
    company_benchmarks: companyBenchResult.data ?? [],
    current_page: pageContext?.page ?? null,
    current_account: currentAccount,
    current_deal: currentDeal,
  }
}
