import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { SkillBar } from '@/components/agent/skill-bar'
import { OBJECTS_TRANSCRIPTS_SKILLS } from '@/lib/agent/skills'

export const metadata = { title: 'Transcripts — Ontology' }
export const dynamic = 'force-dynamic'

export default async function TranscriptsObjectPage() {
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
    .from('transcripts')
    .select('id, title, source, summary, themes, sentiment_score, occurred_at')
    .eq('tenant_id', profile.tenant_id)
    .order('occurred_at', { ascending: false })
    .limit(50)

  return (
    <div className="px-6 py-6">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Transcripts</h1>
          <p className="text-xs text-zinc-500">
            {(data ?? []).length} calls ingested. Search by semantic similarity via the agent (&quot;find calls about pricing&quot;).
          </p>
        </div>
        <SkillBar skills={OBJECTS_TRANSCRIPTS_SKILLS} pageContext={{ page: 'objects/transcripts' }} />
      </header>

      <ul className="space-y-2">
        {(data ?? []).map((t) => (
          <li key={t.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-zinc-100">{t.title ?? 'Untitled'}</div>
              <div className="text-xs text-zinc-500">
                {t.source} · {new Date(t.occurred_at).toLocaleDateString()}
              </div>
            </div>
            {t.summary && <p className="mt-1 text-sm text-zinc-400">{t.summary}</p>}
            {Array.isArray(t.themes) && t.themes.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {t.themes.map((th: string) => (
                  <span key={th} className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-[10px] text-zinc-300">
                    {th}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
        {(!data || data.length === 0) && (
          <li className="rounded-md border border-dashed border-zinc-800 px-3 py-8 text-center text-zinc-500">
            No transcripts yet. Connect Gong or Fireflies to start ingesting.
          </li>
        )}
      </ul>
    </div>
  )
}
