import { createSupabaseServer } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { AccountDetailClient } from './account-detail-client'
import { AccountResearchButton } from './research-button'

interface DemoAccount {
  id: string
  name: string
  industry: string
  icp_tier: string
  priority_tier: string
  propensity: number
  expected_revenue: number
  hq_city: string
  hq_country: string
  employee_count: number
  sub_scores: { name: string; label: string; score: number; weight: number; weightedScore: number }[]
}

const DEMO_ACCOUNTS: Record<string, DemoAccount> = {
  'demo-001': {
    id: 'demo-001',
    name: 'Acme Logistics',
    industry: 'Logistics',
    icp_tier: 'A',
    priority_tier: 'HOT',
    propensity: 87,
    expected_revenue: 200_000,
    hq_city: 'Manchester',
    hq_country: 'UK',
    employee_count: 1200,
    sub_scores: [
      { name: 'icp_fit', label: 'ICP Fit', score: 92, weight: 0.15, weightedScore: 13.8 },
      { name: 'signal_momentum', label: 'Signal Momentum', score: 88, weight: 0.20, weightedScore: 17.6 },
      { name: 'engagement_depth', label: 'Engagement', score: 75, weight: 0.15, weightedScore: 11.25 },
      { name: 'contact_coverage', label: 'Contact Coverage', score: 90, weight: 0.20, weightedScore: 18.0 },
      { name: 'stage_velocity', label: 'Stage Velocity', score: 82, weight: 0.15, weightedScore: 12.3 },
      { name: 'profile_win_rate', label: 'Profile Win Rate', score: 95, weight: 0.15, weightedScore: 14.25 },
    ],
  },
  'demo-002': {
    id: 'demo-002',
    name: 'Beta Warehousing',
    industry: 'Warehousing',
    icp_tier: 'A',
    priority_tier: 'WARM',
    propensity: 79,
    expected_revenue: 160_000,
    hq_city: 'London',
    hq_country: 'UK',
    employee_count: 850,
    sub_scores: [
      { name: 'icp_fit', label: 'ICP Fit', score: 85, weight: 0.15, weightedScore: 12.75 },
      { name: 'signal_momentum', label: 'Signal Momentum', score: 72, weight: 0.20, weightedScore: 14.4 },
      { name: 'engagement_depth', label: 'Engagement', score: 68, weight: 0.15, weightedScore: 10.2 },
      { name: 'contact_coverage', label: 'Contact Coverage', score: 85, weight: 0.20, weightedScore: 17.0 },
      { name: 'stage_velocity', label: 'Stage Velocity', score: 78, weight: 0.15, weightedScore: 11.7 },
      { name: 'profile_win_rate', label: 'Profile Win Rate', score: 80, weight: 0.15, weightedScore: 12.0 },
    ],
  },
  'demo-003': {
    id: 'demo-003',
    name: 'Gamma Manufacturing',
    industry: 'Light Industrial',
    icp_tier: 'A',
    priority_tier: 'WARM',
    propensity: 63,
    expected_revenue: 63_000,
    hq_city: 'Birmingham',
    hq_country: 'UK',
    employee_count: 420,
    sub_scores: [
      { name: 'icp_fit', label: 'ICP Fit', score: 78, weight: 0.15, weightedScore: 11.7 },
      { name: 'signal_momentum', label: 'Signal Momentum', score: 55, weight: 0.20, weightedScore: 11.0 },
      { name: 'engagement_depth', label: 'Engagement', score: 40, weight: 0.15, weightedScore: 6.0 },
      { name: 'contact_coverage', label: 'Contact Coverage', score: 60, weight: 0.20, weightedScore: 12.0 },
      { name: 'stage_velocity', label: 'Stage Velocity', score: 70, weight: 0.15, weightedScore: 10.5 },
      { name: 'profile_win_rate', label: 'Profile Win Rate', score: 72, weight: 0.15, weightedScore: 10.8 },
    ],
  },
  'demo-004': {
    id: 'demo-004',
    name: 'Delta Distribution',
    industry: 'Distribution',
    icp_tier: 'B',
    priority_tier: 'COOL',
    propensity: 42,
    expected_revenue: 42_000,
    hq_city: 'Leeds',
    hq_country: 'UK',
    employee_count: 310,
    sub_scores: [
      { name: 'icp_fit', label: 'ICP Fit', score: 65, weight: 0.15, weightedScore: 9.75 },
      { name: 'signal_momentum', label: 'Signal Momentum', score: 30, weight: 0.20, weightedScore: 6.0 },
      { name: 'engagement_depth', label: 'Engagement', score: 25, weight: 0.15, weightedScore: 3.75 },
      { name: 'contact_coverage', label: 'Contact Coverage', score: 35, weight: 0.20, weightedScore: 7.0 },
      { name: 'stage_velocity', label: 'Stage Velocity', score: 50, weight: 0.15, weightedScore: 7.5 },
      { name: 'profile_win_rate', label: 'Profile Win Rate', score: 55, weight: 0.15, weightedScore: 8.25 },
    ],
  },
}

const DEFAULT_SUB_SCORES = [
  { name: 'icp_fit', label: 'ICP Fit', score: 0, weight: 0.15, weightedScore: 0 },
  { name: 'signal_momentum', label: 'Signal Momentum', score: 0, weight: 0.20, weightedScore: 0 },
  { name: 'engagement_depth', label: 'Engagement', score: 0, weight: 0.15, weightedScore: 0 },
  { name: 'contact_coverage', label: 'Contact Coverage', score: 0, weight: 0.20, weightedScore: 0 },
  { name: 'stage_velocity', label: 'Stage Velocity', score: 0, weight: 0.15, weightedScore: 0 },
  { name: 'profile_win_rate', label: 'Profile Win Rate', score: 0, weight: 0.15, weightedScore: 0 },
]

interface AccountSummary {
  id: string
  name: string
  industry: string | null
  icp_tier: string | null
  priority_tier: string | null
  propensity: number
  expected_revenue: number | null
  hq_city: string | null
  hq_country: string | null
  employee_count: number | null
  sub_scores: typeof DEFAULT_SUB_SCORES
}

interface RichAccount {
  summary: AccountSummary
  rich: Parameters<typeof AccountDetailClient>[0]['data']
  isDemo: boolean
}

async function fetchAccount(accountId: string): Promise<RichAccount | null> {
  const demo = DEMO_ACCOUNTS[accountId]
  if (demo) {
    return buildDemoRichAccount(demo)
  }

  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const [companyRes, contactsRes, oppsRes, signalsRes] = await Promise.all([
      supabase
        .from('companies')
        .select(
          'id, name, industry, employee_count, employee_range, annual_revenue, revenue_range, hq_city, hq_country, founded_year, website, domain, tech_stack, enrichment_data, enriched_at, enrichment_source, propensity, priority_tier, icp_tier, priority_reason, expected_revenue, icp_score, signal_score, engagement_score, contact_coverage_score, velocity_score, win_rate_score',
        )
        .eq('id', accountId)
        .single(),
      supabase
        .from('contacts')
        .select(
          'id, first_name, last_name, title, email, phone, seniority, department, is_champion, is_decision_maker, is_economic_buyer, role_tag, engagement_score, relevance_score, linkedin_url, photo_url',
        )
        .eq('company_id', accountId)
        .order('relevance_score', { ascending: false }),
      supabase
        .from('opportunities')
        .select(
          'id, name, value, stage, stage_order, probability, days_in_stage, is_stalled, stall_reason, next_best_action, expected_close_date, is_closed, is_won',
        )
        .eq('company_id', accountId)
        .order('value', { ascending: false }),
      supabase
        .from('signals')
        .select(
          'id, signal_type, title, description, urgency, relevance_score, weighted_score, recommended_action, detected_at, source',
        )
        .eq('company_id', accountId)
        .order('detected_at', { ascending: false }),
    ])

    const company = companyRes.data
    if (!company) return null

    const subScoreSnapshot = [
      { name: 'icp_fit', label: 'ICP Fit', score: Number(company.icp_score ?? 0), weight: 0.18, weightedScore: Number(company.icp_score ?? 0) * 0.18 },
      { name: 'signal_momentum', label: 'Signal Momentum', score: Number(company.signal_score ?? 0), weight: 0.23, weightedScore: Number(company.signal_score ?? 0) * 0.23 },
      { name: 'engagement_depth', label: 'Engagement', score: Number(company.engagement_score ?? 0), weight: 0.0, weightedScore: 0 },
      { name: 'contact_coverage', label: 'Contact Coverage', score: Number(company.contact_coverage_score ?? 0), weight: 0.23, weightedScore: Number(company.contact_coverage_score ?? 0) * 0.23 },
      { name: 'stage_velocity', label: 'Stage Velocity', score: Number(company.velocity_score ?? 0), weight: 0.18, weightedScore: Number(company.velocity_score ?? 0) * 0.18 },
      { name: 'profile_win_rate', label: 'Profile Win Rate', score: Number(company.win_rate_score ?? 0), weight: 0.18, weightedScore: Number(company.win_rate_score ?? 0) * 0.18 },
    ]

    const contacts = (contactsRes.data ?? []).map((c) => ({
      id: c.id,
      firstName: c.first_name ?? '',
      lastName: c.last_name ?? '',
      name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(),
      title: c.title ?? '',
      email: c.email,
      phone: c.phone,
      seniority: c.seniority,
      department: c.department,
      isChampion: !!c.is_champion,
      isDecisionMaker: !!c.is_decision_maker,
      isEconomicBuyer: !!c.is_economic_buyer,
      roleTag: c.role_tag,
      engagementScore: Number(c.engagement_score ?? 0),
      relevanceScore: Number(c.relevance_score ?? 0),
      linkedinUrl: c.linkedin_url,
      photoUrl: c.photo_url,
    }))

    const opportunities = (oppsRes.data ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      value: o.value != null ? Number(o.value) : null,
      stage: o.stage ?? '',
      stageOrder: o.stage_order ?? 0,
      probability: o.probability,
      daysInStage: o.days_in_stage ?? 0,
      isStalled: !!o.is_stalled,
      stallReason: o.stall_reason,
      nextBestAction: o.next_best_action,
      expectedCloseDate: o.expected_close_date,
      isClosed: !!o.is_closed,
      isWon: !!o.is_won,
    }))

    const dealValue = opportunities
      .filter((o) => !o.isClosed)
      .reduce((s, o) => s + (o.value ?? 0), 0)

    const summary: AccountSummary = {
      id: company.id,
      name: company.name,
      industry: company.industry,
      icp_tier: company.icp_tier,
      priority_tier: company.priority_tier,
      propensity: Number(company.propensity ?? 0),
      expected_revenue: company.expected_revenue != null ? Number(company.expected_revenue) : null,
      hq_city: company.hq_city,
      hq_country: company.hq_country,
      employee_count: company.employee_count,
      sub_scores: subScoreSnapshot,
    }

    return {
      summary,
      isDemo: false,
      rich: {
        company: {
          id: company.id,
          name: company.name,
          industry: company.industry,
          employee_count: company.employee_count,
          employee_range: company.employee_range,
          annual_revenue: company.annual_revenue != null ? Number(company.annual_revenue) : null,
          revenue_range: company.revenue_range,
          hq_city: company.hq_city,
          hq_country: company.hq_country,
          founded_year: company.founded_year,
          website: company.website,
          domain: company.domain,
          tech_stack: Array.isArray(company.tech_stack) ? company.tech_stack as string[] : [],
          enrichment_data: (company.enrichment_data as Record<string, unknown>) ?? {},
          enriched_at: company.enriched_at,
          enrichment_source: company.enrichment_source,
          propensity: summary.propensity,
          priorityTier: company.priority_tier,
          icpTier: company.icp_tier,
          priorityReason: company.priority_reason,
          expectedRevenue: summary.expected_revenue ?? 0,
        },
        subScores: subScoreSnapshot.map(({ name, score }) => ({ name, score })),
        signals: (signalsRes.data ?? []).map((s) => ({
          id: s.id,
          signal_type: s.signal_type,
          title: s.title,
          description: s.description,
          urgency: s.urgency,
          relevance_score: Number(s.relevance_score ?? 0),
          weighted_score: Number(s.weighted_score ?? 0),
          recommended_action: s.recommended_action,
          detected_at: s.detected_at,
          source: s.source,
        })),
        contacts,
        opportunities,
        dealValue: dealValue > 0 ? dealValue : null,
      },
    }
  } catch (err) {
    console.error('[account-detail]', err)
    return null
  }
}

function buildDemoRichAccount(demo: DemoAccount): RichAccount {
  const summary: AccountSummary = { ...demo, sub_scores: demo.sub_scores }
  return {
    summary,
    isDemo: true,
    rich: {
      company: {
        id: demo.id,
        name: demo.name,
        industry: demo.industry,
        employee_count: demo.employee_count,
        employee_range: null,
        annual_revenue: null,
        revenue_range: null,
        hq_city: demo.hq_city,
        hq_country: demo.hq_country,
        founded_year: null,
        website: null,
        domain: null,
        tech_stack: [],
        enrichment_data: {},
        enriched_at: null,
        enrichment_source: null,
        propensity: demo.propensity,
        priorityTier: demo.priority_tier,
        icpTier: demo.icp_tier,
        priorityReason: 'Demo account',
        expectedRevenue: demo.expected_revenue,
      },
      subScores: demo.sub_scores.map((s) => ({ name: s.name, score: s.score })),
      signals: [],
      contacts: [],
      opportunities: [],
      dealValue: null,
    },
  }
}

const tierStyle: Record<string, string> = {
  HOT: 'border-rose-700/60 bg-rose-950/40 text-rose-200',
  WARM: 'border-amber-700/60 bg-amber-950/40 text-amber-200',
  COOL: 'border-sky-700/60 bg-sky-950/40 text-sky-200',
  MONITOR: 'border-zinc-600 bg-zinc-800/80 text-zinc-300',
}

const icpStyle: Record<string, string> = {
  A: 'border-emerald-700/60 bg-emerald-950/50 text-emerald-200',
  B: 'border-teal-700/60 bg-teal-950/50 text-teal-200',
  C: 'border-zinc-600 bg-zinc-800 text-zinc-300',
  D: 'border-zinc-700 bg-zinc-900 text-zinc-400',
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>
}) {
  const { accountId } = await params
  const result = await fetchAccount(accountId)
  if (!result) notFound()

  const { summary: account, rich, isDemo } = result

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/accounts"
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          &larr; Back to Accounts
        </Link>
        <AccountResearchButton accountName={account.name} accountId={account.id} />
      </div>

      <div className="flex flex-col gap-6">
        {/* Quick header and KPIs (kept lean — full account UX is in AccountDetailClient below) */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">{account.name}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {account.industry ?? 'Unknown industry'}
              {account.hq_city ? ` · ${account.hq_city}` : ''}
              {account.employee_count ? ` · ${account.employee_count.toLocaleString()} employees` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${icpStyle[(account.icp_tier ?? 'D').toUpperCase()] ?? icpStyle.D}`}>
              ICP {account.icp_tier ?? '-'}
            </span>
            <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${tierStyle[(account.priority_tier ?? 'MONITOR').toUpperCase()] ?? tierStyle.MONITOR}`}>
              {account.priority_tier ?? 'MONITOR'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Propensity', value: `${account.propensity}`, color: 'text-zinc-100' },
            { label: 'Expected Revenue', value: account.expected_revenue != null ? `£${Math.round(account.expected_revenue / 1000)}K` : '—', color: 'text-emerald-400' },
            { label: 'ICP Tier', value: account.icp_tier ?? '—', color: 'text-teal-400' },
            { label: 'Priority', value: account.priority_tier ?? '—', color: 'text-zinc-200' },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
              <p className="text-xs text-zinc-500">{m.label}</p>
              <p className={`mt-1 text-xl font-bold font-mono tabular-nums ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Rich tabbed UX with SkillBar, score breakdown, OrgChart, CoverageMatrix, AI tools */}
      <div className="mt-8">
        <AccountDetailClient data={rich} initialTab="overview" isDemo={isDemo} />
      </div>
    </div>
  )
}
