import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { emitAgentEvent, urn } from '@prospector/core'

/**
 * POST /api/admin/memory/[id]
 *
 * Lifecycle transitions for a `tenant_memories` row. Mirrors the shape
 * of the calibration approval API in api/admin/calibration/route.ts so
 * the audit trail is identical:
 *
 *   1. Auth: Bearer token from Supabase session.
 *   2. RBAC: only `admin` (the role that owns calibration) can write.
 *   3. Action: { approve | pin | archive | reset }.
 *   4. Update tenant_memories.status (+ approved_at / approved_by where
 *      relevant).
 *   5. Insert calibration_ledger row so the existing rollback API in
 *      api/admin/calibration/[id]/rollback/route.ts can revert it
 *      without a parallel rollback path.
 *   6. Emit memory_* event for /admin/adaptation telemetry.
 */

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const ACTIONS = ['approve', 'pin', 'archive', 'reset'] as const
type Action = (typeof ACTIONS)[number]

const requestSchema = z.object({
  action: z.enum(ACTIONS),
  pin_reason: z.string().max(200).optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: memoryId } = await params

  if (!isUuid(memoryId)) {
    return NextResponse.json({ error: 'Invalid memory id' }, { status: 400 })
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
      {
        error: 'Invalid request shape',
        issues: parsed.error.issues.map((i) => i.message),
      },
      { status: 400 },
    )
  }

  const { action, pin_reason } = parsed.data

  const { data: memory } = await supabase
    .from('tenant_memories')
    .select('id, kind, status, title, scope')
    .eq('id', memoryId)
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle()

  if (!memory) {
    return NextResponse.json({ error: 'Memory not found' }, { status: 404 })
  }

  const beforeStatus = memory.status as string
  const update = updateForAction(action, user.id, pin_reason)

  const { data: updated, error: updateErr } = await supabase
    .from('tenant_memories')
    .update(update.fields)
    .eq('id', memoryId)
    .select(
      'id, kind, scope, title, body, evidence, confidence, status, source_workflow, derived_at, approved_at, approved_by',
    )
    .single()

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: `Update failed: ${updateErr?.message ?? 'no row returned'}` },
      { status: 500 },
    )
  }

  // Audit trail — same table the rollback API reads from. The rollback
  // API restores `before_value` + `after_value` so we record exactly
  // those two on every memory transition. `change_type` is greppable
  // ("memory_status") so the admin audit feed can group memory
  // transitions distinctly from scoring / prompt changes.
  await supabase.from('calibration_ledger').insert({
    tenant_id: profile.tenant_id,
    change_type: 'memory_status',
    target_path: `tenant_memories.${memoryId}.status`,
    before_value: { status: beforeStatus },
    after_value: { status: updated.status, pin_reason: pin_reason ?? null },
    observed_lift: null,
    applied_by: user.id,
    notes: `Memory ${memory.kind} "${memory.title.slice(0, 80)}" → ${update.eventType}`,
  })

  await emitAgentEvent(supabase, {
    tenant_id: profile.tenant_id,
    user_id: user.id,
    event_type: update.eventType,
    subject_urn: urn.memory(profile.tenant_id, memoryId),
    payload: {
      memory_id: memoryId,
      kind: memory.kind,
      before_status: beforeStatus,
      pin_reason: pin_reason ?? null,
    },
  })

  return NextResponse.json({ memory: updated })
}

function updateForAction(
  action: Action,
  userId: string,
  pinReason?: string,
): {
  fields: Record<string, unknown>
  eventType: 'memory_approved' | 'memory_pinned' | 'memory_archived'
} {
  void pinReason // recorded in the ledger row, not on tenant_memories itself
  const nowIso = new Date().toISOString()
  switch (action) {
    case 'approve':
      return {
        fields: {
          status: 'approved',
          approved_by: userId,
          approved_at: nowIso,
          updated_at: nowIso,
        },
        eventType: 'memory_approved',
      }
    case 'pin':
      return {
        fields: {
          status: 'pinned',
          approved_by: userId,
          approved_at: nowIso,
          updated_at: nowIso,
        },
        eventType: 'memory_pinned',
      }
    case 'archive':
      return {
        fields: { status: 'archived', updated_at: nowIso },
        eventType: 'memory_archived',
      }
    case 'reset':
      // Brings an archived / superseded row back into the proposal
      // queue so the admin can re-evaluate after the data has changed.
      return {
        fields: {
          status: 'proposed',
          approved_by: null,
          approved_at: null,
          updated_at: nowIso,
        },
        eventType: 'memory_archived',
      }
    default: {
      const exhaustive: never = action
      throw new Error(`Unknown action: ${exhaustive as string}`)
    }
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
