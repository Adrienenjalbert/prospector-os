import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { SkillBar } from '@/components/agent/skill-bar'
import { OBJECTS_COMPANIES_SKILLS } from '@/lib/agent/skills'

export const metadata = { title: 'Companies — Ontology' }
export const dynamic = 'force-dynamic'

interface CompanyRow {
  id: string
  name: string
  industry: string | null
  icp_tier: string | null
  icp_score: number | null
  priority_tier: string | null
  expected_revenue: number | null
  propensity: number | null
  owner_name: string | null
}

function tierColor(tier: string | null): string {
  switch (tier) {
    case 'HOT':
    case 'A':
      return 'bg-rose-500/20 text-rose-300 ring-rose-500/30'
    case 'WARM':
    case 'B':
      return 'bg-amber-500/20 text-amber-300 ring-amber-500/30'
    case 'COOL':
    case 'C':
      return 'bg-sky-500/20 text-sky-300 ring-sky-500/30'
    default:
      return 'bg-zinc-700/40 text-zinc-400 ring-zinc-600/40'
  }
}

export default async function CompaniesObjectPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) redirect('/login')

  const { data } = await supabase
    .from('companies')
    .select('id, name, industry, icp_tier, icp_score, priority_tier, expected_revenue, propensity, owner_name')
    .eq('tenant_id', profile.tenant_id)
    .order('expected_revenue', { ascending: false })
    .limit(100)

  const rows: CompanyRow[] = (data ?? []) as CompanyRow[]

  return (
    <div className="px-6 py-6">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Companies</h1>
          <p className="text-xs text-zinc-500">{rows.length} objects · tenant-scoped · ranked by expected revenue</p>
        </div>
        <SkillBar skills={OBJECTS_COMPANIES_SKILLS} pageContext={{ page: 'objects/companies' }} />
      </header>

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Industry</th>
              <th className="px-4 py-2 text-left font-medium">ICP</th>
              <th className="px-4 py-2 text-left font-medium">Priority</th>
              <th className="px-4 py-2 text-right font-medium">Propensity</th>
              <th className="px-4 py-2 text-right font-medium">Expected Rev</th>
              <th className="px-4 py-2 text-left font-medium">Owner</th>
            </tr>
          </thead>
          <tbody className="text-zinc-200">
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800 hover:bg-zinc-900/40">
                <td className="px-4 py-2">
                  <Link href={`/objects/companies/${r.id}`} className="text-sky-300 hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-zinc-400">{r.industry ?? '—'}</td>
                <td className="px-4 py-2">
                  <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] ring-1 ${tierColor(r.icp_tier)}`}>
                    {r.icp_tier ?? '—'} {r.icp_score != null ? `· ${r.icp_score.toFixed(0)}` : ''}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] ring-1 ${tierColor(r.priority_tier)}`}>
                    {r.priority_tier ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.propensity != null ? `${r.propensity.toFixed(0)}` : '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.expected_revenue != null ? `$${Math.round(r.expected_revenue).toLocaleString()}` : '—'}
                </td>
                <td className="px-4 py-2 text-zinc-400">{r.owner_name ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-zinc-500">
                  No companies yet. Connect HubSpot from Settings to populate this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
