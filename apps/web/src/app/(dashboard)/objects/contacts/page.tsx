import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { SkillBar } from '@/components/agent/skill-bar'
import { OBJECTS_CONTACTS_SKILLS } from '@/lib/agent/skills'

export const metadata = { title: 'Contacts — Ontology' }
export const dynamic = 'force-dynamic'

export default async function ContactsObjectPage() {
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
    .from('contacts')
    .select('id, first_name, last_name, title, seniority, is_champion, is_decision_maker, company_id')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <div className="px-6 py-6">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Contacts</h1>
          <p className="text-xs text-zinc-500">{(data ?? []).length} contacts</p>
        </div>
        <SkillBar skills={OBJECTS_CONTACTS_SKILLS} pageContext={{ page: 'objects/contacts' }} />
      </header>

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Title</th>
              <th className="px-4 py-2 text-left font-medium">Seniority</th>
              <th className="px-4 py-2 text-left font-medium">Role</th>
            </tr>
          </thead>
          <tbody className="text-zinc-200">
            {(data ?? []).map((c) => (
              <tr key={c.id} className="border-t border-zinc-800 hover:bg-zinc-900/40">
                <td className="px-4 py-2">{[c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown'}</td>
                <td className="px-4 py-2 text-zinc-400">{c.title ?? '—'}</td>
                <td className="px-4 py-2 text-zinc-400">{c.seniority ?? '—'}</td>
                <td className="px-4 py-2">
                  {c.is_champion && <span className="mr-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">Champion</span>}
                  {c.is_decision_maker && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">Decision</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
