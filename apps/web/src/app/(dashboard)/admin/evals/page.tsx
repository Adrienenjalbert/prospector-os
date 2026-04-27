import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { EvalCasesClient } from '@/components/admin/eval-cases-client'

export const metadata = { title: 'Eval cases' }
export const dynamic = 'force-dynamic'

/**
 * Eval review surface (A2.4).
 *
 * Closes the loop the strategic review flagged: the `eval_growth`
 * workflow auto-promotes production failures into `pending_review`
 * cases, but until now no admin path existed to ACCEPT them. The eval
 * suite stayed static at 75 cases — directly contradicting MISSION's
 * "eval suite grows from real production failures" promise.
 *
 * Server component does the auth + tenant scoping; the client component
 * handles the dynamic accept/reject loop with optimistic refresh.
 *
 * Role gate: admin or revops. Same pattern as `/admin/calibration`.
 */
export default async function EvalCasesPage() {
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

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-100">Eval cases</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Real production failures auto-promoted by the nightly{' '}
          <code className="rounded bg-zinc-900 px-1 text-[10px]">eval_growth</code>{' '}
          workflow. Accept to add to the eval suite that gates every PR;
          reject to discard. Accepted cases enter CI on the next{' '}
          <code className="rounded bg-zinc-900 px-1 text-[10px]">npm run evals</code> run.
        </p>
      </header>

      <div className="mt-6">
        <EvalCasesClient tenantId={profile.tenant_id} />
      </div>
    </div>
  )
}
