import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { SkillBar } from '@/components/agent/skill-bar'
import { OBJECTS_DEALS_SKILLS } from '@/lib/agent/skills'

export const metadata = { title: 'Deals — Ontology' }
export const dynamic = 'force-dynamic'

interface Row {
  id: string
  name: string
  stage: string
  value: number | null
  days_in_stage: number
  is_stalled: boolean
  is_closed: boolean
  company_id: string
}

export default async function DealsObjectPage() {
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
    .from('opportunities')
    .select('id, name, stage, value, days_in_stage, is_stalled, is_closed, company_id')
    .eq('tenant_id', profile.tenant_id)
    .eq('is_closed', false)
    .order('value', { ascending: false })
    .limit(100)

  const rows: Row[] = (data ?? []) as Row[]

  return (
    <div className="px-6 py-6">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Deals</h1>
          <p className="text-xs text-zinc-500">{rows.length} open opportunities</p>
        </div>
        <SkillBar skills={OBJECTS_DEALS_SKILLS} pageContext={{ page: 'objects/deals' }} />
      </header>

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Stage</th>
              <th className="px-4 py-2 text-right font-medium">Value</th>
              <th className="px-4 py-2 text-right font-medium">Days in stage</th>
              <th className="px-4 py-2 text-left font-medium">Health</th>
            </tr>
          </thead>
          <tbody className="text-zinc-200">
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800 hover:bg-zinc-900/40">
                <td className="px-4 py-2">
                  <Link href={`/objects/deals/${r.id}`} className="text-sky-300 hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-zinc-400">{r.stage}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.value != null ? `$${Math.round(r.value).toLocaleString()}` : '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.days_in_stage}</td>
                <td className="px-4 py-2">
                  {r.is_stalled ? (
                    <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[11px] text-rose-300">Stalled</span>
                  ) : (
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[11px] text-emerald-300">Active</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">No open deals.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
