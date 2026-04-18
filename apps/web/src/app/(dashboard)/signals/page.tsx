import { createSupabaseServer } from '@/lib/supabase/server'
import { SignalsFeed } from './signals-feed'
import { SignalsDashboard } from './signals-dashboard'
import { SkillBar } from '@/components/agent/skill-bar'
import { SIGNALS_SKILLS } from '@/lib/agent/skills'

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

/**
 * Signals page — REAL data only. Per MISSION UX rule 8, no demo signals are
 * surfaced in production analytics. Empty state below explains how to get
 * data flowing: connect CRM, then nightly signal sync runs.
 */
async function fetchSignals(): Promise<{
  signals: SignalRow[]
  reason: 'no-auth' | 'no-tenant' | 'no-companies' | 'ok'
}> {
  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { signals: [], reason: 'no-auth' }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id, rep_profile_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) return { signals: [], reason: 'no-tenant' }

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

    if (companyIds.length === 0) return { signals: [], reason: 'no-companies' }

    const { data: dbSignals } = await supabase
      .from('signals')
      .select('id, company_id, signal_type, title, description, urgency, relevance_score, weighted_score, recommended_action, detected_at, source')
      .eq('tenant_id', profile.tenant_id)
      .in('company_id', companyIds)
      .order('detected_at', { ascending: false })
      .limit(50)

    return {
      signals: (dbSignals ?? []).map((s) => ({
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
      reason: 'ok',
    }
  } catch {
    return { signals: [], reason: 'no-tenant' }
  }
}

export default async function SignalsPage() {
  const { signals, reason } = await fetchSignals()

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Signal Intelligence
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Buying signals across your portfolio
          </p>
        </div>
        <SkillBar skills={SIGNALS_SKILLS} pageContext={{ page: 'signals' }} />
      </div>

      {signals.length === 0 ? (
        <div className="mt-12 rounded-lg border border-zinc-800 bg-zinc-950 p-8 text-center">
          <p className="text-zinc-300">No signals yet.</p>
          <p className="mt-2 text-sm text-zinc-500">
            {reason === 'no-auth' && 'Sign in to see your portfolio signals.'}
            {reason === 'no-tenant' && 'Complete onboarding to start receiving signals.'}
            {reason === 'no-companies' && (
              <>Connect your CRM and run the first sync — signals are detected
              nightly for your Tier A and B accounts.</>
            )}
            {reason === 'ok' && (
              <>Signals are detected daily for your Tier A and B accounts.
              Nothing has matched in the last 30 days.</>
            )}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <SignalsDashboard signals={signals} />
          </div>
          <div className="mt-6">
            <SignalsFeed signals={signals} />
          </div>
        </>
      )}
    </div>
  )
}
