import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { executePendingWrite } from '@/lib/crm-writes/executor'
import { emitAgentEvent } from '@prospector/core'

/**
 * Phase 3 T3.1 — POST /api/agent/approve.
 *
 * Approves and synchronously executes a previously-staged
 * `pending_crm_writes` row. The flow is:
 *
 *   1. Validate auth + parse body { pending_id }.
 *   2. SELECT the pending row, verify it belongs to the caller's
 *      tenant, verify status='pending', verify not expired.
 *   3. UPDATE status='approved' + executed_by_user_id=caller +
 *      executed_at=NOW() (best-effort optimistic lock — see notes).
 *   4. Hand off to `executePendingWrite` which performs the
 *      actual HubSpot mutation.
 *   5. UPDATE again with the final status: 'executed' on success
 *      (with external_record_id) or 'rejected' on failure (with
 *      error message).
 *   6. Emit `action_invoked` so attribution + bandit can learn.
 *   7. Return the executor's result so the chat UI can quote the
 *      new CRM record.
 *
 * SECURITY NOTES:
 *
 *   - The pending_id alone is the approval token. It's a UUID
 *     (server-generated, unguessable). The caller must be auth'd
 *     AND be in the same tenant as the row.
 *   - We do NOT require the caller to be the same user who staged
 *     the write. A manager approving a CSM's draft is an explicit
 *     supported flow; the audit trail captures both via
 *     requested_by_user_id + executed_by_user_id.
 *   - The status='pending' check is done in the WHERE of the
 *     UPDATE so concurrent double-clicks race to the DB and the
 *     loser sees `rowsAffected=0` (returned as
 *     `already_processed`). Prevents double-execution.
 *
 * RATE LIMITING: not added here — the model can only stage ~10
 * writes per turn (token budget) and the rep can only click 10
 * chips per turn. A future flood-protection middleware can sit
 * in front of this route; not in T3.1 scope.
 */

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const requestSchema = z.object({
  pending_id: z.string().uuid('pending_id must be a UUID'),
})

interface PendingRow {
  id: string
  tenant_id: string
  tool_slug: string
  target_urn: string
  proposed_args: Record<string, unknown>
  status: string
  expires_at: string
  agent_interaction_id: string | null
  requested_by_user_id: string | null
}

export async function POST(req: Request) {
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

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', issues: parsed.error.issues.map((i) => i.message) },
        { status: 400 },
      )
    }
    const { pending_id } = parsed.data

    // Step 2: tenant-scoped fetch of the pending row.
    const { data: row, error: rowErr } = await supabase
      .from('pending_crm_writes')
      .select(
        'id, tenant_id, tool_slug, target_urn, proposed_args, status, expires_at, agent_interaction_id, requested_by_user_id',
      )
      .eq('tenant_id', profile.tenant_id)
      .eq('id', pending_id)
      .maybeSingle()

    if (rowErr) {
      console.error('[agent/approve] row fetch', rowErr)
      return NextResponse.json({ error: rowErr.message }, { status: 500 })
    }
    if (!row) {
      return NextResponse.json(
        { error: 'Pending write not found in this tenant' },
        { status: 404 },
      )
    }
    const pending = row as PendingRow

    // Lifecycle gates. Each is a distinct status code so the chat UI
    // can surface different copy.
    if (pending.status === 'executed') {
      return NextResponse.json(
        { error: 'Already executed', status: 'already_executed' },
        { status: 409 },
      )
    }
    if (pending.status === 'rejected') {
      return NextResponse.json(
        { error: 'Previously rejected', status: 'rejected' },
        { status: 409 },
      )
    }
    if (pending.status === 'expired') {
      return NextResponse.json(
        { error: 'Pending write expired — re-stage from the chat', status: 'expired' },
        { status: 410 },
      )
    }
    if (Date.parse(pending.expires_at) <= Date.now()) {
      // TTL elapsed; mark it so future polls show the right state.
      await supabase
        .from('pending_crm_writes')
        .update({ status: 'expired' })
        .eq('id', pending.id)
        .eq('status', 'pending')
      return NextResponse.json(
        { error: 'Pending write expired — re-stage from the chat', status: 'expired' },
        { status: 410 },
      )
    }
    if (pending.status !== 'pending') {
      return NextResponse.json(
        { error: `Unexpected status: ${pending.status}` },
        { status: 409 },
      )
    }

    // Step 3: optimistic lock to 'approved'. The WHERE includes
    // status='pending' so a concurrent double-click loses the race
    // and returns rowsAffected=0.
    const { data: lockedRows, error: lockErr } = await supabase
      .from('pending_crm_writes')
      .update({
        status: 'approved',
        executed_by_user_id: user.id,
        executed_at: new Date().toISOString(),
      })
      .eq('id', pending.id)
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'pending')
      .select('id')

    if (lockErr) {
      return NextResponse.json({ error: lockErr.message }, { status: 500 })
    }
    if (!lockedRows || lockedRows.length === 0) {
      // Another request beat us to it.
      return NextResponse.json(
        { error: 'Already processed by another request', status: 'already_processed' },
        { status: 409 },
      )
    }

    // Step 4: execute. Synchronously — the rep is waiting on the
    // chat for confirmation.
    const result = await executePendingWrite(supabase, {
      id: pending.id,
      tenant_id: pending.tenant_id,
      tool_slug: pending.tool_slug,
      target_urn: pending.target_urn,
      proposed_args: pending.proposed_args,
    })

    // Step 5: persist final status.
    if (result.ok) {
      await supabase
        .from('pending_crm_writes')
        .update({
          status: 'executed',
          external_record_id: result.external_record_id,
        })
        .eq('id', pending.id)
    } else {
      // Rollback to allow re-attempt: mark rejected with the error
      // string. The chat UI surfaces this so the rep can decide to
      // re-stage or contact support.
      await supabase
        .from('pending_crm_writes')
        .update({
          status: 'rejected',
          error: result.error,
        })
        .eq('id', pending.id)
    }

    // Step 6: telemetry. action_invoked is what the bandit + ROI
    // attribution learn from — without this event, an approved write
    // doesn't count toward time-saved or influenced-ARR.
    if (pending.agent_interaction_id) {
      await emitAgentEvent(supabase, {
        tenant_id: pending.tenant_id,
        interaction_id: pending.agent_interaction_id,
        user_id: user.id,
        event_type: 'action_invoked',
        subject_urn: pending.target_urn,
        payload: {
          action_id: pending.tool_slug,
          pending_id: pending.id,
          execution_status: result.ok ? 'executed' : 'rejected',
          external_record_id: result.ok ? result.external_record_id : null,
        },
      })
    }

    if (result.ok) {
      return NextResponse.json({
        status: 'executed',
        pending_id: pending.id,
        external_record_id: result.external_record_id,
        data: result.data,
        citations: result.citations,
      })
    }
    return NextResponse.json(
      {
        status: 'rejected',
        pending_id: pending.id,
        error: result.error,
      },
      { status: 502 },
    )
  } catch (err) {
    console.error('[agent/approve] POST', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
