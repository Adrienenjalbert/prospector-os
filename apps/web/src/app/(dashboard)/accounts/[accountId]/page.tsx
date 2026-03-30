import { createSupabaseServer } from '@/lib/supabase/server'
import { formatGbp } from '@/lib/utils'
import { AccountDetailClient } from './account-detail-client'

type PageProps = {
  params: Promise<{ accountId: string }>
  searchParams: Promise<{ tab?: string }>
}

async function fetchAccountData(accountId: string) {
  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()
    if (!profile?.tenant_id) return null

    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', accountId)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (!company) return null

    const [signalsRes, contactsRes, oppsRes] = await Promise.all([
      supabase
        .from('signals')
        .select('id, title, signal_type, description, urgency, relevance_score, weighted_score, recommended_action, detected_at, source')
        .eq('tenant_id', profile.tenant_id)
        .eq('company_id', accountId)
        .order('detected_at', { ascending: false })
        .limit(20),
      supabase
        .from('contacts')
        .select('id, first_name, last_name, title, email, phone, seniority, department, is_champion, is_decision_maker, is_economic_buyer, role_tag, engagement_score, relevance_score, linkedin_url, photo_url')
        .eq('tenant_id', profile.tenant_id)
        .eq('company_id', accountId)
        .order('relevance_score', { ascending: false }),
      supabase
        .from('opportunities')
        .select('id, name, value, stage, stage_order, probability, days_in_stage, is_stalled, stall_reason, next_best_action, expected_close_date, is_closed, is_won')
        .eq('tenant_id', profile.tenant_id)
        .eq('company_id', accountId)
        .order('value', { ascending: false }),
    ])

    const dims = company.icp_dimensions as Record<
      string,
      { name: string; score: number; weight: number; label: string; weighted_score: number }
    > | null

    const DIMENSION_LABELS: Record<string, string> = {
      industry_vertical: 'Industry Fit',
      company_size: 'Company Size',
      geography: 'Geography',
      temp_flex_usage: 'Temp/Flex Usage',
      tech_ops_maturity: 'Tech Maturity',
    }

    const icpDimensions: { name: string; score: number; tier?: string }[] = []
    if (dims && typeof dims === 'object') {
      for (const [key, dim] of Object.entries(dims)) {
        if (dim && typeof dim.score === 'number') {
          icpDimensions.push({
            name: DIMENSION_LABELS[key] ?? dim.name ?? key,
            score: dim.score,
            tier: dim.label,
          })
        }
      }
    }

    const subScores = [
      ...icpDimensions.map(d => ({ name: d.name, score: d.score, tier: d.tier })),
      { name: 'Signal Momentum', score: company.signal_score ?? 0, tier: undefined },
      { name: 'Engagement', score: company.engagement_score ?? 0, tier: undefined },
      { name: 'Contact Coverage', score: company.contact_coverage_score ?? 0, tier: undefined },
      { name: 'Velocity', score: company.velocity_score ?? 0, tier: undefined },
      { name: 'Win Rate', score: company.win_rate_score ?? 0, tier: undefined },
    ]

    const topOpp = (oppsRes.data ?? []).filter(o => !o.is_closed)[0] ?? null

    return {
      company: {
        id: company.id,
        name: company.name,
        industry: company.industry,
        employee_count: company.employee_count,
        employee_range: company.employee_range,
        annual_revenue: company.annual_revenue ? Number(company.annual_revenue) : null,
        revenue_range: company.revenue_range,
        hq_city: company.hq_city,
        hq_country: company.hq_country,
        founded_year: company.founded_year,
        website: company.website,
        domain: company.domain,
        tech_stack: company.tech_stack ?? [],
        enrichment_data: company.enrichment_data ?? {},
        enriched_at: company.enriched_at,
        enrichment_source: company.enrichment_source,
        propensity: company.propensity != null ? Number(company.propensity) : 0,
        priorityTier: company.priority_tier,
        icpTier: company.icp_tier,
        priorityReason: company.priority_reason,
        expectedRevenue: company.expected_revenue != null ? Number(company.expected_revenue) : 0,
      },
      subScores,
      signals: (signalsRes.data ?? []).map((s) => ({
        id: s.id,
        signal_type: s.signal_type,
        title: s.title,
        description: s.description,
        urgency: s.urgency,
        relevance_score: s.relevance_score,
        weighted_score: s.weighted_score,
        recommended_action: s.recommended_action,
        detected_at: s.detected_at,
        source: s.source,
      })),
      contacts: (contactsRes.data ?? []).map((ct) => ({
        id: ct.id,
        name: `${ct.first_name} ${ct.last_name}`,
        firstName: ct.first_name,
        lastName: ct.last_name,
        title: ct.title ?? '',
        email: ct.email,
        phone: ct.phone,
        seniority: ct.seniority,
        department: ct.department,
        isChampion: ct.is_champion,
        isDecisionMaker: ct.is_decision_maker,
        isEconomicBuyer: ct.is_economic_buyer,
        roleTag: ct.role_tag,
        engagementScore: ct.engagement_score,
        relevanceScore: ct.relevance_score,
        linkedinUrl: ct.linkedin_url,
        photoUrl: ct.photo_url,
      })),
      opportunities: (oppsRes.data ?? []).map((o) => ({
        id: o.id,
        name: o.name,
        value: o.value != null ? Number(o.value) : null,
        stage: o.stage,
        stageOrder: o.stage_order,
        probability: o.probability,
        daysInStage: o.days_in_stage,
        isStalled: o.is_stalled,
        stallReason: o.stall_reason,
        nextBestAction: o.next_best_action,
        expectedCloseDate: o.expected_close_date,
        isClosed: o.is_closed,
        isWon: o.is_won,
      })),
      dealValue: topOpp?.value != null ? Number(topOpp.value) : null,
    }
  } catch (e) {
    console.error('[account detail]', e)
    return null
  }
}

const DEMO_DATA = {
  company: {
    id: 'demo-001',
    name: 'Acme Logistics',
    industry: 'Logistics & Warehousing',
    employee_count: 2000,
    employee_range: '1,000-5,000',
    annual_revenue: 180_000_000,
    revenue_range: '£100M-£500M',
    hq_city: 'Manchester',
    hq_country: 'UK',
    founded_year: 2005,
    website: 'https://acmelogistics.co.uk',
    domain: 'acmelogistics.co.uk',
    tech_stack: ['Salesforce', 'Microsoft 365', 'SAP'],
    enrichment_data: {
      mspData: {
        currentAgencySpend: '£4.2M',
        tempWorkersPerDay: '180+',
        contingentStaffUsage: 'active',
        staffingManagement: 'multiple-agencies',
        mspExperience: '1st-gen',
        keyPainPoints: ['Multi-agency complexity', 'No real-time visibility', 'Inconsistent worker quality'],
      },
    },
    enriched_at: '2026-03-28T10:00:00Z',
    enrichment_source: 'Apollo',
    propensity: 87,
    priorityTier: 'HOT',
    icpTier: 'A',
    priorityReason: 'ICP fit (Tier A: logistics, 2000 employees) + stalled deal at Proposal + hiring surge signal',
    expectedRevenue: 200_000,
  },
  subScores: [
    { name: 'Industry Fit', score: 92, tier: 'Logistics' },
    { name: 'Company Size', score: 85, tier: '2000 employees' },
    { name: 'Geography', score: 90, tier: 'Manchester, UK' },
    { name: 'Signal Momentum', score: 78, tier: undefined },
    { name: 'Engagement', score: 65, tier: undefined },
    { name: 'Contact Coverage', score: 85, tier: undefined },
    { name: 'Velocity', score: 40, tier: undefined },
    { name: 'Win Rate', score: 72, tier: undefined },
  ],
  signals: [
    { id: 's1', signal_type: 'hiring_surge', title: 'Peak season hiring surge — 45 warehouse roles', description: null, urgency: 'immediate', relevance_score: 0.92, weighted_score: 1.66, recommended_action: 'Call Sarah Chen about peak season staffing', detected_at: new Date(Date.now() - 2 * 86400000).toISOString(), source: 'Apollo' },
    { id: 's2', signal_type: 'expansion', title: 'New distribution centre opening in Leeds', description: null, urgency: 'this_week', relevance_score: 0.78, weighted_score: 1.02, recommended_action: null, detected_at: new Date(Date.now() - 7 * 86400000).toISOString(), source: 'Claude Research' },
  ],
  contacts: [
    { id: 'c1', name: 'Sarah Chen', firstName: 'Sarah', lastName: 'Chen', title: 'VP Operations', email: 'sarah.chen@acmelogistics.co.uk', phone: '+44 7700 900123', seniority: 'vp', department: 'Operations', isChampion: true, isDecisionMaker: true, isEconomicBuyer: false, roleTag: 'champion', engagementScore: 85, relevanceScore: 92, linkedinUrl: null, photoUrl: null },
    { id: 'c2', name: 'James Miller', firstName: 'James', lastName: 'Miller', title: 'Dir. Facilities', email: 'james.miller@acmelogistics.co.uk', phone: '+44 7700 900456', seniority: 'director', department: 'Facilities', isChampion: false, isDecisionMaker: false, isEconomicBuyer: false, roleTag: 'technical_evaluator', engagementScore: 45, relevanceScore: 68, linkedinUrl: null, photoUrl: null },
  ],
  opportunities: [
    { id: 'o1', name: 'Q2 Temp Staffing', value: 800_000, stage: 'Proposal', stageOrder: 3, probability: 65, daysInStage: 22, isStalled: true, stallReason: 'No contact activity in 14 days', nextBestAction: 'Call Sarah Chen — re-engage on proposal', expectedCloseDate: '2026-06-30', isClosed: false, isWon: false },
  ],
  dealValue: 800_000,
}

export default async function AccountDetailPage(props: PageProps) {
  const { accountId } = await props.params
  const searchParams = await props.searchParams
  const initialTab = searchParams.tab ?? 'overview'

  const data = await fetchAccountData(accountId)
  const display = data ?? DEMO_DATA

  return (
    <AccountDetailClient
      data={display}
      initialTab={initialTab}
      isDemo={!data}
    />
  )
}
