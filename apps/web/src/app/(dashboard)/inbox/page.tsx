import { redirect } from 'next/navigation'
import { QueueHeader, type PipelineStage } from '@/components/priority/queue-header'
import { InboxList } from '@/components/priority/inbox-list'
import { WeeklyPulse } from '@/components/priority/weekly-pulse'
import { isDemoTenantSlug } from '@/lib/demo-tenant'

interface SubScore {
  name: string
  score: number
  weight: number
  weightedScore: number
  tier: string
}

interface PriorityItem {
  accountName: string
  accountId: string
  dealValue: number | null
  expectedRevenue: number
  triggerType: 'stall' | 'signal' | 'prospect' | 'pipeline'
  triggerDetail: string
  nextAction: string
  contactName: string | null
  contactPhone: string | null
  severity: 'critical' | 'high' | 'medium' | 'low'
  priorityTier: string | null
  propensity: number | null
  icpTier: string | null
  priorityReason: string | null
  subScores?: SubScore[]
  signalCount?: number
  topSignal?: string | null
}

const DEMO_ITEMS: PriorityItem[] = [
  {
    accountName: 'Acme Logistics',
    accountId: 'demo-001',
    dealValue: 800_000,
    expectedRevenue: 200_000,
    triggerType: 'stall',
    triggerDetail:
      'Deal "Q2 Temp Staffing" at Proposal for 22 days. Sarah Chen opened your last email 3 times but hasn\'t replied.',
    nextAction: 'Call Sarah Chen (VP Ops) — re-engage on proposal timeline',
    contactName: 'Sarah Chen',
    contactPhone: '+44 7700 900123',
    severity: 'critical',
    priorityTier: 'HOT',
    propensity: 87,
    icpTier: 'A',
    priorityReason: 'ICP fit (Tier A: logistics, 2000 employees) + stalled deal at Proposal',
    subScores: [
      { name: 'ICP Fit', score: 92, weight: 0.15, weightedScore: 13.8, tier: 'Logistics, Enterprise' },
      { name: 'Signal', score: 78, weight: 0.20, weightedScore: 15.6, tier: 'Hiring surge' },
      { name: 'Engagement', score: 65, weight: 0.15, weightedScore: 9.8, tier: '2 meetings' },
      { name: 'Contacts', score: 85, weight: 0.20, weightedScore: 17.0, tier: 'Champion ID' },
      { name: 'Velocity', score: 40, weight: 0.15, weightedScore: 6.0, tier: '22d (avg 14)' },
      { name: 'Win Rate', score: 72, weight: 0.15, weightedScore: 10.8, tier: '68% similar' },
    ],
    signalCount: 3,
    topSignal: 'Peak season hiring surge — 45 warehouse roles',
  },
  {
    accountName: 'Beta Warehousing',
    accountId: 'demo-002',
    dealValue: 200_000,
    expectedRevenue: 160_000,
    triggerType: 'signal',
    triggerDetail:
      'Hiring Surge: 8 temp warehouse roles posted in Manchester. This is leverage for your next conversation.',
    nextAction:
      'Email James Miller (Dir. Facilities) — reference their hiring push',
    contactName: 'James Miller',
    contactPhone: '+44 7700 900456',
    severity: 'high',
    priorityTier: 'HOT',
    propensity: 79,
    icpTier: 'A',
    priorityReason: 'Fresh hiring surge signal + strong ICP fit',
    subScores: [
      { name: 'ICP Fit', score: 88, weight: 0.15, weightedScore: 13.2, tier: 'Warehousing' },
      { name: 'Signal', score: 85, weight: 0.20, weightedScore: 17.0, tier: 'Hiring surge' },
      { name: 'Engagement', score: 72, weight: 0.15, weightedScore: 10.8, tier: 'Email opened 3x' },
      { name: 'Contacts', score: 60, weight: 0.20, weightedScore: 12.0, tier: 'Developing' },
      { name: 'Velocity', score: 70, weight: 0.15, weightedScore: 10.5, tier: 'On pace' },
      { name: 'Win Rate', score: 65, weight: 0.15, weightedScore: 9.8, tier: '60% similar' },
    ],
    signalCount: 1,
    topSignal: '8 temp warehouse roles posted in Manchester',
  },
  {
    accountName: 'Gamma Manufacturing',
    accountId: 'demo-003',
    dealValue: null,
    expectedRevenue: 63_000,
    triggerType: 'prospect',
    triggerDetail:
      'Tier A ICP fit — 1,400 employees in Light Industrial with 3 locations in your territory.',
    nextAction: 'Send intro email to VP Operations',
    contactName: null,
    contactPhone: null,
    severity: 'medium',
    priorityTier: 'WARM',
    propensity: 63,
    icpTier: 'A',
    priorityReason: 'Strong ICP fit, no active deal — prospecting opportunity',
    subScores: [
      { name: 'ICP Fit', score: 90, weight: 0.15, weightedScore: 13.5, tier: 'Light Industrial' },
      { name: 'Signal', score: 45, weight: 0.20, weightedScore: 9.0, tier: 'No recent' },
      { name: 'Engagement', score: 30, weight: 0.15, weightedScore: 4.5, tier: 'No activity' },
      { name: 'Contacts', score: 15, weight: 0.20, weightedScore: 3.0, tier: 'Single-threaded' },
      { name: 'Velocity', score: 0, weight: 0.15, weightedScore: 0, tier: 'No deal' },
      { name: 'Win Rate', score: 55, weight: 0.15, weightedScore: 8.3, tier: 'Average' },
    ],
    signalCount: 0,
    topSignal: null,
  },
]

async function fetchRealData(): Promise<{
  items: PriorityItem[]
  repName: string
} | null> {
  try {
    const { createSupabaseServer } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id, full_name, rep_profile_id')
      .eq('id', user.id)
      .single()
    if (!profile?.tenant_id) return null

    const { count: companyCount, error: companyCountErr } = await supabase
      .from('companies')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', profile.tenant_id)

    if (!companyCountErr && (companyCount ?? 0) === 0) {
      const { data: tenant, error: tenantErr } = await supabase
        .from('tenants')
        .select('slug')
        .eq('id', profile.tenant_id)
        .maybeSingle()

      if (!tenantErr && tenant && !isDemoTenantSlug(tenant.slug)) {
        redirect('/onboarding')
      }
    }

    if (!profile?.rep_profile_id) return null

    const { data: repProfile } = await supabase
      .from('rep_profiles')
      .select('crm_id')
      .eq('id', profile.rep_profile_id)
      .single()
    const repCrmId = repProfile?.crm_id
    if (!repCrmId) return null

    const [companiesRes, signalsRes, stalledRes, contactsRes] =
      await Promise.all([
        supabase
          .from('companies')
          .select('id, name, expected_revenue, propensity, priority_tier, priority_reason, icp_tier')
          .eq('tenant_id', profile.tenant_id)
          .eq('owner_crm_id', repCrmId)
          .in('priority_tier', ['HOT', 'WARM'])
          .order('expected_revenue', { ascending: false })
          .limit(10),
        supabase
          .from('signals')
          .select('company_id, signal_type, title, urgency')
          .eq('tenant_id', profile.tenant_id)
          .gte('detected_at', new Date(Date.now() - 14 * 86400000).toISOString())
          .order('weighted_score', { ascending: false })
          .limit(20),
        supabase
          .from('opportunities')
          .select('company_id, name, stage, value, days_in_stage, is_stalled, stall_reason')
          .eq('tenant_id', profile.tenant_id)
          .eq('owner_crm_id', repCrmId)
          .eq('is_stalled', true)
          .eq('is_closed', false),
        supabase
          .from('contacts')
          .select('company_id, first_name, last_name, title, phone, is_decision_maker, relevance_score')
          .eq('tenant_id', profile.tenant_id)
          .eq('is_decision_maker', true)
          .order('relevance_score', { ascending: false }),
      ])

    const companies = companiesRes.data ?? []
    if (companies.length === 0) return null

    const signals = signalsRes.data ?? []
    const stalls = stalledRes.data ?? []
    const contacts = contactsRes.data ?? []

    const contactMap = new Map<string, (typeof contacts)[0]>()
    for (const c of contacts) {
      if (!contactMap.has(c.company_id)) contactMap.set(c.company_id, c)
    }
    const signalMap = new Map<string, (typeof signals)[0]>()
    for (const s of signals) {
      if (!signalMap.has(s.company_id)) signalMap.set(s.company_id, s)
    }
    const stallMap = new Map<string, (typeof stalls)[0]>()
    for (const d of stalls) {
      if (!stallMap.has(d.company_id)) stallMap.set(d.company_id, d)
    }

    const items: PriorityItem[] = companies.slice(0, 3).map((c) => {
      const stall = stallMap.get(c.id)
      const signal = signalMap.get(c.id)
      const contact = contactMap.get(c.id)
      const contactName = contact ? `${contact.first_name} ${contact.last_name}` : null

      let triggerType: PriorityItem['triggerType'] = 'pipeline'
      let triggerDetail = c.priority_reason ?? 'High priority account'
      let severity: PriorityItem['severity'] = 'medium'
      let nextAction = `Review ${c.name} and identify next steps`

      if (stall) {
        triggerType = 'stall'
        severity = 'critical'
        triggerDetail = `Deal "${stall.name}" at ${stall.stage} for ${stall.days_in_stage} days. ${stall.stall_reason ?? 'No recent activity.'}`
        nextAction = `Re-engage on stalled deal "${stall.name}"`
      } else if (signal?.urgency === 'immediate') {
        triggerType = 'signal'
        severity = 'high'
        triggerDetail = `${signal.signal_type.replace(/_/g, ' ')}: ${signal.title}`
        nextAction = `Act on ${signal.signal_type.replace(/_/g, ' ')} signal`
      } else if (!stall && !signal) {
        triggerType = 'prospect'
        triggerDetail = `Tier ${c.icp_tier} ICP fit. ${c.priority_reason ?? ''}`
        nextAction = `Research ${c.name} and send intro outreach`
      }

      if (contactName) {
        nextAction += ` — contact ${contactName} (${contact!.title ?? 'Decision Maker'})`
      }

      return {
        accountName: c.name,
        accountId: c.id,
        dealValue: stall?.value ?? null,
        expectedRevenue: c.expected_revenue,
        triggerType,
        triggerDetail,
        nextAction,
        contactName,
        contactPhone: contact?.phone ?? null,
        severity,
        priorityTier: c.priority_tier,
        propensity: c.propensity,
        icpTier: c.icp_tier,
        priorityReason: c.priority_reason,
      }
    })

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const { data: completedToday } = await supabase
      .from('alert_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', profile.tenant_id)
      .eq('rep_crm_id', repCrmId)
      .eq('action_taken', true)
      .gte('created_at', todayStart.toISOString())

    const completedTodayCount = completedToday ?? 0

    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0]
    const { data: adoptionRows } = await supabase
      .from('adoption_metrics')
      .select('date')
      .eq('tenant_id', profile.tenant_id)
      .eq('rep_crm_id', repCrmId)
      .gte('date', fourteenDaysAgo)

    const activeDays = adoptionRows?.length ?? 0
    const isMonday = new Date().getDay() === 1
    const showWeeklyPulse = activeDays >= 10 && isMonday

    const topAccountForPulse = items[0] ?? null

    const dayOfWeek = new Date().getDay()
    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - ((dayOfWeek + 6) % 7))
    const weekStartStr = weekStart.toISOString().split('T')[0]

    const { data: existingPulse } = await supabase
      .from('weekly_pulse_responses')
      .select('id')
      .eq('tenant_id', profile.tenant_id)
      .eq('rep_crm_id', repCrmId)
      .eq('week_start', weekStartStr)
      .maybeSingle()

    const pulseAlreadySubmitted = !!existingPulse

    return {
      items,
      repName: profile.full_name,
      completedTodayCount: typeof completedTodayCount === 'number' ? completedTodayCount : 0,
      showWeeklyPulse: showWeeklyPulse && !pulseAlreadySubmitted,
      topAccountForPulse,
    }
  } catch {
    return null
  }
}

export default async function InboxPage() {
  const realData = await fetchRealData()
  const useDemoData = !realData || realData.items.length === 0
  const displayItems = useDemoData ? DEMO_ITEMS : realData!.items
  const repName = realData?.repName ?? 'there'
  const completedTodayCount = realData?.completedTodayCount ?? 0
  const showWeeklyPulse = realData?.showWeeklyPulse ?? false
  const topAccountForPulse = realData?.topAccountForPulse ?? null

  const demoPipelineStages: PipelineStage[] = [
    { name: 'Lead', count: 12, value: 280_000, stallCount: 0 },
    { name: 'Qualified', count: 8, value: 340_000, stallCount: 0 },
    { name: 'Proposal', count: 4, value: 180_000, stallCount: 2 },
    { name: 'Negotiation', count: 2, value: 90_000, stallCount: 0 },
    { name: 'Won', count: 1, value: 45_000, stallCount: 0 },
  ]
  const totalPipelineValue = demoPipelineStages.reduce((s, st) => s + st.value, 0)

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <QueueHeader
        repName={repName}
        actionCount={displayItems.length}
        pipelineStages={demoPipelineStages}
        totalPipelineValue={totalPipelineValue}
        targetValue={1_200_000}
      />

      {showWeeklyPulse && topAccountForPulse && (
        <div className="mt-4">
          <WeeklyPulse
            topAccountName={topAccountForPulse.accountName}
            topAccountId={topAccountForPulse.accountId}
          />
        </div>
      )}

      {useDemoData && (
        <div className="mt-4 rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
          <p className="text-sm text-amber-300/80">
            Showing demo data. Connect your CRM to see your real priorities.
          </p>
        </div>
      )}

      <div className="mt-6">
        <InboxList items={displayItems} completedTodayCount={completedTodayCount} />
      </div>

      {!useDemoData && displayItems.length > 0 && (
        <p className="mt-8 text-center text-sm text-zinc-600">
          That&apos;s everything for today.
        </p>
      )}
    </div>
  )
}
