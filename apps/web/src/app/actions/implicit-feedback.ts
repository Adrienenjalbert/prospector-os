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

async function resolveRepContext() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
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

export type ImplicitSignalType =
  | 'card_expanded'
  | 'card_drafted'
  | 'card_skipped'
  | 'agent_copy'
  | 'agent_deep_dive'
  | 'mailto_click'
  | 'account_viewed'

export async function trackImplicitSignal(
  signalType: ImplicitSignalType,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>
) {
  try {
    const ctx = await resolveRepContext()
    const supabase = getServiceSupabase()

    await supabase.from('implicit_signals').insert({
      tenant_id: ctx.tenant_id,
      rep_crm_id: ctx.rep_crm_id,
      signal_type: signalType,
      entity_type: entityType,
      entity_id: entityId,
      metadata: metadata ?? {},
    })
  } catch {
    // Silent failure — implicit tracking should never break the UX
  }
}

export async function recordAgentFeedback(
  interactionId: string,
  feedback: 'positive' | 'negative',
  reason?: string
) {
  try {
    const ctx = await resolveRepContext()
    const supabase = getServiceSupabase()

    const update: Record<string, unknown> = { feedback }
    if (reason) {
      update.downstream_outcome = reason
    }

    await supabase
      .from('agent_interaction_outcomes')
      .update(update)
      .eq('id', interactionId)
      .eq('tenant_id', ctx.tenant_id)
  } catch {
    // Silent failure
  }
}

export async function recordOutcomeAction(
  accountId: string,
  outcomeAction: string
) {
  try {
    const ctx = await resolveRepContext()
    const supabase = getServiceSupabase()

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    await supabase
      .from('alert_feedback')
      .update({ outcome_action: outcomeAction })
      .eq('tenant_id', ctx.tenant_id)
      .eq('rep_crm_id', ctx.rep_crm_id)
      .eq('company_id', accountId)
      .eq('action_taken', true)
      .gte('created_at', todayStart.toISOString())
  } catch {
    // Silent failure
  }
}

export async function submitWeeklyPulse(
  topAccountId: string | null,
  accountOutcome: string,
  priorityAccuracy: string
) {
  const ctx = await resolveRepContext()
  const supabase = getServiceSupabase()

  const today = new Date()
  const dayOfWeek = today.getDay()
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - ((dayOfWeek + 6) % 7))
  const weekStartStr = weekStart.toISOString().split('T')[0]

  await supabase.from('weekly_pulse_responses').upsert({
    tenant_id: ctx.tenant_id,
    rep_crm_id: ctx.rep_crm_id,
    week_start: weekStartStr,
    top_account_id: topAccountId,
    account_outcome: accountOutcome,
    priority_accuracy: priorityAccuracy,
  }, { onConflict: 'tenant_id,rep_crm_id,week_start' })
}
