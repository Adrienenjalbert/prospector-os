import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import {
  TRIGGER_PATTERN_LABELS,
  type TriggerPattern,
} from '@prospector/core'
import { TriggerActionsClient } from './actions-client'

export const metadata = { title: 'Composite triggers' }
export const dynamic = 'force-dynamic'

/**
 * /admin/triggers — Phase 7 (Section 6.1) of the Composite Triggers
 * + Relationship Graph plan.
 *
 * Customer-facing review surface for the typed composite triggers
 * the mineCompositeTriggers workflow writes. Mirrors /admin/memory's
 * shape so admins have one mental model across both layers.
 *
 * Three views (compressed into the same page via filter chips):
 *   - Open triggers (default)
 *   - Acted in last 7d (correlation with downstream outcomes)
 *   - Expired / dismissed (history)
 *
 * Per-row actions (admin only):
 *   - Mark acted (with optional outcome reference)
 *   - Dismiss (with reason; counts as failure for the bandit)
 *   - View component URNs (deep-links to /admin/memory or /companies)
 */

interface TriggerRow {
  id: string
  pattern: string
  company_id: string | null
  trigger_score: number
  rationale: string
  recommended_action: string | null
  recommended_tool: string | null
  status: string
  components: Record<string, unknown>
  detected_at: string
  expires_at: string | null
  acted_at: string | null
  prior_alpha: number
  prior_beta: number
}

interface SearchParams {
  pattern?: string
  status?: string
  min_score?: string
}

export default async function AdminTriggersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
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

  const filters = await searchParams
  const minScore = filters.min_score ? Number(filters.min_score) : 0

  let query = supabase
    .from('triggers')
    .select(
      'id, pattern, company_id, trigger_score, rationale, recommended_action, recommended_tool, status, components, detected_at, expires_at, acted_at, prior_alpha, prior_beta',
    )
    .eq('tenant_id', profile.tenant_id)
    .gte('trigger_score', minScore)
    .order('trigger_score', { ascending: false })
    .limit(200)

  if (filters.pattern && filters.pattern !== 'all') {
    query = query.eq('pattern', filters.pattern)
  }
  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  } else {
    // Default — open + acted in last 7d.
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    query = query.or(`status.eq.open,acted_at.gte.${since7}`)
  }

  const [triggersRes, companyMapRes] = await Promise.all([
    query,
    supabase.from('companies').select('id, name').eq('tenant_id', profile.tenant_id).limit(2000),
  ])

  const triggers = (triggersRes.data ?? []) as TriggerRow[]
  const companyById = new Map(
    (companyMapRes.data ?? []).map((c) => [c.id as string, c.name as string]),
  )

  // Per-pattern counts for the filter chips.
  const patternCounts: Record<string, number> = {}
  for (const t of triggers) patternCounts[t.pattern] = (patternCounts[t.pattern] ?? 0) + 1
  const patterns = Object.keys(TRIGGER_PATTERN_LABELS) as TriggerPattern[]

  const isAdmin = profile.role === 'admin'

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Composite triggers</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Typed composites of (signal × bridge × enrichment × time window).
        Each row is one "act now" event with cited components. Replaces
        the heuristic urgency scoring with debuggable, single-decision
        rows.{' '}
        <span className="font-mono text-xs text-zinc-400">
          mineCompositeTriggers
        </span>{' '}
        runs nightly.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {patterns.map((p) => {
          const count = patternCounts[p] ?? 0
          const isActive = filters.pattern === p
          const href = isActive
            ? '/admin/triggers'
            : `/admin/triggers?pattern=${encodeURIComponent(p)}`
          return (
            <Link
              key={p}
              href={href}
              className={`rounded-md border px-2 py-2 text-left text-[11px] transition ${
                isActive
                  ? 'border-emerald-500 bg-emerald-950/40'
                  : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
              }`}
            >
              <div className="uppercase tracking-wide text-zinc-500">
                {TRIGGER_PATTERN_LABELS[p]}
              </div>
              <div className="mt-1 text-base font-semibold text-zinc-100 tabular-nums">
                {count}
              </div>
            </Link>
          )
        })}
      </section>

      <section className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-500">Status:</span>
        {(['all', 'open', 'acted', 'expired', 'dismissed'] as const).map((s) => {
          const params = new URLSearchParams()
          if (filters.pattern) params.set('pattern', filters.pattern)
          if (s !== 'all') params.set('status', s)
          const isActive = (filters.status ?? '') === s || (s === 'all' && !filters.status)
          return (
            <Link
              key={s}
              href={`/admin/triggers?${params.toString()}`}
              className={`rounded-full border px-2 py-0.5 ${
                isActive
                  ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200'
                  : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              {s}
            </Link>
          )
        })}
        <span className="ml-2 text-zinc-500">Score ≥</span>
        {([0, 0.5, 0.7, 0.85] as const).map((min) => {
          const params = new URLSearchParams()
          if (filters.pattern) params.set('pattern', filters.pattern)
          if (filters.status) params.set('status', filters.status)
          if (min > 0) params.set('min_score', String(min))
          const isActive = Number(filters.min_score ?? 0) === min
          return (
            <Link
              key={min}
              href={`/admin/triggers?${params.toString()}`}
              className={`rounded-full border px-2 py-0.5 ${
                isActive
                  ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200'
                  : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              {min}
            </Link>
          )
        })}
      </section>

      <section className="mt-6 overflow-hidden rounded-md border border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-800 text-sm">
          <thead className="bg-zinc-900/40 text-left text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Pattern</th>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Rationale</th>
              <th className="px-3 py-2 text-right font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Detected</th>
              <th className="px-3 py-2 text-right font-medium">α / β</th>
              {isAdmin && <th className="px-3 py-2 text-right font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
            {triggers.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 8 : 7} className="px-3 py-8 text-center text-zinc-500">
                  No triggers match the current filters.
                </td>
              </tr>
            )}
            {triggers.map((t) => (
              <tr key={t.id} className="align-top hover:bg-zinc-900/40">
                <td className="px-3 py-2 text-xs text-zinc-400">
                  {TRIGGER_PATTERN_LABELS[t.pattern as TriggerPattern] ?? t.pattern}
                </td>
                <td className="px-3 py-2 text-zinc-200">
                  {t.company_id ? (
                    <Link
                      href={`/objects/companies/${t.company_id}`}
                      className="hover:text-emerald-200"
                    >
                      {companyById.get(t.company_id) ?? t.company_id.slice(0, 8)}
                    </Link>
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-300">
                  <div className="max-w-md">{t.rationale}</div>
                  {t.recommended_action && (
                    <div className="mt-1 text-[11px] text-zinc-500">
                      → {t.recommended_action}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-300">
                  {Number(t.trigger_score).toFixed(2)}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${statusColor(t.status)}`}>
                    {t.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-[11px] text-zinc-500">
                  {new Date(t.detected_at).toLocaleDateString()}
                  {t.expires_at && t.status === 'open' && (
                    <div className="text-zinc-600">
                      exp {new Date(t.expires_at).toLocaleDateString()}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[11px] text-zinc-500">
                  {Math.round(Number(t.prior_alpha))} / {Math.round(Number(t.prior_beta))}
                </td>
                {isAdmin && (
                  <td className="px-3 py-2 text-right">
                    {t.status === 'open' ? (
                      <TriggerActionsClient triggerId={t.id} />
                    ) : (
                      <span className="text-[10px] text-zinc-600">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function statusColor(status: string): string {
  switch (status) {
    case 'open':
      return 'bg-emerald-950 text-emerald-300'
    case 'acted':
      return 'bg-sky-950 text-sky-300'
    case 'expired':
      return 'bg-zinc-900 text-zinc-500'
    case 'dismissed':
      return 'bg-zinc-900 text-zinc-600 line-through'
    default:
      return 'bg-zinc-900 text-zinc-400'
  }
}
