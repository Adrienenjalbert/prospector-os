import { createSupabaseServer } from '@/lib/supabase/server'
import { SignalsFeed } from './signals-feed'

interface SignalRow {
  id: string
  companyId: string
  companyName: string
  signalType: string
  title: string
  description: string | null
  urgency: string
  relevanceScore: number
  weightedScore: number
  recommendedAction: string | null
  detectedAt: string
  source: string
}

const DEMO_SIGNALS: SignalRow[] = [
  {
    id: 'demo-sig-1',
    companyId: 'demo-001',
    companyName: 'UK Logistics Solutions',
    signalType: 'hiring_surge',
    title: 'Peak season hiring surge — 45 new warehouse roles posted across 3 locations',
    description: 'UK Logistics Solutions has posted 45 temporary warehouse roles in London, Manchester, and Birmingham ahead of peak season.',
    urgency: 'immediate',
    relevanceScore: 0.92,
    weightedScore: 1.66,
    recommendedAction: 'Call Sarah Williams to discuss peak season workforce planning and MSP contract review.',
    detectedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    source: 'Apollo Job Postings',
  },
  {
    id: 'demo-sig-2',
    companyId: 'demo-002',
    companyName: 'Distribution Network UK',
    signalType: 'expansion',
    title: 'New distribution centre opening in Leeds',
    description: 'Distribution Network UK is expanding operations with a new 50,000 sq ft facility in Leeds, expected to require 200+ temporary workers.',
    urgency: 'this_week',
    relevanceScore: 0.85,
    weightedScore: 1.28,
    recommendedAction: 'Email Operations Director about workforce planning for the new Leeds facility.',
    detectedAt: new Date(Date.now() - 18 * 3600000).toISOString(),
    source: 'Claude Research',
  },
  {
    id: 'demo-sig-3',
    companyId: 'demo-003',
    companyName: 'Industrial Manufacturing Corp',
    signalType: 'leadership_change',
    title: 'New VP of Operations appointed',
    description: 'Industrial Manufacturing Corp has appointed a new VP of Operations who previously led a successful MSP transition at a competitor.',
    urgency: 'this_week',
    relevanceScore: 0.78,
    weightedScore: 1.02,
    recommendedAction: 'Research the new VP\'s background and send a congratulatory connection request on LinkedIn.',
    detectedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    source: 'Apollo People',
  },
  {
    id: 'demo-sig-4',
    companyId: 'demo-004',
    companyName: 'Food Service Holdings',
    signalType: 'temp_job_posting',
    title: '12 temp catering roles posted for event season',
    description: 'Food Service Holdings is ramping up for the summer events calendar with temporary catering staff across Scotland.',
    urgency: 'this_month',
    relevanceScore: 0.65,
    weightedScore: 0.78,
    recommendedAction: 'Include in next prospecting batch — good ICP fit for seasonal workforce management.',
    detectedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    source: 'Apollo Job Postings',
  },
]

async function fetchSignals(): Promise<{ signals: SignalRow[]; isDemo: boolean }> {
  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { signals: DEMO_SIGNALS, isDemo: true }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id, rep_profile_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) return { signals: DEMO_SIGNALS, isDemo: true }

    const { data: repProfile } = await supabase
      .from('rep_profiles')
      .select('crm_id')
      .eq('id', profile.rep_profile_id ?? '')
      .single()

    const { data: companies } = await supabase
      .from('companies')
      .select('id, name')
      .eq('tenant_id', profile.tenant_id)
      .eq('owner_crm_id', repProfile?.crm_id ?? '')

    const companyIds = (companies ?? []).map((c) => c.id)
    const companyNameMap = new Map((companies ?? []).map((c) => [c.id, c.name]))

    if (companyIds.length === 0) return { signals: DEMO_SIGNALS, isDemo: true }

    const { data: dbSignals } = await supabase
      .from('signals')
      .select('id, company_id, signal_type, title, description, urgency, relevance_score, weighted_score, recommended_action, detected_at, source')
      .eq('tenant_id', profile.tenant_id)
      .in('company_id', companyIds)
      .order('detected_at', { ascending: false })
      .limit(50)

    if (!dbSignals || dbSignals.length === 0) return { signals: DEMO_SIGNALS, isDemo: true }

    return {
      signals: dbSignals.map((s) => ({
        id: s.id,
        companyId: s.company_id,
        companyName: companyNameMap.get(s.company_id) ?? 'Unknown',
        signalType: s.signal_type,
        title: s.title,
        description: s.description,
        urgency: s.urgency,
        relevanceScore: s.relevance_score,
        weightedScore: s.weighted_score,
        recommendedAction: s.recommended_action,
        detectedAt: s.detected_at,
        source: s.source,
      })),
      isDemo: false,
    }
  } catch {
    return { signals: DEMO_SIGNALS, isDemo: true }
  }
}

export default async function SignalsPage() {
  const { signals, isDemo } = await fetchSignals()

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          Signals
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Buying signals across your portfolio — sorted by recency.
        </p>
      </div>

      {isDemo && (
        <div className="mt-4 rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
          <p className="text-sm text-amber-300/80">
            Showing demo signals. Connect your CRM to see real buying signals.
          </p>
        </div>
      )}

      <div className="mt-6">
        <SignalsFeed signals={signals} />
      </div>

      {signals.length === 0 && (
        <div className="mt-12 text-center">
          <p className="text-zinc-500">No signals detected yet.</p>
          <p className="mt-1 text-sm text-zinc-600">
            Signals are detected daily for your Tier A and B accounts.
          </p>
        </div>
      )}
    </div>
  )
}
