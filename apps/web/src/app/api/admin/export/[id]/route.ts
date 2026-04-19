import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Phase 3 T2.3 — GET /api/admin/export/[id].
 *
 * Polls the status of a previously-enqueued data export. The
 * `[id]` path parameter is the `request_id` returned by POST
 * /api/admin/export. The endpoint returns:
 *
 *   - 404 if no workflow_run exists for that request_id (in this
 *     tenant).
 *   - 200 with `{ status, progress, url?, expires_at? }` otherwise.
 *
 * The download URL is only included when the workflow status is
 * `completed`. Tenant scoping is enforced by joining workflow_runs.
 * idempotency_key (`export:<request_id>`) AND tenant_id, so a
 * tenant cannot poll another tenant's export by guessing request
 * ids.
 *
 * No auth feature flag check here — if the export endpoint was
 * disabled mid-flight, the caller should still be able to retrieve
 * any export they previously triggered. The data-export workflow
 * itself does not check the env flag.
 */

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface UploadStepResult {
  url?: string
  size_bytes?: number
  expires_at?: string
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = getServiceSupabase()

    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const token = authHeader.slice(7)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id, role')
      .eq('id', user.id)
      .single()
    if (!profile?.tenant_id) {
      return NextResponse.json({ error: 'No tenant' }, { status: 403 })
    }
    // Allow non-admin polling — the requester might be an admin who
    // triggered the export; anyone in the same tenant who knows the
    // request_id can see status. The download URL itself is
    // unguessable, so wider read access is fine and helps when an
    // admin shares the request id with a colleague.

    const { id: requestId } = await params

    const { data: run, error } = await supabase
      .from('workflow_runs')
      .select('id, status, current_step, step_state, error, created_at, completed_at')
      .eq('tenant_id', profile.tenant_id)
      .eq('workflow_name', 'data_export')
      .eq('idempotency_key', `export:${requestId}`)
      .maybeSingle()

    if (error) {
      console.error('[admin/export] GET status', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!run) {
      return NextResponse.json(
        { error: 'Export not found in this tenant' },
        { status: 404 },
      )
    }

    const stepState =
      (run.step_state as Record<string, unknown> | null) ?? {}
    const upload = stepState.upload as UploadStepResult | undefined

    return NextResponse.json({
      request_id: requestId,
      workflow_run_id: run.id,
      status: run.status,
      current_step: run.current_step,
      created_at: run.created_at,
      completed_at: run.completed_at,
      error: run.error,
      url: run.status === 'completed' ? upload?.url ?? null : null,
      size_bytes:
        run.status === 'completed' ? upload?.size_bytes ?? null : null,
      expires_at:
        run.status === 'completed' ? upload?.expires_at ?? null : null,
    })
  } catch (err) {
    console.error('[admin/export] GET', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
