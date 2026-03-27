import { QueueHeader } from '@/components/priority/queue-header'
import { InboxList } from '@/components/priority/inbox-list'

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
      }
    })

    return { items, repName: profile.full_name }
  } catch {
    return null
  }
}

export default async function InboxPage() {
  const realData = await fetchRealData()
  const useDemoData = !realData || realData.items.length === 0
  const displayItems = useDemoData ? DEMO_ITEMS : realData!.items
  const repName = realData?.repName ?? 'there'

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <QueueHeader repName={repName} actionCount={displayItems.length} />

      {useDemoData && (
        <div className="mt-4 rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
          <p className="text-sm text-amber-300/80">
            Showing demo data. Connect your CRM to see your real priorities.
          </p>
        </div>
      )}

      <div className="mt-6">
        <InboxList items={displayItems} />
      </div>

      {!useDemoData && displayItems.length > 0 && (
        <p className="mt-8 text-center text-sm text-zinc-600">
          That&apos;s everything for today.
        </p>
      )}
    </div>
  )
}
