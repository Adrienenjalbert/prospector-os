import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

    const body = await req.json()
    const { config_type, config_data } = body as { config_type: string; config_data: unknown }

    if (!config_type || !config_data) {
      return NextResponse.json({ error: 'config_type and config_data required' }, { status: 400 })
    }

    const columnMap: Record<string, string> = {
      icp: 'icp_config',
      scoring: 'scoring_config',
      funnel: 'funnel_config',
      signals: 'signal_config',
    }

    const column = columnMap[config_type]
    if (!column) {
      return NextResponse.json({ error: `Invalid config_type: ${config_type}` }, { status: 400 })
    }

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
