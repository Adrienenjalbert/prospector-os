import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  RETENTION_DEFAULT_DAYS,
  RETENTION_MAX_DAYS,
  RETENTION_TABLE_NAMES,
  defaultRetentionDays,
  isRetentionTableName,
  validateRetentionOverride,
  type RetentionTableName,
} from '@prospector/core'

/**
 * `/api/admin/retention` — Phase 3 T1.3.
 *
 *   GET   → list current policies (resolved: override or default per table).
 *   POST  → upsert a per-tenant override for one table.
 *   DELETE → remove an override (revert to default).
 *
 * Auth: admin or revops role required (same gate as other admin routes).
 *
 * Validation invariants (per OQ-4):
 *   - `table_name` must be in the closed allowlist
 *     (`RETENTION_TABLE_NAMES`).
 *   - `retention_days` must be a positive integer.
 *   - `retention_days >= RETENTION_DEFAULT_DAYS[table]` (longer-only —
 *     per-tenant overrides may only LENGTHEN the window). Enforced via
 *     `validateRetentionOverride`.
 *   - `retention_days <= RETENTION_MAX_DAYS` (7-year ceiling). Same.
 *
 * The `retention_policies.min_retention_days` column on the row is the
 * platform default at write time — a tamper-evident snapshot used by
 * the nightly drift audit (see migration 010 comment).
 */

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function authorise(req: Request) {
  const supabase = getServiceSupabase()

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const token = authHeader.slice(7)
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 403 }) }
  }
  if (profile.role !== 'admin' && profile.role !== 'revops') {
    return {
      error: NextResponse.json(
        { error: 'Admin or RevOps role required' },
        { status: 403 },
      ),
    }
  }
  return { supabase, tenantId: profile.tenant_id as string, userId: user.id }
}

const upsertSchema = z.object({
  table_name: z.string().refine(isRetentionTableName, {
    message: `table_name must be one of: ${RETENTION_TABLE_NAMES.join(', ')}`,
  }),
  retention_days: z.number().int().min(1).max(RETENTION_MAX_DAYS),
})

export async function GET(req: Request) {
  const ok = await authorise(req)
  if ('error' in ok) return ok.error
  const { supabase, tenantId } = ok

  const { data: overrides, error } = await supabase
    .from('retention_policies')
    .select('table_name, retention_days, min_retention_days, updated_at')
    .eq('tenant_id', tenantId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const overrideMap = new Map<string, { retention_days: number; updated_at: string }>()
  for (const r of overrides ?? []) {
    overrideMap.set(r.table_name as string, {
      retention_days: r.retention_days as number,
      updated_at: r.updated_at as string,
    })
  }

  // Always return an entry per allowlisted table so the UI can render
  // the full set without a separate "show defaults" lookup.
  const resolved = RETENTION_TABLE_NAMES.map((table) => {
    const override = overrideMap.get(table)
    return {
      table_name: table,
      default_days: defaultRetentionDays(table),
      max_days: RETENTION_MAX_DAYS,
      // The CURRENT effective window. UI shows this as the "active"
      // value; the default is shown as the floor.
      effective_days: override?.retention_days ?? defaultRetentionDays(table),
      is_override: Boolean(override),
      override_updated_at: override?.updated_at ?? null,
    }
  })

  return NextResponse.json({ policies: resolved })
}

export async function POST(req: Request) {
  const ok = await authorise(req)
  if ('error' in ok) return ok.error
  const { supabase, tenantId } = ok

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = upsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request shape',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  const { table_name, retention_days } = parsed.data
  // After Zod's refinement we know table_name is a valid
  // RetentionTableName, but TypeScript doesn't narrow through `.refine`
  // — assert via the type guard for static safety.
  const table = table_name as RetentionTableName

  const validation = validateRetentionOverride(table, retention_days)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 })
  }

  // The min_retention_days snapshot pins the platform default at write
  // time — drift audit can later compare this to RETENTION_DEFAULT_DAYS
  // to flag overrides that were valid then but would be too short now.
  const { error } = await supabase
    .from('retention_policies')
    .upsert(
      {
        tenant_id: tenantId,
        table_name: table,
        retention_days,
        min_retention_days: defaultRetentionDays(table),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,table_name' },
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    table_name: table,
    retention_days,
    default_days: defaultRetentionDays(table),
  })
}

const deleteSchema = z.object({
  table_name: z.string().refine(isRetentionTableName, {
    message: `table_name must be one of: ${RETENTION_TABLE_NAMES.join(', ')}`,
  }),
})

export async function DELETE(req: Request) {
  const ok = await authorise(req)
  if ('error' in ok) return ok.error
  const { supabase, tenantId } = ok

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request shape',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  const { error } = await supabase
    .from('retention_policies')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('table_name', parsed.data.table_name)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, reverted_to_default: true })
}
