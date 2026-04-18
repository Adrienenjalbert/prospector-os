import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { SkillBar } from '@/components/agent/skill-bar'
import { OBJECTS_SIGNALS_SKILLS } from '@/lib/agent/skills'

export const metadata = { title: 'Signals — Ontology' }
export const dynamic = 'force-dynamic'

export default async function SignalsObjectPage() {
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
    .from('signals')
    .select('id, signal_type, title, urgency, weighted_score, detected_at, company_id')
    .eq('tenant_id', profile.tenant_id)
    .order('detected_at', { ascending: false })
    .limit(100)

  return (
    <div className="px-6 py-6">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Signals</h1>
          <p className="text-xs text-zinc-500">{(data ?? []).length} recent signals</p>
        </div>
        <SkillBar skills={OBJECTS_SIGNALS_SKILLS} pageContext={{ page: 'objects/signals' }} />
      </header>

      <ul className="space-y-1.5">
        {(data ?? []).map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm">
            <div>
              <span className="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[10px] uppercase text-zinc-300">{s.signal_type}</span>
              <span className="ml-2 text-zinc-100">{s.title}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>{s.urgency}</span>
              <span>score {s.weighted_score?.toFixed?.(0) ?? '—'}</span>
              <span>{new Date(s.detected_at).toLocaleDateString()}</span>
            </div>
          </li>
        ))}
        {(!data || data.length === 0) && (
          <li className="rounded-md border border-dashed border-zinc-800 px-3 py-8 text-center text-zinc-500">
            No signals detected yet.
          </li>
        )}
      </ul>
    </div>
  )
}
