import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'

export const metadata = { title: 'Per-tenant adaptation' }
export const dynamic = 'force-dynamic'

/**
 * Per-tenant adaptation ledger — customer-facing view of every adaptation
 * the system has made (prompt overrides, scoring weight changes, tool prior
 * updates, retrieval rankings). Builds trust: customers see exactly how
 * the OS is changing behaviour for their business.
 */
export default async function AdaptationPage() {
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

  const [ledgerRes, proposalsRes, reportsRes, priorsRes] = await Promise.all([
    supabase
      .from('calibration_ledger')
      .select('id, change_type, target_path, observed_lift, applied_at, notes')
      .eq('tenant_id', profile.tenant_id)
      .order('applied_at', { ascending: false })
      .limit(20),
    supabase
      .from('calibration_proposals')
      .select('id, proposal_type, created_at, proposed_config')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('improvement_reports')
      .select('id, period_start, period_end, failure_cluster_count, proposed_fixes')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('tool_priors')
      .select('intent_class, tool_id, alpha, beta, sample_count, updated_at')
      .eq('tenant_id', profile.tenant_id)
      .order('sample_count', { ascending: false })
      .limit(20),
  ])

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Per-tenant adaptation</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Everything the OS has learned about your business. Every change is auditable, every
        adaptation reversible via the calibration ledger.
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-200">Calibration ledger</h2>
        {(ledgerRes.data ?? []).length > 0 ? (
          <div className="mt-2 overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left">Applied</th>
                  <th className="px-3 py-2 text-left">Change</th>
                  <th className="px-3 py-2 text-left">Target</th>
                  <th className="px-3 py-2 text-right">Lift</th>
                </tr>
              </thead>
              <tbody>
                {(ledgerRes.data ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-zinc-800">
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {r.applied_at ? new Date(r.applied_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-2">{r.change_type}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-400">{r.target_path}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-300">
                      {r.observed_lift != null ? `${(Number(r.observed_lift) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs text-zinc-500">No adaptations applied yet. This populates once the self-improvement loop runs.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-200">Pending proposals ({proposalsRes.data?.length ?? 0})</h2>
        <ul className="mt-2 space-y-2">
          {(proposalsRes.data ?? []).map((p) => (
            <li key={p.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-100">{p.proposal_type}</span>
                <span className="text-xs text-zinc-500">{new Date(p.created_at).toLocaleDateString()}</span>
              </div>
              <Link href="/admin/calibration" className="mt-1 inline-block text-xs text-sky-300 hover:underline">
                Review →
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-200">Recent improvement reports</h2>
        <ul className="mt-2 space-y-2">
          {(reportsRes.data ?? []).map((r) => (
            <li key={r.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-200">
                  {new Date(r.period_start).toLocaleDateString()} — {new Date(r.period_end).toLocaleDateString()}
                </span>
                <span className="text-xs text-zinc-500">
                  {r.failure_cluster_count} failure clusters · {(r.proposed_fixes as unknown[] | null)?.length ?? 0} proposed fixes
                </span>
              </div>
            </li>
          ))}
          {(!reportsRes.data || reportsRes.data.length === 0) && (
            <p className="text-xs text-zinc-500">No improvement reports yet. Runs nightly once the OS has 7 days of data.</p>
          )}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-200">Tool priors (Thompson bandit)</h2>
        {(priorsRes.data ?? []).length > 0 ? (
          <div className="mt-2 overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left">Intent</th>
                  <th className="px-3 py-2 text-left">Tool</th>
                  <th className="px-3 py-2 text-right">α</th>
                  <th className="px-3 py-2 text-right">β</th>
                  <th className="px-3 py-2 text-right">Samples</th>
                  <th className="px-3 py-2 text-right">E[success]</th>
                </tr>
              </thead>
              <tbody>
                {(priorsRes.data ?? []).map((r) => {
                  const a = Number(r.alpha) || 1
                  const b = Number(r.beta) || 1
                  return (
                    <tr key={`${r.intent_class}:${r.tool_id}`} className="border-t border-zinc-800">
                      <td className="px-3 py-2 text-zinc-300">{r.intent_class}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.tool_id}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.sample_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{((a / (a + b)) * 100).toFixed(0)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs text-zinc-500">No tool priors yet. Populated as users feed back on responses.</p>
        )}
      </section>
    </div>
  )
}
