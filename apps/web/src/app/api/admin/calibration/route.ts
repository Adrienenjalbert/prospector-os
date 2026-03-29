import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: Request) {
  try {
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

    const body = await req.json()
    const { proposal_id, action } = body as { proposal_id: string; action: 'approve' | 'reject' }

    if (!proposal_id || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const { data: proposal } = await supabase
      .from('calibration_proposals')
      .select('*')
      .eq('id', proposal_id)
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'pending')
      .single()

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found or already processed' }, { status: 404 })
    }

    if (action === 'reject') {
      await supabase
        .from('calibration_proposals')
        .update({
          status: 'rejected',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', proposal_id)

      return NextResponse.json({ status: 'rejected' })
    }

    const configField = proposal.config_type === 'scoring'
      ? 'scoring_config'
      : proposal.config_type === 'icp'
        ? 'icp_config'
        : 'signal_config'

    const { data: tenant } = await supabase
      .from('tenants')
      .select(configField)
      .eq('id', profile.tenant_id)
      .single()

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    const currentConfig = tenant[configField] as Record<string, unknown>

    if (proposal.config_type === 'scoring') {
      const updatedConfig = {
        ...currentConfig,
        propensity_weights: proposal.proposed_config,
      }

      await supabase
        .from('tenants')
        .update({ [configField]: updatedConfig })
        .eq('id', profile.tenant_id)
    }

    await supabase
      .from('calibration_proposals')
      .update({
        status: 'approved',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        applied_at: new Date().toISOString(),
      })
      .eq('id', proposal_id)

    return NextResponse.json({ status: 'approved' })
  } catch (err) {
    console.error('[admin/calibration]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
