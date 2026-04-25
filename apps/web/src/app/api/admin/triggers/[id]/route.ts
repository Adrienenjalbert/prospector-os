import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  markTriggerActed,
  markTriggerDismissed,
} from '@/lib/triggers/bandit'

/**
 * POST /api/admin/triggers/[id] — Phase 7 (Section 6.1).
 *
 * Lifecycle transitions for a `triggers` row. Mirrors the auth +
 * audit pattern from /api/admin/memory/[id] and /api/admin/wiki/[id].
 *
 * Actions:
 *   acted     → status='acted', prior_alpha += 1
 *   dismissed → status='dismissed', prior_beta += 1
 *
 * Both transitions land a calibration_ledger row so the rollback API
 * can reverse them and so the admin audit feed groups them with
 * memory + wiki transitions.
 */

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const requestSchema = z.object({
  action: z.enum(['acted', 'dismissed']),
  reason: z.string().max(300).nullable().optional(),
  outcome_event_id: z.string().uuid().nullable().optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: triggerId } = await params
  if (!isUuid(triggerId)) {
    return NextResponse.json({ error: 'Invalid trigger id' }, { status: 400 })
  }

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
    return NextResponse.json({ error: 'Profile not found' }, { status: 401 })
  }
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
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

  // Read the row before transition for calibration_ledger
  // before_value snapshot.
  const { data: trigger } = await supabase
    .from('triggers')
    .select('id, pattern, status, trigger_score, prior_alpha, prior_beta')
    .eq('tenant_id', profile.tenant_id)
    .eq('id', triggerId)
    .maybeSingle()
  if (!trigger) {
    return NextResponse.json({ error: 'Trigger not found' }, { status: 404 })
  }
  if (trigger.status !== 'open') {
    return NextResponse.json(
      { error: `Trigger is already ${trigger.status}` },
      { status: 409 },
    )
  }

  const beforeStatus = trigger.status as string
  const before = {
    status: beforeStatus,
    prior_alpha: trigger.prior_alpha,
    prior_beta: trigger.prior_beta,
  }

  let result: { ok: boolean; reason?: string }
  if (parsed.data.action === 'acted') {
    result = await markTriggerActed(supabase, profile.tenant_id as string, triggerId, {
      actedBy: user.id,
      outcomeEventId: parsed.data.outcome_event_id ?? null,
    })
  } else {
    result = await markTriggerDismissed(supabase, profile.tenant_id as string, triggerId, {
      reason: parsed.data.reason ?? undefined,
      dismissedBy: user.id,
    })
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: `Action failed: ${result.reason ?? 'unknown'}` },
      { status: 500 },
    )
  }

  // Audit trail.
  await supabase.from('calibration_ledger').insert({
    tenant_id: profile.tenant_id,
    change_type: 'trigger_status',
    target_path: `triggers.${triggerId}.status`,
    before_value: before,
    after_value: {
      status: parsed.data.action,
      reason: parsed.data.reason ?? null,
      outcome_event_id: parsed.data.outcome_event_id ?? null,
    },
    observed_lift: null,
    applied_by: user.id,
    notes: `Trigger ${trigger.pattern} → ${parsed.data.action}`,
  })

  return NextResponse.json({ ok: true })
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}
