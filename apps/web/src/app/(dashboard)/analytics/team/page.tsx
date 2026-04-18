import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'

export const metadata = { title: 'Team — Analytics' }
export const dynamic = 'force-dynamic'

/**
 * Team analytics — placeholder until real team aggregation ships.
 *
 * The previous version of this page rendered hardcoded demo data which gave
 * managers a false sense of what the OS could see. Per the v1 plan we don't
 * ship plausible-but-fake numbers: if the aggregation doesn't exist, the
 * page says so, and redirects to the ontology browser where real data lives.
 */
export default async function TeamPage() {
  let userRole = 'rep'
  let tenantId: string | null = null
  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role, tenant_id')
        .eq('id', user.id)
        .single()
      userRole = profile?.role ?? 'rep'
      tenantId = profile?.tenant_id ?? null
    }
  } catch {
    // fall back
  }

  if (!['manager', 'admin', 'revops'].includes(userRole)) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Team</h1>
        <p className="mt-4 text-zinc-500">
          Team performance is available for managers and above.
        </p>
      </div>
    )
  }

  let repCount = 0
  let companyCount = 0
  if (tenantId) {
    const supabase = await createSupabaseServer()
    const [repsRes, companiesRes] = await Promise.all([
      supabase.from('rep_profiles').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('companies').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    ])
    repCount = repsRes.count ?? 0
    companyCount = companiesRes.count ?? 0
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Team Performance</h1>
      <p className="mt-1 text-sm text-zinc-500">Real team aggregation ships once we have per-rep close history in production.</p>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Reps</div>
            <div className="mt-1 font-mono text-2xl tabular-nums text-zinc-100">{repCount}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Companies</div>
            <div className="mt-1 font-mono text-2xl tabular-nums text-zinc-100">{companyCount}</div>
          </div>
        </div>
        <div className="mt-5 rounded-md border border-dashed border-zinc-800 bg-zinc-950/30 p-4 text-sm text-zinc-400">
          Leaderboard, coaching cards, and attainment charts will render here once the
          nightly team-aggregation workflow starts writing to <code className="text-zinc-300">team_metrics</code>.
          In the meantime, use the{' '}
          <Link href="/objects/companies" className="text-sky-300 hover:underline">
            ontology browser
          </Link>{' '}
          for company-level truth and{' '}
          <Link href="/admin/roi" className="text-sky-300 hover:underline">
            the ROI dashboard
          </Link>{' '}
          for adoption + quality trends.
        </div>
      </div>
    </div>
  )
}
