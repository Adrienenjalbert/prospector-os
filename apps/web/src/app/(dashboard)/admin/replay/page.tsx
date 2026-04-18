import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'

export const metadata = { title: 'Agent replay' }
export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ interaction_id?: string }>
}

/**
 * Agent replay tool — given a past interaction id, show the question,
 * response, citations, and tool calls recorded at the time. A "replay
 * against current prompt" button (stub for v1) will re-run the same input
 * through the live agent so prompt-optimizer rollouts can be inspected.
 */
export default async function ReplayPage({ searchParams }: Props) {
  const { interaction_id } = await searchParams
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) redirect('/login')
  if (!['admin', 'revops'].includes(profile.role ?? '')) {
    redirect('/inbox')
  }

  if (!interaction_id) {
    const { data: recent } = await supabase
      .from('agent_interaction_outcomes')
      .select('id, query_summary, response_summary, created_at, feedback')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false })
      .limit(30)

    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-2xl font-semibold text-zinc-100">Agent replay</h1>
        <p className="mt-1 text-sm text-zinc-500">Pick an interaction to inspect.</p>
        <ul className="mt-4 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {(recent ?? []).map((r) => (
            <li key={r.id} className="px-3 py-2">
              <Link href={`/admin/replay?interaction_id=${r.id}`} className="block hover:underline">
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm text-zinc-100">{r.query_summary ?? '(no question)'}</span>
                  <span className="text-xs text-zinc-500">
                    {r.feedback ? `[${r.feedback}] ` : ''}{new Date(r.created_at).toLocaleString()}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const [interactionRes, citationsRes, eventsRes] = await Promise.all([
    supabase
      .from('agent_interaction_outcomes')
      .select('*')
      .eq('id', interaction_id)
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle(),
    supabase
      .from('agent_citations')
      .select('claim_text, source_type, source_id, source_url')
      .eq('interaction_id', interaction_id),
    supabase
      .from('agent_events')
      .select('event_type, payload, occurred_at')
      .eq('interaction_id', interaction_id)
      .order('occurred_at', { ascending: true }),
  ])

  const interaction = interactionRes.data
  const citations = citationsRes.data ?? []
  const events = eventsRes.data ?? []

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/admin/replay" className="text-xs text-zinc-500 hover:text-zinc-300">← All interactions</Link>
      <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Replay {interaction_id.slice(0, 8)}</h1>

      {interaction && (
        <section className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Question</div>
          <p className="mt-1 text-sm text-zinc-100">{interaction.query_summary ?? '—'}</p>
          <div className="mt-3 text-[11px] uppercase tracking-wide text-zinc-500">Response</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-100">{interaction.response_summary ?? '—'}</p>
          {interaction.feedback && (
            <div className="mt-3 inline-block rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
              feedback: {interaction.feedback}
            </div>
          )}
        </section>
      )}

      <section className="mt-4">
        <h2 className="text-sm font-semibold text-zinc-200">Citations ({citations.length})</h2>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {citations.map((c, i) => (
            <li key={i} className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-xs text-zinc-300">
              {c.source_type}: {c.claim_text}
            </li>
          ))}
          {citations.length === 0 && <span className="text-xs text-zinc-500">No citations recorded.</span>}
        </ul>
      </section>

      <section className="mt-4">
        <h2 className="text-sm font-semibold text-zinc-200">Event timeline ({events.length})</h2>
        <ul className="mt-2 space-y-1 font-mono text-[11px]">
          {events.map((e, i) => (
            <li key={i} className="flex gap-3 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1">
              <span className="text-zinc-500">{new Date(e.occurred_at).toISOString().slice(11, 19)}</span>
              <span className="text-zinc-300">{e.event_type}</span>
              <span className="truncate text-zinc-500">{JSON.stringify(e.payload)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-lg border border-dashed border-zinc-800 bg-zinc-950/30 p-4">
        <p className="text-sm text-zinc-400">
          Replay against current prompt: coming once the prompt-version pinning lands. For now this
          page gives you the full historical record so you can verify what the agent actually said
          and which sources it used.
        </p>
      </section>
    </div>
  )
}
