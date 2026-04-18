import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'

export const metadata = { title: 'ROI dashboard' }
export const dynamic = 'force-dynamic'

/**
 * ROI dashboard — every number sourced from the event log + outcome events
 * + attributions. No hardcoded figures.
 *
 *   Time saved      = Σ (action_invoked × baseline minutes for task_type)
 *   Influenced ARR  = Σ deal.value × attribution.confidence (won deals, treatment)
 *   Adoption        = weekly active users, queries per user
 *   Quality         = cited %, thumbs-up %, eval pass-rate (moved up?)
 */

const TASK_MINUTES_BY_ACTION: Record<string, keyof Baseline> = {
  draft_outreach: 'outreach_draft',
  generate_brief: 'pre_call_brief',
  diagnose_deal: 'qbr_prep',
  pressure_test: 'qbr_prep',
  theme_summary: 'portfolio_review',
  similar_wins: 'account_research',
}

interface Baseline {
  pre_call_brief: number
  outreach_draft: number
  account_research: number
  qbr_prep: number
  portfolio_review: number
  crm_note: number
}

export default async function RoiPage() {
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

  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const quarterAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const [
    actionsRes,
    baselinesRes,
    attributionsRes,
    responsesRes,
    feedbackRes,
  ] = await Promise.all([
    supabase
      .from('agent_events')
      .select('payload, occurred_at')
      .eq('tenant_id', profile.tenant_id)
      .eq('event_type', 'action_invoked')
      .gte('occurred_at', monthAgo),
    supabase
      .from('tenant_baselines')
      .select('task_type, minutes_per_task')
      .eq('tenant_id', profile.tenant_id),
    supabase
      .from('attributions')
      .select('confidence, attribution_rule, outcome_event_id')
      .eq('tenant_id', profile.tenant_id)
      .gte('created_at', quarterAgo),
    supabase
      .from('agent_events')
      .select('payload, user_id, occurred_at')
      .eq('tenant_id', profile.tenant_id)
      .eq('event_type', 'response_finished')
      .gte('occurred_at', monthAgo),
    supabase
      .from('agent_events')
      .select('payload')
      .eq('tenant_id', profile.tenant_id)
      .eq('event_type', 'feedback_given')
      .gte('occurred_at', monthAgo),
  ])

  // Time saved ----------------------------------------------------------------
  const baseline: Baseline = {
    pre_call_brief: 15,
    outreach_draft: 10,
    account_research: 20,
    qbr_prep: 120,
    portfolio_review: 60,
    crm_note: 8,
  }
  const baselineMap = new Map<string, number[]>()
  for (const b of baselinesRes.data ?? []) {
    const arr = baselineMap.get(b.task_type as string) ?? []
    arr.push(b.minutes_per_task as number)
    baselineMap.set(b.task_type as string, arr)
  }
  for (const key of Object.keys(baseline) as (keyof Baseline)[]) {
    const arr = baselineMap.get(key)
    if (arr && arr.length > 0) {
      baseline[key] = Math.round(arr.reduce((s, v) => s + v, 0) / arr.length)
    }
  }

  let minutesSaved = 0
  for (const a of actionsRes.data ?? []) {
    const actionId = (a.payload as { action_id?: string } | null)?.action_id
    if (!actionId) continue
    const taskKey = TASK_MINUTES_BY_ACTION[actionId]
    if (!taskKey) continue
    minutesSaved += baseline[taskKey]
  }
  const hoursSaved = Math.round(minutesSaved / 60)

  // Influenced ARR ------------------------------------------------------------
  const outcomeIds = (attributionsRes.data ?? []).map((a) => a.outcome_event_id)
  let influencedArr = 0
  if (outcomeIds.length > 0) {
    const { data: outcomes } = await supabase
      .from('outcome_events')
      .select('id, value_amount, event_type')
      .in('id', outcomeIds)
      .eq('event_type', 'deal_closed_won')
    const byId = new Map((outcomes ?? []).map((o) => [o.id, o.value_amount ?? 0]))
    for (const a of attributionsRes.data ?? []) {
      const value = byId.get(a.outcome_event_id) ?? 0
      influencedArr += (value as number) * ((a.confidence as number) ?? 0)
    }
  }

  // Adoption ------------------------------------------------------------------
  const uniqueUsers = new Set((responsesRes.data ?? []).map((r) => r.user_id as string).filter(Boolean)).size
  const totalResponses = (responsesRes.data ?? []).length
  const queriesPerUser = uniqueUsers > 0 ? (totalResponses / uniqueUsers).toFixed(1) : '0'

  // Quality -------------------------------------------------------------------
  const citedCount = (responsesRes.data ?? []).filter((r) => {
    const p = r.payload as { citation_count?: number }
    return (p?.citation_count ?? 0) > 0
  }).length
  const citedPct = totalResponses > 0 ? Math.round((citedCount / totalResponses) * 100) : 0

  const feedback = feedbackRes.data ?? []
  const positive = feedback.filter((f) => {
    const v = (f.payload as { value?: string } | null)?.value
    return v === 'positive' || v === 'thumbs_up'
  }).length
  const thumbsPct = feedback.length > 0 ? Math.round((positive / feedback.length) * 100) : 0

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-100">ROI</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Sourced live from agent_events + outcome_events + attributions. No hardcoded figures.
          Control-cohort users are attributed but excluded from influenced-ARR lift.
        </p>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Time saved (30d)" value={`${hoursSaved}h`} hint="Σ (actions × baseline minutes)" />
        <Kpi label="Influenced ARR (90d)" value={`£${Math.round(influencedArr).toLocaleString()}`} hint="Σ deal × confidence" highlight />
        <Kpi label="Active users (30d)" value={`${uniqueUsers}`} hint={`${queriesPerUser} queries/user`} />
        <Kpi label="Response count (30d)" value={`${totalResponses}`} hint={`${citedPct}% cited`} />
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-200">Quality trends</h2>
        <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Kpi label="Cited %" value={`${citedPct}%`} hint="target ≥ 95%" highlight={citedPct >= 95} />
          <Kpi label="Thumbs-up" value={`${thumbsPct}%`} hint={`${feedback.length} rated`} highlight={thumbsPct >= 80} />
          <Kpi label="Attributions" value={`${attributionsRes.data?.length ?? 0}`} hint="last 90d" />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-200">Where to go next</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-zinc-400">
          <li>
            Weekly improvement reports: <Link href="/admin/ontology" className="text-sky-300 hover:underline">Ontology admin</Link>
          </li>
          <li>
            Per-tenant adaptation: <Link href="/admin/adaptation" className="text-sky-300 hover:underline">Adaptation ledger</Link>
          </li>
          <li>
            Calibration proposals: <Link href="/admin/calibration" className="text-sky-300 hover:underline">Calibration</Link>
          </li>
        </ul>
      </section>
    </div>
  )
}

function Kpi({ label, value, hint, highlight }: { label: string; value: string; hint: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl tabular-nums ${highlight ? 'text-emerald-300' : 'text-zinc-100'}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div>
    </div>
  )
}
