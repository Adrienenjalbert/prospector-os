import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Daily push budget — enforces the signal-to-noise rule at the dispatcher.
 *
 * Reps already drown in notifications. No matter how useful each individual
 * message is, three-plus per day hits the point where the rep stops reading
 * and adoption collapses. This module is the hard gate that protects that.
 *
 * Rules:
 *   - High frequency preference:   3 pushes / rep / day
 *   - Medium frequency preference: 2 pushes / rep / day (default)
 *   - Low frequency preference:    1 push  / rep / day
 *
 * A "push" is any proactive message we initiated (brief, digest, alert,
 * escalation). Chat replies the rep requested don't count.
 *
 * Counting uses `agent_events.event_type = 'proactive_push_sent'`. The
 * dispatcher records this event on a successful send. Failed sends don't
 * count (nothing actually landed in the rep's Slack).
 */

export type AlertFrequency = 'high' | 'medium' | 'low'

const LIMIT_BY_FREQUENCY: Record<AlertFrequency, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

export interface PushBudgetCheck {
  allowed: boolean
  used: number
  limit: number
  reason?: 'over_budget' | 'frequency_low'
}

/**
 * Check whether a proactive push is allowed for this rep today.
 *
 * Returns `allowed: false` if the rep has already hit their daily cap; the
 * caller should skip the send and either bundle into the next digest or
 * drop silently. Either way, no user-visible error.
 */
export async function checkPushBudget(
  supabase: SupabaseClient,
  tenantId: string,
  repUserId: string,
  frequency: AlertFrequency = 'medium',
): Promise<PushBudgetCheck> {
  const limit = LIMIT_BY_FREQUENCY[frequency]
  if (limit <= 0) {
    return { allowed: false, used: 0, limit, reason: 'frequency_low' }
  }

  const startOfDayUtc = new Date()
  startOfDayUtc.setUTCHours(0, 0, 0, 0)

  const { count } = await supabase
    .from('agent_events')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('user_id', repUserId)
    .eq('event_type', 'proactive_push_sent')
    .gte('occurred_at', startOfDayUtc.toISOString())

  const used = count ?? 0
  return {
    allowed: used < limit,
    used,
    limit,
    reason: used >= limit ? 'over_budget' : undefined,
  }
}

/**
 * Record that a push landed. Called from the dispatcher on successful send.
 * Errors are swallowed — telemetry must never break a send.
 */
export async function recordPushSent(
  supabase: SupabaseClient,
  tenantId: string,
  repUserId: string | null,
  payload: {
    trigger_type: string
    subject_urn?: string | null
    interaction_id?: string | null
  },
): Promise<void> {
  try {
    await supabase.from('agent_events').insert({
      tenant_id: tenantId,
      user_id: repUserId,
      interaction_id: payload.interaction_id ?? null,
      role: 'rep',
      event_type: 'proactive_push_sent',
      subject_urn: payload.subject_urn ?? null,
      payload: {
        trigger_type: payload.trigger_type,
      },
    })
  } catch (err) {
    console.warn('[push-budget] record failed:', err)
  }
}
