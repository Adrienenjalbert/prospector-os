import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

/**
 * Calibration ledger rollback (A2.1).
 *
 * The PRD has long promised that every adaptation is reversible — "Roll
 * back = re-apply the `before_value` — one DB op" (CURSOR_PRD §13). The
 * ledger schema has stored `before_value` since migration 002, but no
 * API or UI has ever surfaced rollback. This endpoint closes that gap.
 *
 * Behaviour:
 *
 *   POST /api/admin/calibration/[id]/rollback
 *   Authorization: Bearer <user supabase access token>
 *
 *   1. Verifies the user is an admin of the same tenant as the ledger row.
 *   2. Refuses to rollback rows whose `change_type` is itself `rollback`
 *      — there is no "undo of an undo" semantic that produces useful
 *      audit trails. Operators can manually re-apply the original
 *      proposal instead.
 *   3. Refuses to rollback rows older than 30 days. The point of the
 *      ledger is recovery from a recently-bad change; far-historical
 *      rollbacks should go through a fresh calibration_proposal so the
 *      analyser can validate the regression with current data.
 *   4. Resolves the writeback target column from `target_path` (e.g.
 *      `tenants.scoring_config.propensity_weights`) and applies the
 *      `before_value` payload back into that path.
 *   5. Inserts a NEW ledger row with `change_type='rollback'` so the
 *      adaptation log shows the un-do as a first-class adaptation.
 *
 * Failure modes:
 *
 *   - Ledger row not found / not owned by tenant -> 404
 *   - User not admin                              -> 403
 *   - Auto-undo of a rollback                     -> 422
 *   - target_path not understood by this version  -> 422 (forward-compat)
 *   - Writeback fails                             -> 500 (no ledger row
 *     written; the change neither applied nor logged so retry is safe)
 */

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const ROLLBACK_MAX_AGE_DAYS = 30

// Map ledger `target_path` -> { tenants column to update, JSONB sub-path
// inside the column to overwrite }. Forward-compatible: unknown paths
// return 422 rather than blindly writing somewhere arbitrary.
const TARGET_PATH_REGISTRY: Record<
  string,
  { column: string; jsonbPath: string[] }
> = {
  'tenants.scoring_config.propensity_weights': {
    column: 'scoring_config',
    jsonbPath: ['propensity_weights'],
  },
  'tenants.icp_config': {
    column: 'icp_config',
    jsonbPath: [],
  },
  'tenants.signal_config': {
    column: 'signal_config',
    jsonbPath: [],
  },
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: ledgerId } = await params
    const idCheck = z.string().uuid().safeParse(ledgerId)
    if (!idCheck.success) {
      return NextResponse.json({ error: 'Invalid ledger id' }, { status: 400 })
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

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { data: ledgerRow } = await supabase
      .from('calibration_ledger')
      .select('id, tenant_id, change_type, target_path, before_value, after_value, applied_at')
      .eq('id', ledgerId)
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle()

    if (!ledgerRow) {
      return NextResponse.json(
        { error: 'Ledger entry not found in your tenant' },
        { status: 404 },
      )
    }

    // Refuse to undo an undo. This is a guardrail against rollback
    // spirals — if a customer wants to re-apply the original proposal
    // they should approve a fresh one through /admin/calibration so the
    // calibration analyser validates the change against current data.
    if (ledgerRow.change_type === 'rollback') {
      return NextResponse.json(
        {
          error:
            'Cannot rollback a rollback. Approve a fresh calibration proposal to re-apply the original change.',
        },
        { status: 422 },
      )
    }

    // Refuse to rollback far-historical rows. Stops a stale ledger row
    // from being weaponised against current production state.
    const ageDays = ledgerRow.applied_at
      ? (Date.now() - new Date(ledgerRow.applied_at).getTime()) / 86400000
      : 0
    if (ageDays > ROLLBACK_MAX_AGE_DAYS) {
      return NextResponse.json(
        {
          error: `Ledger entry is older than ${ROLLBACK_MAX_AGE_DAYS} days. Use the calibration workflow to propose a current change instead.`,
        },
        { status: 422 },
      )
    }

    const target = TARGET_PATH_REGISTRY[ledgerRow.target_path]
    if (!target) {
      return NextResponse.json(
        {
          error: `Rollback target '${ledgerRow.target_path}' is not yet supported.`,
        },
        { status: 422 },
      )
    }

    // Read the current value of the column so we can layer the rollback
    // into the JSONB tree without clobbering sibling fields.
    const { data: tenant, error: readErr } = await supabase
      .from('tenants')
      .select(target.column)
      .eq('id', profile.tenant_id)
      .single()

    if (readErr || !tenant) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 },
      )
    }

    // Dynamic column name forces a cast-through-unknown to satisfy
    // PostgREST's generic typing. Same pattern as the sibling
    // /api/admin/calibration/route.ts approve handler.
    const currentColumnValue =
      ((tenant as unknown as Record<string, unknown>)[target.column] as
        | Record<string, unknown>
        | null) ?? {}

    const restoredColumnValue =
      target.jsonbPath.length === 0
        ? (ledgerRow.before_value ?? {})
        : { ...currentColumnValue, [target.jsonbPath[0]]: ledgerRow.before_value }

    const { error: writeErr } = await supabase
      .from('tenants')
      .update({ [target.column]: restoredColumnValue })
      .eq('id', profile.tenant_id)

    if (writeErr) {
      return NextResponse.json(
        { error: `Rollback writeback failed: ${writeErr.message}` },
        { status: 500 },
      )
    }

    // Audit trail — the rollback itself is a ledger event so /admin/adaptation
    // shows the un-do alongside the original change. We swap before/after
    // semantically: the OLD `after_value` becomes the NEW `before_value`,
    // and the OLD `before_value` becomes the NEW `after_value`.
    const { error: ledgerErr } = await supabase
      .from('calibration_ledger')
      .insert({
        tenant_id: profile.tenant_id,
        change_type: 'rollback',
        target_path: ledgerRow.target_path,
        before_value: ledgerRow.after_value,
        after_value: ledgerRow.before_value,
        observed_lift: null,
        applied_by: user.id,
        notes: `Rollback of calibration_ledger.${ledgerId}`,
      })

    if (ledgerErr) {
      // Don't unwind the writeback — the change is already applied. Log
      // loudly so an operator can backfill the audit row manually if
      // this ever happens (rare; the insert is a single row).
      console.error('[admin/calibration/rollback] ledger insert failed', ledgerErr)
    }

    return NextResponse.json({
      status: 'rolled_back',
      ledger_id: ledgerId,
      target_path: ledgerRow.target_path,
    })
  } catch (err) {
    console.error('[admin/calibration/rollback]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
