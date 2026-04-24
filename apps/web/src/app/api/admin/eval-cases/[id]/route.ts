import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

/**
 * Eval-case review endpoint (A2.4).
 *
 * Closes the loop the strategic review flagged: today eval-growth
 * promotes failures into `pending_review` but no admin path exists
 * to ACCEPT them, so the eval suite never grows from real production
 * failures (contradicting the MISSION promise).
 *
 * Flow:
 *
 *   POST /api/admin/eval-cases/[id]   { action: 'accept' | 'reject' }
 *   Authorization: Bearer <user supabase access token>
 *
 *   - Accept: status -> 'accepted'. The eval CLI loads accepted cases
 *     (from DB) on top of the static GOLDEN_EVAL_CASES, so the case
 *     enters the next CI run.
 *   - Reject: status -> 'rejected' + optional notes. Reviewer's
 *     judgement is preserved in case the same failure pattern comes
 *     back later.
 *
 * Audit columns (`reviewed_by`, `reviewed_at`) are populated.
 */

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const requestSchema = z.object({
  action: z.enum(['accept', 'reject']),
  notes: z.string().max(2000).optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: caseId } = await params
    const idCheck = z.string().uuid().safeParse(caseId)
    if (!idCheck.success) {
      return NextResponse.json({ error: 'Invalid case id' }, { status: 400 })
    }

    const supabase = getServiceSupabase()

    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const token = authHeader.slice(7)
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id, role')
      .eq('id', user.id)
      .single()
    if (!profile || !['admin', 'revops'].includes(profile.role ?? '')) {
      return NextResponse.json({ error: 'Admin/RevOps required' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      )
    }
    const { action, notes } = parsed.data

    // Tenant-scoped lookup so a user can only review their own cases.
    // Cross-tenant cases (tenant_id IS NULL — the seed set) are not
    // touched by this endpoint; they live in goldens.ts.
    const { data: existing } = await supabase
      .from('eval_cases')
      .select('id, status, source_interaction_id')
      .eq('id', caseId)
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json(
        { error: 'Case not found in your tenant' },
        { status: 404 },
      )
    }
    if (existing.status !== 'pending_review' && existing.status !== 'pending') {
      return NextResponse.json(
        { error: `Case is already ${existing.status}` },
        { status: 409 },
      )
    }

    const newStatus = action === 'accept' ? 'accepted' : 'rejected'
    const { error: updateErr } = await supabase
      .from('eval_cases')
      .update({
        status: newStatus,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
        // Preserve original auto-generated notes; append the reviewer's
        // notes when present. Concatenation rather than overwrite so we
        // keep the "auto-promoted from X" provenance.
        ...(notes
          ? { notes: notes }
          : {}),
      })
      .eq('id', caseId)

    if (updateErr) {
      return NextResponse.json(
        { error: `Update failed: ${updateErr.message}` },
        { status: 500 },
      )
    }

    return NextResponse.json({ status: newStatus, case_id: caseId })
  } catch (err) {
    console.error('[admin/eval-cases]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
