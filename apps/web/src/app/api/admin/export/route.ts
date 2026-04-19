import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { recordAdminAction } from '@prospector/core'
import { enqueueDataExport, runDataExport } from '@/lib/workflows'

/**
 * Phase 3 T2.3 — POST /api/admin/export.
 *
 * Triggers a data-export workflow for the caller's tenant. The
 * endpoint:
 *
 *   1. Validates the auth + admin role.
 *   2. Generates a `request_id` (UUID).
 *   3. Enqueues the workflow with `idempotencyKey = export:<request_id>`.
 *   4. Records the admin action (T2.1 audit log) with the request_id
 *      in metadata so an auditor can join workflow_runs ↔ audit log.
 *   5. Kicks off the run inline so the operator doesn't wait up to
 *      the cron interval. The cron drain still processes any retry.
 *   6. Returns `{ request_id, status_url }` for polling.
 *
 * FEATURE FLAG: gated on `ADMIN_EXPORT_ENABLED=on`. Off in production
 * until RevOps signs off on the runbook (`docs/operations/offboarding.md`).
 *
 * RATE LIMIT: enforced via the workflow's idempotency key — duplicate
 * request_ids resume the existing run rather than re-exporting.
 * The endpoint accepts a client-supplied request_id for that reason
 * (idempotent retries from the UI's submit button) but generates one
 * if absent.
 */

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface ExportRequestBody {
  request_id?: string
}

export async function POST(req: Request) {
  if (process.env.ADMIN_EXPORT_ENABLED !== 'on') {
    return NextResponse.json(
      {
        error: 'Data export is disabled',
        hint: 'Set ADMIN_EXPORT_ENABLED=on in the environment to enable.',
      },
      { status: 503 },
    )
  }

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
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
    }

    let body: ExportRequestBody = {}
    try {
      body = (await req.json()) as ExportRequestBody
    } catch {
      // Empty body is fine — request_id is optional.
    }

    const requestId =
      typeof body.request_id === 'string' && body.request_id.length > 0
        ? body.request_id
        : crypto.randomUUID()

    // Look up the rep_profile to thread the slack_user_id into the
    // workflow's notify step. Best-effort — a missing slack id just
    // means the notify step records `notified: false` and the
    // operator picks up the URL via the polling endpoint.
    // Look up the rep_profile to thread the slack_user_id into the
    // workflow's notify step. Re-SELECT user_profiles with
    // rep_profile_id this time — the earlier SELECT only fetched
    // tenant_id + role for the auth gate.
    let slackUserId: string | null = null
    const { data: profileWithRep } = await supabase
      .from('user_profiles')
      .select('rep_profile_id')
      .eq('id', user.id)
      .single()
    const repProfileId = (profileWithRep as { rep_profile_id?: string | null } | null)
      ?.rep_profile_id
    if (repProfileId) {
      const { data: rep } = await supabase
        .from('rep_profiles')
        .select('slack_user_id')
        .eq('id', repProfileId)
        .maybeSingle()
      slackUserId =
        (rep as { slack_user_id?: string | null } | null)?.slack_user_id ??
        null
    }

    const run = await enqueueDataExport(supabase, profile.tenant_id, {
      request_id: requestId,
      requested_by_user_id: user.id,
      slack_user_id: slackUserId,
    })

    // Phase 3 T2.1 audit log — record the export request. Captures
    // who, when, and the request_id so a future auditor can join
    // back to workflow_runs.id by `idempotency_key = export:<id>`.
    void recordAdminAction(supabase, {
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: 'tenant.export',
      target: `tenants[${profile.tenant_id}]`,
      before: null,
      after: { workflow_run_id: run.id, request_id: requestId },
      metadata: {
        request_id: requestId,
        notified_via: slackUserId ? 'slack' : 'manual',
      },
    })

    // Kick off the run inline. The drain cron will pick up retries
    // if this throws; we don't await on the cron path because it
    // can run minutes later.
    void runDataExport(supabase, run.id).catch((err) => {
      console.warn('[admin/export] inline run threw:', err)
    })

    return NextResponse.json(
      {
        request_id: requestId,
        workflow_run_id: run.id,
        status_url: `/api/admin/export/${requestId}`,
        status: run.status,
      },
      { status: 202 },
    )
  } catch (err) {
    console.error('[admin/export] POST', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
