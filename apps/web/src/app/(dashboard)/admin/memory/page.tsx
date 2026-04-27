import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { MEMORY_KIND_LABELS, type MemoryKind } from '@prospector/core'
import { MemoryListClient, type AdminMemoryRow } from './memory-list-client'

export const metadata = { title: 'Tenant memory' }
export const dynamic = 'force-dynamic'

/**
 * /admin/memory — customer-facing knowledge graph.
 *
 * Every memory mined by the smart-memory layer (derive-icp Phase 1,
 * persona / theme / competitor / glossary / motion / playbook / stage
 * miners in later phases) lands here as `proposed`. An admin reviews
 * the title, body, evidence URNs, and confidence, then approves /
 * pins (forces injection) / archives.
 *
 * Building this surface explicitly so customers can SEE what the OS
 * has learned about their business — UX principle #7 ("visible
 * self-improvement"). A black-box agent that "knows" your ICP without
 * being able to show its work is exactly the trust gap the
 * adoption-research report flags as fatal.
 *
 * The action API (POST /api/admin/memory/[id]) writes the same
 * `calibration_ledger` rows that the rollback API in
 * api/admin/calibration/[id]/rollback/route.ts already understands —
 * so memory transitions are reversible alongside scoring/prompt
 * changes, no parallel rollback path needed.
 */
export default async function AdminMemoryPage() {
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

  const [memoriesRes, countsRes] = await Promise.all([
    supabase
      .from('tenant_memories')
      .select(
        'id, kind, scope, title, body, evidence, confidence, status, source_workflow, derived_at, approved_at, approved_by',
      )
      .eq('tenant_id', profile.tenant_id)
      .order('status', { ascending: true })
      .order('derived_at', { ascending: false })
      .limit(200),
    supabase
      .from('tenant_memories')
      .select('kind, status', { count: 'exact', head: false })
      .eq('tenant_id', profile.tenant_id),
  ])

  const memories = (memoriesRes.data ?? []) as AdminMemoryRow[]

  const counts: Record<string, { proposed: number; approved: number; pinned: number; archived: number }> = {}
  for (const row of (countsRes.data ?? []) as Array<{ kind: string; status: string }>) {
    if (!counts[row.kind]) counts[row.kind] = { proposed: 0, approved: 0, pinned: 0, archived: 0 }
    if (row.status in counts[row.kind]) {
      counts[row.kind][row.status as keyof (typeof counts)[string]] += 1
    }
  }

  const kinds = Object.keys(MEMORY_KIND_LABELS) as MemoryKind[]

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-100">What we know about your business</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Every pattern below was mined from your CRM, your transcripts, and your closed-deal outcomes.
        Approve to inject into the agent prompt; pin to force injection; archive to drop.
        Every transition is reversible from <span className="font-mono text-xs text-zinc-400">/admin/adaptation</span>.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kinds.map((kind) => {
          const c = counts[kind] ?? { proposed: 0, approved: 0, pinned: 0, archived: 0 }
          const total = c.proposed + c.approved + c.pinned + c.archived
          return (
            <div key={kind} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500">{MEMORY_KIND_LABELS[kind]}</div>
              <div className="mt-1 flex items-baseline justify-between">
                <div className="text-lg font-semibold text-zinc-100 tabular-nums">{total}</div>
                <div className="text-[11px] text-zinc-500">
                  <span className="text-amber-400">{c.proposed}</span> /{' '}
                  <span className="text-emerald-400">{c.approved + c.pinned}</span>
                </div>
              </div>
            </div>
          )
        })}
      </section>

      <MemoryListClient initialMemories={memories} />
    </div>
  )
}
