import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AuditLogClient } from './audit-log-client'

export const metadata = { title: 'Admin audit log' }
export const dynamic = 'force-dynamic'

/**
 * Phase 3 T2.1 — admin audit log surface.
 *
 * Shows every admin write to a tenant config or proposal: who, when,
 * what changed, before vs after. Read by the operator to answer
 * "who changed the ICP weights last Tuesday" without grepping
 * server logs.
 *
 * Source: `admin_audit_log` table (migration 011) populated by
 * `recordAdminAction` from every admin write path
 * (`/api/admin/config`, `/api/admin/calibration`, `apply_*` agent
 * tools).
 *
 * Page is gated to admin / revops / manager roles. RLS allows other
 * tenant users to read the table directly via API, but the UI is
 * intentionally admin-only.
 */
export default async function AdminAuditLogPage(props: {
  searchParams: Promise<{ action?: string; user_id?: string }>
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

  const searchParams = await props.searchParams
  const actionFilter = searchParams.action ?? null
  const userFilter = searchParams.user_id ?? null

  let query = supabase
    .from('admin_audit_log')
    .select('id, user_id, action, target, before, after, metadata, occurred_at')
    .eq('tenant_id', profile.tenant_id)
    .order('occurred_at', { ascending: false })
    .limit(100)

  if (actionFilter) query = query.eq('action', actionFilter)
  if (userFilter) query = query.eq('user_id', userFilter)

  const { data: rows, error } = await query

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-semibold text-zinc-100">Admin audit log</h1>
        <p className="mt-4 rounded-md border border-red-800/50 bg-red-950/20 p-4 text-sm text-red-300">
          Failed to load audit log: {error.message}
        </p>
      </div>
    )
  }

  // Distinct list of actions seen on this tenant — drives the filter
  // dropdown so the operator only sees actions that actually occurred
  // (vs. a static enum that includes future T3.2 / T3.3 / T2.3
  // entries that never fire).
  const seenActions = Array.from(
    new Set((rows ?? []).map((r) => (r.action as string) ?? '')),
  ).sort()

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-100">Admin audit log</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every admin write to a tenant config or proposal: who, when, what
          changed, before vs after. Append-only since Phase 3 T2.1 — older
          actions did not produce audit rows. Filtering uses URL params
          (<code className="font-mono">?action=…</code>,
          <code className="font-mono">?user_id=…</code>).
        </p>
      </header>

      <AuditLogClient
        rows={(rows ?? []).map((r) => ({
          id: r.id as string,
          user_id: (r.user_id as string | null) ?? null,
          action: r.action as string,
          target: r.target as string,
          before: r.before as Record<string, unknown> | null,
          after: r.after as Record<string, unknown> | null,
          metadata: (r.metadata as Record<string, unknown> | null) ?? {},
          occurred_at: r.occurred_at as string,
        }))}
        seenActions={seenActions}
        currentActionFilter={actionFilter}
        currentUserFilter={userFilter}
      />
    </div>
  )
}
