import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { emitAgentEvent } from '@prospector/core'

/**
 * POST /api/admin/wiki/schema
 *
 * Save the per-tenant CLAUDE.md (tenant_wiki_schema row). Bumps
 * version monotonically. Optimistic concurrency via expected_version
 * — if someone else saved between the editor's load and this submit,
 * the request is rejected so the admin reloads with the latest.
 */

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const requestSchema = z.object({
  body_md: z.string().min(50).max(20000),
  expected_version: z.number().int().nonnegative(),
})

export async function POST(req: Request) {
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

  // Optimistic concurrency: read the current version, check it matches.
  const { data: existing } = await supabase
    .from('tenant_wiki_schema')
    .select('body_md, version')
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle()

  const currentVersion = existing?.version ?? 0
  if (currentVersion !== parsed.data.expected_version) {
    return NextResponse.json(
      {
        error: `Version mismatch — expected ${parsed.data.expected_version}, current ${currentVersion}. Reload to see latest.`,
      },
      { status: 409 },
    )
  }

  const newVersion = currentVersion + 1
  const nowIso = new Date().toISOString()
  const { error: upsertErr } = await supabase
    .from('tenant_wiki_schema')
    .upsert(
      {
        tenant_id: profile.tenant_id,
        body_md: parsed.data.body_md,
        version: newVersion,
        updated_at: nowIso,
        updated_by: user.id,
      },
      { onConflict: 'tenant_id' },
    )

  if (upsertErr) {
    return NextResponse.json(
      { error: `Save failed: ${upsertErr.message}` },
      { status: 500 },
    )
  }

  // Audit + telemetry. The schema is the most leverage-y file in the
  // tenant — every save lands in calibration_ledger so it can be
  // rolled back via the existing API.
  await supabase.from('calibration_ledger').insert({
    tenant_id: profile.tenant_id,
    change_type: 'wiki_schema',
    target_path: `tenant_wiki_schema.body_md`,
    before_value: { body_md: existing?.body_md ?? '', version: currentVersion },
    after_value: { body_md: parsed.data.body_md, version: newVersion },
    observed_lift: null,
    applied_by: user.id,
    notes: `Wiki schema saved as v${newVersion} (${parsed.data.body_md.length} chars)`,
  })

  await emitAgentEvent(supabase, {
    tenant_id: profile.tenant_id,
    user_id: user.id,
    event_type: 'wiki_page_compiled',
    payload: {
      page_id: 'schema',
      kind: 'index_root',
      slug: 'schema',
      action: 'schema_saved',
      version: newVersion,
    },
  })

  return NextResponse.json({ version: newVersion, updated_at: nowIso })
}
