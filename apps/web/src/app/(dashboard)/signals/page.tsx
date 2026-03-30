import { createSupabaseServer } from '@/lib/supabase/server'

interface SignalRow {
  id: string
  company_id: string
  signal_type: string
  title: string
  description: string | null
  urgency: string
  relevance_score: number
  weighted_score: number
  recommended_action: string | null
  detected_at: string
  source: string
  company_name?: string
}

const DEMO_SIGNALS: SignalRow[] = [
  {
    id: 'demo-sig-1',
    company_id: 'demo-001',
    signal_type: 'hiring_surge',
    title: 'Peak season hiring surge — 45 new warehouse roles posted across 3 locations',
    description: 'UK Logistics Solutions has posted 45 temporary warehouse roles in London, Manchester, and Birmingham ahead of peak season.',
    urgency: 'immediate',
    relevance_score: 0.92,
    weighted_score: 1.66,
    recommended_action: 'Call Sarah Williams to discuss peak season workforce planning and MSP contract review.',
    detected_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    source: 'Apollo Job Postings',
    company_name: 'UK Logistics Solutions',
  },
  {
    id: 'demo-sig-2',
    company_id: 'demo-002',
    signal_type: 'expansion',
    title: 'New distribution centre opening in Leeds',
    description: 'Distribution Network UK is expanding operations with a new 50,000 sq ft facility in Leeds, expected to require 200+ temporary workers.',
    urgency: 'this_week',
    relevance_score: 0.85,
    weighted_score: 1.28,
    recommended_action: 'Email Operations Director about workforce planning for the new Leeds facility.',
    detected_at: new Date(Date.now() - 18 * 3600000).toISOString(),
    source: 'Claude Research',
    company_name: 'Distribution Network UK',
  },
  {
    id: 'demo-sig-3',
    company_id: 'demo-003',
    signal_type: 'leadership_change',
    title: 'New VP of Operations appointed',
    description: 'Industrial Manufacturing Corp has appointed a new VP of Operations who previously led a successful MSP transition at a competitor.',
    urgency: 'this_week',
    relevance_score: 0.78,
    weighted_score: 1.02,
    recommended_action: 'Research the new VP\'s background and send a congratulatory connection request on LinkedIn.',
    detected_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    source: 'Apollo People',
    company_name: 'Industrial Manufacturing Corp',
  },
  {
    id: 'demo-sig-4',
    company_id: 'demo-004',
    signal_type: 'temp_job_posting',
    title: '12 temp catering roles posted for event season',
    description: 'Food Service Holdings is ramping up for the summer events calendar with temporary catering staff across Scotland.',
    urgency: 'this_month',
    relevance_score: 0.65,
    weighted_score: 0.78,
    recommended_action: 'Include in next prospecting batch — good ICP fit for seasonal workforce management.',
    detected_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    source: 'Apollo Job Postings',
    company_name: 'Food Service Holdings',
  },
]

const SIGNAL_TYPE_META: Record<string, { label: string; icon: string; color: string }> = {
  hiring_surge: { label: 'Hiring Surge', icon: '📈', color: 'text-red-400 bg-red-950/40 border-red-800/40' },
  funding: { label: 'Funding', icon: '💰', color: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40' },
  expansion: { label: 'Expansion', icon: '🏗️', color: 'text-amber-400 bg-amber-950/40 border-amber-800/40' },
  leadership_change: { label: 'Leadership Change', icon: '👤', color: 'text-sky-400 bg-sky-950/40 border-sky-800/40' },
  temp_job_posting: { label: 'Temp Posting', icon: '📋', color: 'text-violet-400 bg-violet-950/40 border-violet-800/40' },
  competitor_mention: { label: 'Competitor', icon: '⚔️', color: 'text-orange-400 bg-orange-950/40 border-orange-800/40' },
  seasonal_peak: { label: 'Seasonal Peak', icon: '🌡️', color: 'text-rose-400 bg-rose-950/40 border-rose-800/40' },
  negative_news: { label: 'Risk', icon: '⚠️', color: 'text-zinc-400 bg-zinc-800/40 border-zinc-700/40' },
}

const URGENCY_META: Record<string, { label: string; color: string }> = {
  immediate: { label: 'Immediate', color: 'text-red-300 bg-red-950/60' },
  this_week: { label: 'This Week', color: 'text-amber-300 bg-amber-950/60' },
  this_month: { label: 'This Month', color: 'text-zinc-300 bg-zinc-800' },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export default async function SignalsPage() {
  let signals: SignalRow[] = DEMO_SIGNALS
  let isDemo = true

  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('tenant_id, rep_profile_id')
        .eq('id', user.id)
        .single()

      if (profile?.tenant_id) {
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

        if (companyIds.length > 0) {
          const { data: dbSignals } = await supabase
            .from('signals')
            .select('id, company_id, signal_type, title, description, urgency, relevance_score, weighted_score, recommended_action, detected_at, source')
            .eq('tenant_id', profile.tenant_id)
            .in('company_id', companyIds)
            .order('detected_at', { ascending: false })
            .limit(50)

          if (dbSignals && dbSignals.length > 0) {
            signals = dbSignals.map((s) => ({
              ...s,
              company_name: companyNameMap.get(s.company_id) ?? 'Unknown',
            }))
            isDemo = false
          }
        }
      }
    }
  } catch {
    // fall back to demo
  }

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

      <div className="mt-6 flex flex-col gap-4">
        {signals.map((signal) => {
          const typeMeta = SIGNAL_TYPE_META[signal.signal_type] ?? { label: signal.signal_type, icon: '📡', color: 'text-zinc-400 bg-zinc-800/40 border-zinc-700/40' }
          const urgencyMeta = URGENCY_META[signal.urgency] ?? { label: signal.urgency, color: 'text-zinc-300 bg-zinc-800' }

          return (
            <div
              key={signal.id}
              className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${typeMeta.color}`}>
                    <span>{typeMeta.icon}</span>
                    {typeMeta.label}
                  </span>
                  <span className="text-xs text-zinc-600">·</span>
                  <span className="text-xs text-zinc-500">{timeAgo(signal.detected_at)}</span>
                  <span className="text-xs text-zinc-600">·</span>
                  <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${urgencyMeta.color}`}>
                    {urgencyMeta.label}
                  </span>
                </div>
              </div>

              <p className="mt-2 text-sm font-medium text-zinc-200">
                {signal.company_name}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                {signal.title}
              </p>

              {signal.recommended_action && (
                <div className="mt-3 flex items-start gap-2">
                  <span className="mt-0.5 text-emerald-400">▸</span>
                  <p className="text-sm text-zinc-300">
                    {signal.recommended_action}
                  </p>
                </div>
              )}

              <div className="mt-3 flex items-center gap-2 border-t border-zinc-800/60 pt-3">
                <a
                  href={`/accounts/${signal.company_id}`}
                  className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
                >
                  View Company
                </a>
                <button
                  onClick={undefined}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
                >
                  Draft Outreach
                </button>
                <span className="ml-auto text-xs text-zinc-600">
                  Source: {signal.source}
                </span>
              </div>
            </div>
          )
        })}
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
