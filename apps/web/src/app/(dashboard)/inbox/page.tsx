import Link from 'next/link'
import { redirect } from 'next/navigation'
import { urn } from '@prospector/core'
import { QueueHeader, type PipelineStage } from '@/components/priority/queue-header'
import { InboxList } from '@/components/priority/inbox-list'
import { WeeklyPulse } from '@/components/priority/weekly-pulse'
import { InboxDashboard } from '@/components/priority/inbox-dashboard'
import { NextStepCard } from '@/components/agent/next-step-card'
import { INBOX_SKILLS } from '@/lib/agent/skills'
import { isDemoTenantSlug } from '@/lib/demo-tenant'
import { WelcomeBanner } from '@/components/welcome/welcome-banner'

export const metadata = {
  title: 'Inbox',
  description: "Today's prioritised accounts, signals, and stalled deals.",
}

interface SubScore {
  name: string
  score: number
  weight: number
  weightedScore: number
  tier: string
}

interface PriorityItem {
  accountName: string
  accountUrn: string
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
    accountUrn: 'urn:rev:demo:company:demo-001',
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
    accountUrn: 'urn:rev:demo:company:demo-002',
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
    accountUrn: 'urn:rev:demo:company:demo-003',
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

interface RealInboxData {
  items: PriorityItem[]
  repName: string
  isDemoTenant: boolean
  hasCrmConnection: boolean
  completedTodayCount?: number
  showWeeklyPulse?: boolean
  topAccountForPulse?: PriorityItem | null
  pipelineStages?: PipelineStage[]
  totalPipelineValue?: number
}

async function fetchRealData(): Promise<RealInboxData | null> {
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

    const { data: tenant } = await supabase
      .from('tenants')
      .select('slug')
      .eq('id', profile.tenant_id)
      .maybeSingle()
    const isDemoTenant = isDemoTenantSlug(tenant?.slug)

    const { count: companyCount, error: companyCountErr } = await supabase
      .from('companies')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', profile.tenant_id)

    const hasCrmConnection = !companyCountErr && (companyCount ?? 0) > 0

    if (!hasCrmConnection && !isDemoTenant) {
      redirect('/onboarding')
    }

    if (!profile?.rep_profile_id) {
      return {
        items: [],
        repName: profile.full_name ?? 'there',
        isDemoTenant,
        hasCrmConnection,
      }
    }

    const { data: repProfile } = await supabase
      .from('rep_profiles')
      .select('crm_id')
      .eq('id', profile.rep_profile_id)
      .single()
    const repCrmId = repProfile?.crm_id
    if (!repCrmId) {
      return {
        items: [],
        repName: profile.full_name ?? 'there',
        isDemoTenant,
        hasCrmConnection,
      }
    }

    const [companiesRes, signalsRes, stalledRes, contactsRes, allOppsRes] =
      await Promise.all([
        supabase
          .from('companies')
          .select('id, name, expected_revenue, propensity, urgency_multiplier, priority_tier, priority_reason, icp_tier, icp_score, signal_score, engagement_score, contact_coverage_score, velocity_score, win_rate_score, last_scored_at')
          .eq('tenant_id', profile.tenant_id)
          .eq('owner_crm_id', repCrmId)
          .in('priority_tier', ['HOT', 'WARM'])
          // Pull a generous candidate set ordered by raw expected revenue,
          // then re-rank in JS by composite priority (`expected_revenue ×
          // urgency_multiplier`) before slicing. Previously the inbox
          // ordered by `expected_revenue` alone — a $50K deal with a 1.5×
          // urgency multiplier (immediate signal + close date near)
          // sorted BELOW a $200K cold deal. The composite is what
          // matches `expected-revenue.ts#priority_score` and what the
          // agent's `priority_queue` reasons about, so the inbox should
          // agree.
          //
          // We fetch 30 (instead of 10) so the JS re-rank has enough
          // signal to surface the right top-3, then keep 10 to feed
          // downstream slicing.
          .order('expected_revenue', { ascending: false, nullsFirst: false })
          .limit(30),
        supabase
          .from('signals')
          .select(
            'company_id, signal_type, title, urgency, recommended_action',
          )
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
          .eq('is_closed', false)
          // Top-N gate from the mission's signal-over-noise rule —
          // the inbox only renders 3 stalled deals; everything else
          // bundles into the next digest. Hard cap by deal value
          // protects memory and latency for reps with neglected books.
          .order('value', { ascending: false, nullsFirst: false })
          .limit(50),
        supabase
          .from('contacts')
          .select('company_id, first_name, last_name, title, phone, is_decision_maker, relevance_score')
          .eq('tenant_id', profile.tenant_id)
          .eq('is_decision_maker', true)
          // Without a per-rep scope this query previously fanned out to
          // every decision-maker in the tenant. The downstream client
          // filters to companies in `companies` (rep's own book), so we
          // cap absolute volume here and rely on relevance ordering to
          // keep the right rows in the slice.
          .order('relevance_score', { ascending: false })
          .limit(200),
        supabase
          .from('opportunities')
          .select('stage, value, is_stalled')
          .eq('tenant_id', profile.tenant_id)
          .eq('owner_crm_id', repCrmId)
          .eq('is_closed', false),
      ])

    // Re-rank by composite priority score: expected_revenue × urgency_multiplier.
    // Urgency-driven (immediate signal, close date near) deals push past
    // pure-revenue rivals, matching what the agent's priority_queue tool
    // sees and what `expected-revenue.ts#priority_score` computes. Then
    // trim back to 10 so downstream slicing (UI shows top 3) is consistent.
    const companies = (companiesRes.data ?? [])
      .map((c) => ({
        ...c,
        _priority: (c.expected_revenue ?? 0) * (c.urgency_multiplier ?? 1),
      }))
      .sort((a, b) => b._priority - a._priority)
      .slice(0, 10)
    if (companies.length === 0) {
      return {
        items: [],
        repName: profile.full_name ?? 'there',
        isDemoTenant,
        hasCrmConnection,
      }
    }

    const signals = signalsRes.data ?? []
    const stalls = stalledRes.data ?? []
    const contacts = contactsRes.data ?? []
    const allOpps = allOppsRes.data ?? []

    const stageAgg = new Map<string, { count: number; value: number; stallCount: number }>()
    for (const o of allOpps) {
      const stage = o.stage ?? 'Unknown'
      const curr = stageAgg.get(stage) ?? { count: 0, value: 0, stallCount: 0 }
      curr.count += 1
      curr.value += o.value != null ? Number(o.value) : 0
      if (o.is_stalled) curr.stallCount += 1
      stageAgg.set(stage, curr)
    }
    const pipelineStages = ['Lead', 'Qualified', 'Proposal', 'Negotiation'].map((name) => {
      const found = Array.from(stageAgg.entries()).find(([k]) =>
        k.toLowerCase().includes(name.toLowerCase())
      )
      return {
        name,
        count: found?.[1].count ?? 0,
        value: found?.[1].value ?? 0,
        stallCount: found?.[1].stallCount ?? 0,
      }
    })
    const totalPipelineValue = pipelineStages.reduce((s, st) => s + st.value, 0)

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
        // Prefer the LLM-generated `recommended_action` (populated by
        // cron/signals deep-research) over the generic
        // "Act on hiring_surge signal". The deep-research prompt asks
        // for "Specific action for the sales rep" — so when present,
        // it's the targeted, contextual line we want the rep to see
        // (e.g. "Email Sarah Chen, VP Eng, re: their Series B").
        // Pre-this-change the column was populated but never read by the
        // inbox, so the targeted text was discarded for a generic one.
        nextAction =
          signal.recommended_action?.trim() ||
          `Act on ${signal.signal_type.replace(/_/g, ' ')} signal`
      } else if (!stall && !signal) {
        triggerType = 'prospect'
        triggerDetail = `Tier ${c.icp_tier} ICP fit. ${c.priority_reason ?? ''}`
        nextAction = `Research ${c.name} and send intro outreach`
      }

      // Append contact context only when the line doesn't already
      // mention a person — avoids "Email Sarah ... — contact Sarah Chen".
      if (contactName && !nextAction.toLowerCase().includes(contactName.toLowerCase())) {
        nextAction += ` — contact ${contactName} (${contact!.title ?? 'Decision Maker'})`
      }

      const liveSubScores: SubScore[] = [
        { name: 'ICP Fit', score: c.icp_score ?? 0, weight: 0.15, weightedScore: (c.icp_score ?? 0) * 0.15, tier: '' },
        { name: 'Signal', score: c.signal_score ?? 0, weight: 0.20, weightedScore: (c.signal_score ?? 0) * 0.20, tier: signal?.title ?? '' },
        { name: 'Engagement', score: c.engagement_score ?? 0, weight: 0.15, weightedScore: (c.engagement_score ?? 0) * 0.15, tier: '' },
        { name: 'Contacts', score: c.contact_coverage_score ?? 0, weight: 0.20, weightedScore: (c.contact_coverage_score ?? 0) * 0.20, tier: '' },
        { name: 'Velocity', score: c.velocity_score ?? 0, weight: 0.15, weightedScore: (c.velocity_score ?? 0) * 0.15, tier: '' },
        { name: 'Win Rate', score: c.win_rate_score ?? 0, weight: 0.15, weightedScore: (c.win_rate_score ?? 0) * 0.15, tier: '' },
      ]

      return {
        accountName: c.name,
        accountId: c.id,
        // Pre-resolved URN so the inbox draft button can pass it in the
        // `prospector:open-chat` event detail. Without `activeUrn` the
        // chat agent has no way to know which company it's drafting
        // for — it had to re-derive from the prompt text, missing
        // signals, contacts, and tier context that the company-anchored
        // context-pack slices would have hydrated.
        accountUrn: urn.company(profile.tenant_id, c.id),
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
        subScores: liveSubScores,
        signalCount: signals.filter(s => s.company_id === c.id).length,
        topSignal: signal?.title ?? null,
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
      isDemoTenant,
      hasCrmConnection,
      completedTodayCount: typeof completedTodayCount === 'number' ? completedTodayCount : 0,
      showWeeklyPulse: showWeeklyPulse && !pulseAlreadySubmitted,
      topAccountForPulse,
      pipelineStages,
      totalPipelineValue,
    }
  } catch {
    return null
  }
}

/**
 * MISSION §9.8 — "No demo data in production analytics. Empty states beat
 * fake numbers." Demo data is only allowed for tenants explicitly flagged
 * as demo (slug in NEXT_PUBLIC_DEMO_TENANT_SLUGS or `demo`/`sandbox`).
 * Real tenants with no priorities see an honest empty state pointing
 * them at the next step (onboarding or the ontology browser).
 */
function EmptyInbox({
  repName,
  hasCrmConnection,
}: {
  repName: string
  hasCrmConnection: boolean
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
        No priorities for you yet, {repName}
      </h1>
      <p className="mt-2 text-sm text-zinc-400">
        {hasCrmConnection
          ? "Once your CRM has accounts assigned to you, ranked priorities will appear here. The nightly scoring run picks them up."
          : "Connect your CRM to start surfacing the accounts and deals that need your attention today."}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        {hasCrmConnection ? (
          <Link
            href="/objects/companies"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-800"
          >
            Browse companies
          </Link>
        ) : (
          <Link
            href="/onboarding"
            className="rounded-md border border-sky-700 bg-sky-900/40 px-4 py-2 text-sm text-sky-100 hover:bg-sky-900/60"
          >
            Connect your CRM
          </Link>
        )}
        <Link
          href="/admin/roi"
          className="rounded-md border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
        >
          See adoption + ROI
        </Link>
      </div>
    </div>
  )
}

export default async function InboxPage() {
  const realData = await fetchRealData()

  if (!realData) {
    return <EmptyInbox repName="there" hasCrmConnection={false} />
  }

  // MISSION §9.8 — demo data only for explicitly flagged demo tenants.
  // Real tenants get an honest empty state, not fabricated priorities.
  const isDemoTenantWithoutData = realData.isDemoTenant && realData.items.length === 0
  const useDemoData = isDemoTenantWithoutData

  if (!useDemoData && realData.items.length === 0) {
    return (
      <EmptyInbox
        repName={realData.repName}
        hasCrmConnection={realData.hasCrmConnection}
      />
    )
  }

  const displayItems = useDemoData ? DEMO_ITEMS : realData.items
  const repName = realData.repName
  const completedTodayCount = realData.completedTodayCount ?? 0
  const showWeeklyPulse = realData.showWeeklyPulse ?? false
  const topAccountForPulse = realData.topAccountForPulse ?? null

  const demoPipelineStages: PipelineStage[] = [
    { name: 'Lead', count: 12, value: 280_000, stallCount: 0 },
    { name: 'Qualified', count: 8, value: 340_000, stallCount: 0 },
    { name: 'Proposal', count: 4, value: 180_000, stallCount: 2 },
    { name: 'Negotiation', count: 2, value: 90_000, stallCount: 0 },
  ]

  const livePipelineStages = realData.pipelineStages
  const liveTotalPipeline = realData.totalPipelineValue
  const showPipelineStages = useDemoData ? demoPipelineStages : (livePipelineStages ?? undefined)
  const showPipelineTotal = useDemoData ? demoPipelineStages.reduce((s, st) => s + st.value, 0) : (liveTotalPipeline ?? undefined)

  const inboxIds = new Set(displayItems.map((i) => i.accountId))

  const demoMatrixAccounts = DEMO_ITEMS.map((item) => ({
    accountName: item.accountName,
    accountId: item.accountId,
    icpScore: item.subScores?.find((s) => s.name === 'ICP Fit')?.score ?? 60,
    signalEngagement: Math.round(
      ((item.subScores?.find((s) => s.name === 'Signal')?.score ?? 50) +
        (item.subScores?.find((s) => s.name === 'Engagement')?.score ?? 50)) / 2,
    ),
    revenue: item.expectedRevenue,
    tier: item.priorityTier ?? 'WARM',
    isInbox: true,
  }))

  const matrixAccounts = useDemoData
    ? demoMatrixAccounts
    : displayItems.map((item) => ({
        accountName: item.accountName,
        accountId: item.accountId,
        icpScore: item.subScores?.find((s) => s.name === 'ICP Fit')?.score ?? 60,
        signalEngagement: Math.round(
          ((item.subScores?.find((s) => s.name === 'Signal')?.score ?? 50) +
            (item.subScores?.find((s) => s.name === 'Engagement')?.score ?? 50)) / 2,
        ),
        revenue: item.expectedRevenue,
        tier: item.priorityTier ?? 'WARM',
        isInbox: inboxIds.has(item.accountId),
      }))

  const signalsThisWeek = displayItems.reduce((s, i) => s + (i.signalCount ?? 0), 0)
  const hotCount = displayItems.filter((i) => i.priorityTier === 'HOT').length

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <WelcomeBanner />

      <QueueHeader
        repName={repName}
        actionCount={displayItems.length}
        pipelineStages={showPipelineStages}
        totalPipelineValue={showPipelineTotal}
      />

      <div className="mt-4">
        <NextStepCard
          question="What do you want to do next?"
          helperText="Pick one — Prospector OS will pull the data and lay out the answer."
          skills={INBOX_SKILLS}
          pageContext={{ page: 'inbox' }}
        />
      </div>

      {/* KPI Strip */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Pipeline', value: showPipelineTotal != null ? `£${Math.round(showPipelineTotal / 1000)}K` : '—', color: 'text-zinc-100' },
          { label: 'HOT Accounts', value: `${hotCount}`, color: 'text-red-400' },
          { label: 'Signals (wk)', value: `${signalsThisWeek}`, color: 'text-violet-400' },
          { label: 'Stalls', value: `${showPipelineStages?.reduce((s: number, st: PipelineStage) => s + st.stallCount, 0) ?? 0}`, color: 'text-amber-400' },
          { label: 'Done Today', value: `${completedTodayCount}/${displayItems.length}`, color: 'text-emerald-400' },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
            <p className="text-xs text-zinc-500">{m.label}</p>
            <p className={`mt-1 text-xl font-bold font-mono tabular-nums ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Priority Matrix */}
      <div className="mt-4">
        <InboxDashboard accounts={matrixAccounts} />
      </div>

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
            Demo tenant — illustrative data only. Real priorities appear once
            production scoring runs against connected CRM data.
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
