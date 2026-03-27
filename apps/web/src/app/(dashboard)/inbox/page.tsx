import { createSupabaseServer } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { QueueHeader } from '@/components/priority/queue-header'
import { PriorityCard } from '@/components/priority/priority-card'

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
}

export default async function InboxPage() {
  const supabase = await createSupabaseServer()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, full_name, rep_profile_id')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-zinc-400">
          Your profile is not set up yet. Contact your admin.
        </p>
      </div>
    )
  }

  const { data: repProfile } = await supabase
    .from('rep_profiles')
    .select('crm_id')
    .eq('id', profile.rep_profile_id)
    .single()

  const repCrmId = repProfile?.crm_id

  const [companiesResult, signalsResult, stalledResult, contactsResult] = await Promise.all([
    supabase
      .from('companies')
      .select(
        'id, name, expected_revenue, propensity, priority_tier, priority_reason, icp_tier'
      )
      .eq('tenant_id', profile.tenant_id)
      .eq('owner_crm_id', repCrmId ?? '')
      .in('priority_tier', ['HOT', 'WARM'])
      .order('expected_revenue', { ascending: false })
      .limit(10),
    supabase
      .from('signals')
      .select('company_id, signal_type, title, urgency')
      .eq('tenant_id', profile.tenant_id)
      .gte(
        'detected_at',
        new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
      )
      .order('weighted_score', { ascending: false })
      .limit(20),
    supabase
      .from('opportunities')
      .select('company_id, name, stage, value, days_in_stage, is_stalled, stall_reason')
      .eq('tenant_id', profile.tenant_id)
      .eq('owner_crm_id', repCrmId ?? '')
      .eq('is_stalled', true)
      .eq('is_closed', false),
    supabase
      .from('contacts')
      .select('company_id, first_name, last_name, title, phone, email, is_decision_maker, relevance_score')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_decision_maker', true)
      .order('relevance_score', { ascending: false }),
  ])

  const companies = companiesResult.data ?? []
  const signals = signalsResult.data ?? []
  const stalledDeals = stalledResult.data ?? []
  const contacts = contactsResult.data ?? []

  const contactsByCompany = new Map<string, (typeof contacts)[0]>()
  for (const c of contacts) {
    if (!contactsByCompany.has(c.company_id)) {
      contactsByCompany.set(c.company_id, c)
    }
  }

  const signalsByCompany = new Map<string, typeof signals>()
  for (const s of signals) {
    const list = signalsByCompany.get(s.company_id) ?? []
    list.push(s)
    signalsByCompany.set(s.company_id, list)
  }

  const stallsByCompany = new Map<string, (typeof stalledDeals)[0]>()
  for (const d of stalledDeals) {
    if (!stallsByCompany.has(d.company_id)) {
      stallsByCompany.set(d.company_id, d)
    }
  }

  const items: PriorityItem[] = companies.slice(0, 3).map((c) => {
    const companySignals = signalsByCompany.get(c.id) ?? []
    const stalledDeal = stallsByCompany.get(c.id)
    const topSignal = companySignals[0]

    let triggerType: PriorityItem['triggerType'] = 'pipeline'
    let triggerDetail = c.priority_reason ?? 'High priority account'
    let severity: PriorityItem['severity'] = 'medium'
    let nextAction = `Review ${c.name} and identify next steps`

    if (stalledDeal) {
      triggerType = 'stall'
      severity = 'critical'
      triggerDetail = `Deal "${stalledDeal.name}" at ${stalledDeal.stage} for ${stalledDeal.days_in_stage} days. ${stalledDeal.stall_reason ?? 'No recent activity.'}`
      nextAction = `Re-engage on stalled deal "${stalledDeal.name}"`
    } else if (topSignal && topSignal.urgency === 'immediate') {
      triggerType = 'signal'
      severity = 'high'
      triggerDetail = `${topSignal.signal_type.replace(/_/g, ' ')}: ${topSignal.title}`
      nextAction = `Act on ${topSignal.signal_type.replace(/_/g, ' ')} signal`
    } else if (!stalledDeal && companySignals.length === 0) {
      triggerType = 'prospect'
      triggerDetail = `Tier ${c.icp_tier} ICP fit. ${c.priority_reason ?? ''}`
      nextAction = `Research ${c.name} and send intro outreach`
    }

    const topContact = contactsByCompany.get(c.id)
    const contactFullName = topContact
      ? `${topContact.first_name} ${topContact.last_name}`
      : null

    return {
      accountName: c.name,
      accountId: c.id,
      dealValue: stalledDeal?.value ?? null,
      expectedRevenue: c.expected_revenue,
      triggerType,
      triggerDetail,
      nextAction: topContact
        ? `${nextAction} — contact ${contactFullName} (${topContact.title ?? 'Decision Maker'})`
        : nextAction,
      contactName: contactFullName,
      contactPhone: topContact?.phone ?? null,
      severity,
    }
  })

  const useDemoData = items.length === 0

  const demoItems: PriorityItem[] = [
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
    },
  ]

  const displayItems = useDemoData ? demoItems : items

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <QueueHeader
        repName={profile.full_name}
        actionCount={displayItems.length}
      />

      {useDemoData && (
        <div className="mt-4 rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
          <p className="text-sm text-amber-300/80">
            Showing demo data. Connect your CRM to see your real priorities.
          </p>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-4">
        {displayItems.map((item) => (
          <PriorityCard
            key={item.accountId}
            {...item}
            onDraftOutreach={() => {}}
            onComplete={() => {}}
            onFeedback={() => {}}
          />
        ))}
      </div>

      {displayItems.length > 0 && (
        <div className="mt-10 rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-6 text-center">
          <p className="text-sm text-zinc-500">
            {useDemoData
              ? 'These are demo priorities. Your real data will appear once your CRM is connected.'
              : 'These are your top priorities for today. Complete them and check back tomorrow.'}
          </p>
        </div>
      )}
    </div>
  )
}
