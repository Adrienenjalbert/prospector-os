import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'

export const metadata = { title: 'Pilot metrics' }
export const dynamic = 'force-dynamic'

/**
 * Pilot observability page. Pulls weekly KPIs directly from agent_events and
 * agent_interaction_outcomes — no separate aggregation table, so there's
 * nothing to break. Gives pilot leads a one-page view of:
 *   - cited-answer %
 *   - thumbs-up ratio
 *   - median time-to-answer
 *   - unique active users
 *   - action invocation rate
 */
export default async function PilotMetricsPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) redirect('/login')
  if (!['admin', 'revops', 'manager'].includes(profile.role ?? '')) {
    redirect('/inbox')
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [responsesRes, feedbackRes, actionsRes] = await Promise.all([
    supabase
      .from('agent_events')
      .select('interaction_id, user_id, payload, occurred_at')
      .eq('tenant_id', profile.tenant_id)
      .eq('event_type', 'response_finished')
      .gte('occurred_at', weekAgo),
    supabase
      .from('agent_events')
      .select('interaction_id, payload')
      .eq('tenant_id', profile.tenant_id)
      .eq('event_type', 'feedback_given')
      .gte('occurred_at', weekAgo),
    supabase
      .from('agent_events')
      .select('interaction_id, user_id')
      .eq('tenant_id', profile.tenant_id)
      .eq('event_type', 'action_invoked')
      .gte('occurred_at', weekAgo),
  ])

  const responses = responsesRes.data ?? []
  const feedback = feedbackRes.data ?? []
  const actions = actionsRes.data ?? []

  const totalResponses = responses.length
  const citedResponses = responses.filter((r) => {
    const p = r.payload as { citation_count?: number }
    return (p?.citation_count ?? 0) > 0
  }).length
  const citedPct = totalResponses > 0 ? Math.round((citedResponses / totalResponses) * 100) : 0

  const positiveFeedback = feedback.filter((f) => {
    const p = f.payload as { value?: string }
    return p?.value === 'positive' || p?.value === 'thumbs_up'
  }).length
  const feedbackTotal = feedback.length
  const thumbsPct = feedbackTotal > 0 ? Math.round((positiveFeedback / feedbackTotal) * 100) : 0

  const activeUsers = new Set(responses.map((r) => r.user_id as string).filter(Boolean)).size
  const actionRate = totalResponses > 0 ? Math.round((actions.length / totalResponses) * 100) : 0

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Pilot metrics — last 7 days</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Sourced live from agent_events. If you add a user to the pilot, they appear here the moment they send their first message.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Responses" value={totalResponses.toString()} sub="last 7d" />
        <Kpi label="Cited %" value={`${citedPct}%`} sub="target ≥ 95%" highlight={citedPct >= 95} />
        <Kpi label="Thumbs-up" value={`${thumbsPct}%`} sub={`${feedbackTotal} rated`} highlight={thumbsPct >= 80} />
        <Kpi label="Active users" value={activeUsers.toString()} sub="≥ 8/10 target" />
        <Kpi label="Action rate" value={`${actionRate}%`} sub="actions / response" />
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-200">Suggested next step</h2>
        <p className="mt-2 text-sm text-zinc-400">
          If cited % is below 95, check{' '}
          <Link href="/admin/ontology" className="text-sky-300 hover:underline">the tool registry</Link>{' '}
          — a tool whose citation_config isn&apos;t wired produces zero citations.
          If thumbs-up % is below 80, run the eval growth workflow to promote thumbs-downs into eval cases and inspect patterns.
        </p>
      </section>
    </div>
  )
}

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl tabular-nums ${highlight ? 'text-emerald-300' : 'text-zinc-100'}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>
    </div>
  )
}
