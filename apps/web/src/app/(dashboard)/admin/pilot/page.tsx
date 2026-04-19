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

  // Phase 3 T2.4 — onboarding funnel uses a 30-day window. Pilots
  // typically run weeks not days, and a 7-day window misses
  // late-onboarders. Per-step duration is computed below from the
  // started/completed event pairs.
  const onboardingWindow = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString()

  const [responsesRes, feedbackRes, actionsRes, onboardingRes] = await Promise.all([
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
    supabase
      .from('agent_events')
      .select('user_id, event_type, payload, occurred_at')
      .eq('tenant_id', profile.tenant_id)
      .in('event_type', [
        'onboarding_step_started',
        'onboarding_step_completed',
      ])
      .gte('occurred_at', onboardingWindow),
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

  // Phase 3 T2.4 — per-step onboarding funnel.
  //
  // For each of the 6 wizard steps, walk every user's earliest
  // `onboarding_step_started` event and (if present) the matching
  // `onboarding_step_completed` event. Duration = completed - started
  // for that user, rounded to ms. We compute median + p95 on the
  // resulting per-user duration array.
  //
  // Why earliest: a user who bounces between steps would otherwise
  // poison the per-step duration with negative or noisy intervals.
  // First-touch-to-completion is what the pilot operator actually
  // wants to know.
  const onboardingFunnel = computeOnboardingFunnel(onboardingRes.data ?? [])

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
        <h2 className="text-sm font-semibold text-zinc-200">Onboarding funnel — last 30 days</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Per-step starts → completions, with median + p95 time-to-complete.
          A high drop-off at one step is the signal that step's UX needs work
          (or the rep needs help that the agent isn&apos;t providing).
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Step</th>
                <th className="py-2 pr-4 font-medium tabular-nums">Started</th>
                <th className="py-2 pr-4 font-medium tabular-nums">Completed</th>
                <th className="py-2 pr-4 font-medium tabular-nums">Completion %</th>
                <th className="py-2 pr-4 font-medium tabular-nums">Median</th>
                <th className="py-2 pr-4 font-medium tabular-nums">p95</th>
              </tr>
            </thead>
            <tbody>
              {onboardingFunnel.map((row) => (
                <tr key={row.step} className="border-b border-zinc-900">
                  <td className="py-2 pr-4 font-mono text-zinc-100">{row.step}</td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-zinc-300">{row.started}</td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-zinc-300">{row.completed}</td>
                  <td className={`py-2 pr-4 font-mono tabular-nums ${row.completionPct >= 80 ? 'text-emerald-300' : row.completionPct >= 50 ? 'text-amber-300' : 'text-rose-300'}`}>
                    {row.started > 0 ? `${row.completionPct}%` : '—'}
                  </td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-zinc-300">
                    {row.medianMs != null ? formatDurationMs(row.medianMs) : '—'}
                  </td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-zinc-400">
                    {row.p95Ms != null ? formatDurationMs(row.p95Ms) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {onboardingFunnel.every((r) => r.started === 0) && (
          <p className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-500">
            No onboarding events in the last 30 days. The funnel populates
            as new users land on each wizard step.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-200">Suggested next step</h2>
        <p className="mt-2 text-sm text-zinc-400">
          If cited % is below 95, check{' '}
          <Link href="/admin/ontology" className="text-sky-300 hover:underline">the tool registry</Link>{' '}
          — a tool whose citation_config isn&apos;t wired produces zero citations.
          If thumbs-up % is below 80, run the eval growth workflow to promote thumbs-downs into eval cases and inspect patterns.
          If a wizard step shows a sharp completion-% drop in the funnel above, walk through that step yourself in a clean tenant — usually the copy or the implicit prerequisite is the culprit.
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

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding-funnel computation
// ─────────────────────────────────────────────────────────────────────────────

const ONBOARDING_STEPS = [
  'welcome',
  'crm',
  'sync',
  'icp',
  'funnel',
  'preferences',
] as const
type OnboardingStepName = (typeof ONBOARDING_STEPS)[number]

interface OnboardingEventRow {
  user_id: string | null
  event_type: string
  payload: { step?: string } | null
  occurred_at: string
}

interface OnboardingFunnelRow {
  step: OnboardingStepName
  started: number
  completed: number
  completionPct: number
  medianMs: number | null
  p95Ms: number | null
}

/**
 * Compute per-step funnel: how many users started each step, how
 * many completed it, median + p95 duration in ms (started →
 * completed for the same user).
 *
 * Pure function so it's trivial to unit-test with synthetic event
 * arrays. Tolerates: missing started events (counts as completed
 * but unmeasurable); missing completed events (counts as started
 * only); reverse-ordered events (uses earliest started + earliest
 * completed-after-started).
 */
export function computeOnboardingFunnel(
  events: OnboardingEventRow[],
): OnboardingFunnelRow[] {
  // Per (step, user_id) bucket of started + completed timestamps.
  type Bucket = { started: number[]; completed: number[] }
  const buckets = new Map<string, Bucket>()

  function key(step: string, userId: string) {
    return `${step}::${userId}`
  }

  for (const e of events) {
    const step = e.payload?.step
    const userId = e.user_id
    if (!step || !userId) continue
    if (!ONBOARDING_STEPS.includes(step as OnboardingStepName)) continue
    const k = key(step, userId)
    const bucket = buckets.get(k) ?? { started: [], completed: [] }
    const ts = Date.parse(e.occurred_at)
    if (!Number.isFinite(ts)) continue
    if (e.event_type === 'onboarding_step_started') bucket.started.push(ts)
    else if (e.event_type === 'onboarding_step_completed') bucket.completed.push(ts)
    buckets.set(k, bucket)
  }

  return ONBOARDING_STEPS.map((step) => {
    const userKeys = Array.from(buckets.keys()).filter((k) => k.startsWith(`${step}::`))
    const started = userKeys.filter((k) => (buckets.get(k)?.started.length ?? 0) > 0).length
    const completed = userKeys.filter((k) => (buckets.get(k)?.completed.length ?? 0) > 0).length

    const durations: number[] = []
    for (const k of userKeys) {
      const b = buckets.get(k)!
      if (b.started.length === 0 || b.completed.length === 0) continue
      const earliestStart = Math.min(...b.started)
      // First completion at-or-after the earliest start. Earlier
      // completions (data race / clock skew) are ignored — they'd
      // produce negative durations that poison median/p95.
      const validCompletes = b.completed.filter((t) => t >= earliestStart)
      if (validCompletes.length === 0) continue
      durations.push(Math.min(...validCompletes) - earliestStart)
    }

    return {
      step,
      started,
      completed,
      completionPct: started > 0 ? Math.round((completed / started) * 100) : 0,
      medianMs: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
    }
  })
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = s / 60
  if (m < 60) return `${m.toFixed(1)}m`
  return `${(m / 60).toFixed(1)}h`
}
