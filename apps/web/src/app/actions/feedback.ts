'use server'

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

async function resolveRepContext(): Promise<{
  tenant_id: string
  rep_crm_id: string
}> {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, rep_profile_id')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) throw new Error('No profile')

  const { data: rep } = await supabase
    .from('rep_profiles')
    .select('crm_id')
    .eq('id', profile.rep_profile_id)
    .single()

  return {
    tenant_id: profile.tenant_id,
    rep_crm_id: rep?.crm_id ?? user.id,
  }
}

export async function recordFeedback(
  accountId: string,
  reaction: 'positive' | 'negative'
) {
  const ctx = await resolveRepContext()
  const supabase = getServiceSupabase()
  await supabase.from('alert_feedback').insert({
    tenant_id: ctx.tenant_id,
    rep_crm_id: ctx.rep_crm_id,
    alert_type: 'daily_briefing',
    company_id: accountId,
    reaction,
    action_taken: false,
  })
}

export async function markCompleted(accountId: string) {
  const ctx = await resolveRepContext()
  const supabase = getServiceSupabase()
  await supabase.from('alert_feedback').insert({
    tenant_id: ctx.tenant_id,
    rep_crm_id: ctx.rep_crm_id,
    alert_type: 'daily_briefing',
    company_id: accountId,
    reaction: 'positive',
    action_taken: true,
  })
}

export async function getCompletedToday(): Promise<string[]> {
  const ctx = await resolveRepContext()
  const supabase = getServiceSupabase()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { data } = await supabase
    .from('alert_feedback')
    .select('company_id')
    .eq('tenant_id', ctx.tenant_id)
    .eq('rep_crm_id', ctx.rep_crm_id)
    .eq('action_taken', true)
    .gte('created_at', todayStart.toISOString())

  return (data ?? []).map((r) => r.company_id).filter(Boolean)
}
