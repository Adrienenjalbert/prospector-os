import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

// Cap the JSON blob written to `tenants.<config>_config` so a malformed
// or malicious payload cannot bloat the row past Postgres's practical
// JSONB ceiling. 256KB is generous (real configs ship ~5–20KB).
const MAX_CONFIG_BYTES = 256 * 1024

const CONFIG_TYPE_TO_COLUMN = {
  icp: 'icp_config',
  scoring: 'scoring_config',
  funnel: 'funnel_config',
  signals: 'signal_config',
} as const

// `config_data` itself is JSONB — we don't lock the inner shape because
// each config type has its own schema in `packages/core/src/types/config.ts`
// and the calibration pipeline will validate downstream. We do require it
// to be a plain object (not array, not primitive) so an attacker can't
// overwrite the entire column with a string or null.
const configDataSchema = z.record(z.unknown())

const requestSchema = z.object({
  config_type: z.enum(['icp', 'scoring', 'funnel', 'signals']),
  config_data: configDataSchema,
})

export async function POST(req: Request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

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

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }

    if (profile.role !== 'admin' && profile.role !== 'revops') {
      return NextResponse.json({ error: 'Admin or RevOps role required' }, { status: 403 })
    }

    const rawText = await req.text()
    if (rawText.length > MAX_CONFIG_BYTES) {
      return NextResponse.json(
        { error: `Payload exceeds ${MAX_CONFIG_BYTES} bytes` },
        { status: 413 },
      )
    }

    let body: unknown
    try {
      body = JSON.parse(rawText)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = requestSchema.safeParse(body)
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

    const { config_type, config_data } = parsed.data
    const column = CONFIG_TYPE_TO_COLUMN[config_type]

    const { error } = await supabase
      .from('tenants')
      .update({ [column]: config_data })
      .eq('id', profile.tenant_id)

    if (error) {
      console.error('[admin/config]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/config]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
