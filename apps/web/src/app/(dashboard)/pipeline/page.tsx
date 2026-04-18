import { createSupabaseServer } from '@/lib/supabase/server'
import { PipelineClient } from '@/components/pipeline/pipeline-client'
import type { StageMetric } from '@/components/pipeline/pipeline-funnel-chart'

export const metadata = {
  title: 'Pipeline',
  description: 'Live funnel volume and stall detection across every active deal.',
}

const STAGE_ORDER = ['Lead', 'Qualified', 'Proposal', 'Negotiation']

function normalizePipelineStage(raw: string | null): string {
  if (!raw) return 'Lead'
  const s = raw.trim().toLowerCase()
  if (s.includes('negotiat') || s.includes('verbal') || s.includes('contract')) return 'Negotiation'
  if (s.includes('proposal') || s.includes('quote') || s.includes('pricing')) return 'Proposal'
  if (s.includes('qualif') || s.includes('discovery') || s.includes('needs analysis')) return 'Qualified'
  return 'Lead'
}

function stageSortKey(name: string): number {
  const i = STAGE_ORDER.indexOf(name)
  return i === -1 ? 999 : i
}

function computeStatus(delta: number, stallCount: number): StageMetric['status'] {
  if (stallCount >= 2 || delta <= -4) return 'CRITICAL'
  if (delta < 0 || stallCount > 0) return 'MONITOR'
  if (delta >= 4) return 'OPPORTUNITY'
  return 'HEALTHY'
}

interface DealRow {
  id: string
  name: string
  companyName: string | null
  companyId: string | null
  companyPropensity: number
  companyIcpTier: string | null
  value: number | null
  stage: string
  daysInStage: number
  isStalled: boolean
  stallReason: string | null
  contactName: string | null
}

const DEMO_DEALS: DealRow[] = [
  { id: 'demo-p1', name: 'Q2 Temp Staffing', companyName: 'Acme Logistics', companyId: 'demo-001', companyPropensity: 87, companyIcpTier: 'A', value: 800_000, stage: 'Proposal', daysInStage: 22, isStalled: true, stallReason: 'No contact activity in 14 days', contactName: 'Sarah Chen' },
  { id: 'demo-p2', name: 'Warehouse coverage FY25', companyName: 'Beta Warehousing', companyId: 'demo-002', companyPropensity: 79, companyIcpTier: 'A', value: 200_000, stage: 'Negotiation', daysInStage: 6, isStalled: false, stallReason: null, contactName: 'James Miller' },
  { id: 'demo-p3', name: 'National rollout — Phase 1', companyName: 'Gamma Manufacturing', companyId: 'demo-003', companyPropensity: 63, companyIcpTier: 'A', value: 450_000, stage: 'Qualified', daysInStage: 11, isStalled: false, stallReason: null, contactName: null },
  { id: 'demo-p4', name: 'Pilot — Manchester hub', companyName: 'Delta Distribution', companyId: null, companyPropensity: 45, companyIcpTier: 'B', value: 95_000, stage: 'Lead', daysInStage: 4, isStalled: false, stallReason: null, contactName: null },
  { id: 'demo-p5', name: 'Seasonal surge staffing', companyName: 'Echo Foods Ltd', companyId: null, companyPropensity: 55, companyIcpTier: 'B', value: 120_000, stage: 'Proposal', daysInStage: 18, isStalled: true, stallReason: 'Waiting on budget approval', contactName: null },
  { id: 'demo-p6', name: 'Driver pool setup', companyName: 'Foxtrot Transport', companyId: null, companyPropensity: 42, companyIcpTier: 'B', value: 180_000, stage: 'Lead', daysInStage: 7, isStalled: false, stallReason: null, contactName: null },
]

const DEMO_STAGE_METRICS: StageMetric[] = [
  { stage: 'Lead', repConversion: 68, benchmarkConversion: 62, delta: 6, dealCount: 2, totalValue: 275_000, stallCount: 0, dropRate: 32, status: 'OPPORTUNITY' },
  { stage: 'Qualified', repConversion: 54, benchmarkConversion: 58, delta: -4, dealCount: 1, totalValue: 450_000, stallCount: 0, dropRate: 46, status: 'CRITICAL' },
  { stage: 'Proposal', repConversion: 41, benchmarkConversion: 44, delta: -3, dealCount: 2, totalValue: 920_000, stallCount: 2, dropRate: 59, status: 'CRITICAL' },
  { stage: 'Negotiation', repConversion: 78, benchmarkConversion: 72, delta: 6, dealCount: 1, totalValue: 200_000, stallCount: 0, dropRate: 22, status: 'OPPORTUNITY' },
]

async function fetchMergedPipelineData(): Promise<{
  deals: DealRow[]
  stageMetrics: StageMetric[]
  kpis: { totalPipeline: number; dealCount: number; stallCount: number; winRate: string; avgCycleDays: number; weightedRevenue: number }
} | null> {
  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id, rep_profile_id')
      .eq('id', user.id)
      .single()
    if (!profile?.rep_profile_id) return null

    const { data: repProfile } = await supabase
      .from('rep_profiles')
      .select('crm_id, kpi_win_rate')
      .eq('id', profile.rep_profile_id)
      .single()
    const repCrmId = repProfile?.crm_id
    if (!repCrmId) return null

    const tenantId = profile.tenant_id

    const [oppsRes, benchRepRes, benchCompanyRes] = await Promise.all([
      supabase
        .from('opportunities')
        .select(`
          id, name, value, stage, days_in_stage, is_stalled, stall_reason,
          company_id, is_closed, is_won, probability,
          companies ( name, propensity, icp_tier )
        `)
        .eq('tenant_id', tenantId)
        .eq('owner_crm_id', repCrmId)
        .order('value', { ascending: false }),
      supabase
        .from('funnel_benchmarks')
        .select('stage_name, period, conversion_rate, drop_rate, deal_count, total_value')
        .eq('tenant_id', tenantId)
        .eq('scope', 'rep')
        .eq('scope_id', repCrmId),
      supabase
        .from('funnel_benchmarks')
        .select('stage_name, period, conversion_rate, drop_rate, deal_count, total_value')
        .eq('tenant_id', tenantId)
        .eq('scope', 'company')
        .eq('scope_id', 'all'),
    ])

    const allOpps = oppsRes.data ?? []
    if (allOpps.length === 0) return null

    const openOpps = allOpps.filter((o) => !o.is_closed)
    const closedOpps = allOpps.filter((o) => o.is_closed)
    const wonCount = closedOpps.filter((o) => o.is_won).length
    const lostCount = closedOpps.filter((o) => !o.is_won).length
    const winRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0
    const kpiWin = repProfile?.kpi_win_rate != null ? Number(repProfile.kpi_win_rate) : null
    const winRateDisplay = kpiWin != null && !Number.isNaN(kpiWin) ? `${Math.round(kpiWin)}%` : `${winRate}%`

    const contacts = await supabase
      .from('contacts')
      .select('company_id, first_name, last_name, is_decision_maker, relevance_score')
      .eq('tenant_id', tenantId)
      .eq('is_decision_maker', true)
      .order('relevance_score', { ascending: false })

    const contactMap = new Map<string, string>()
    for (const c of contacts.data ?? []) {
      if (!contactMap.has(c.company_id)) {
        contactMap.set(c.company_id, `${c.first_name} ${c.last_name}`)
      }
    }

    const deals: DealRow[] = openOpps.map((o) => {
      const embedded = o.companies as { name: string; propensity?: number; icp_tier?: string } | { name: string; propensity?: number; icp_tier?: string }[] | null
      const company = Array.isArray(embedded) ? embedded[0] : embedded
      return {
        id: o.id,
        name: o.name,
        companyName: company?.name ?? null,
        companyId: o.company_id,
        companyPropensity: Number(company?.propensity ?? 0),
        companyIcpTier: company?.icp_tier ?? null,
        value: o.value != null ? Number(o.value) : null,
        stage: normalizePipelineStage(o.stage),
        daysInStage: o.days_in_stage ?? 0,
        isStalled: Boolean(o.is_stalled),
        stallReason: o.stall_reason ?? null,
        contactName: o.company_id ? contactMap.get(o.company_id) ?? null : null,
      }
    })

    const repRows = benchRepRes.data ?? []
    const companyRows = benchCompanyRes.data ?? []
    const repPeriods = [...new Set(repRows.map((r) => r.period))].sort((a, b) => b.localeCompare(a))
    const period = repPeriods[0]

    let stageMetrics: StageMetric[]

    if (period && repRows.filter((r) => r.period === period).length > 0) {
      const repForPeriod = repRows.filter((r) => r.period === period)
      let companyForPeriod = companyRows.filter((r) => r.period === period)
      if (companyForPeriod.length === 0) {
        const cp = [...new Set(companyRows.map((r) => r.period))].sort((a, b) => b.localeCompare(a))
        if (cp[0]) companyForPeriod = companyRows.filter((r) => r.period === cp[0])
      }
      const companyByStage = new Map(companyForPeriod.map((r) => [r.stage_name, r]))

      stageMetrics = repForPeriod
        .sort((a, b) => stageSortKey(a.stage_name) - stageSortKey(b.stage_name))
        .map((rep) => {
          const co = companyByStage.get(rep.stage_name)
          const repConv = Math.round(Number(rep.conversion_rate ?? 0))
          const benchConv = Math.round(Number(co?.conversion_rate ?? rep.conversion_rate ?? 0))
          const delta = repConv - benchConv
          const dropRate = Number(rep.drop_rate ?? 0)
          const stageDeals = deals.filter((d) => d.stage === rep.stage_name)
          const stallCount = stageDeals.filter((d) => d.isStalled).length
          return {
            stage: rep.stage_name,
            repConversion: repConv,
            benchmarkConversion: benchConv,
            delta,
            dealCount: stageDeals.length,
            totalValue: stageDeals.reduce((s, d) => s + (d.value ?? 0), 0),
            stallCount,
            dropRate,
            status: computeStatus(delta, stallCount),
          }
        })
    } else {
      stageMetrics = STAGE_ORDER.map((stage) => {
        const stageDeals = deals.filter((d) => d.stage === stage)
        const stallCount = stageDeals.filter((d) => d.isStalled).length
        return {
          stage,
          repConversion: 0,
          benchmarkConversion: 0,
          delta: 0,
          dealCount: stageDeals.length,
          totalValue: stageDeals.reduce((s, d) => s + (d.value ?? 0), 0),
          stallCount,
          dropRate: 0,
          status: computeStatus(0, stallCount),
        }
      })
    }

    const totalPipeline = openOpps.reduce((s, o) => s + Number(o.value ?? 0), 0)
    const stallCount = openOpps.filter((o) => o.is_stalled).length
    const totalDays = openOpps.reduce((s, o) => s + (o.days_in_stage ?? 0), 0)
    const avgCycleDays = openOpps.length > 0 ? Math.round(totalDays / openOpps.length) : 0
    const weightedRevenue = openOpps.reduce((s, o) => s + Number(o.value ?? 0) * (Number(o.probability ?? 50) / 100), 0)

    return {
      deals,
      stageMetrics,
      kpis: {
        totalPipeline,
        dealCount: openOpps.length,
        stallCount,
        winRate: winRateDisplay,
        avgCycleDays,
        weightedRevenue: Math.round(weightedRevenue),
      },
    }
  } catch (e) {
    console.error('[pipeline]', e)
    return null
  }
}

export default async function PipelinePage() {
  const data = await fetchMergedPipelineData()
  const isDemo = !data

  const deals = data?.deals ?? DEMO_DEALS
  const stageMetrics = data?.stageMetrics ?? DEMO_STAGE_METRICS
  const kpis = data?.kpis ?? {
    totalPipeline: DEMO_DEALS.reduce((s, d) => s + (d.value ?? 0), 0),
    dealCount: DEMO_DEALS.length,
    stallCount: DEMO_DEALS.filter((d) => d.isStalled).length,
    winRate: '24%',
    avgCycleDays: 14,
    weightedRevenue: 420_000,
  }

  return <PipelineClient deals={deals} stageMetrics={stageMetrics} kpis={kpis} isDemo={isDemo} />
}
