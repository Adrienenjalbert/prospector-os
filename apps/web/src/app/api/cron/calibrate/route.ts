import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase, recordCronRun } from '@/lib/cron-auth'
import { aggregateFeedback, shouldDisableTrigger, shouldRaiseThreshold } from '@prospector/core'
import type { TriggerType } from '@prospector/core'

const ALL_TRIGGER_TYPES: TriggerType[] = [
  'deal_stall',
  'signal_detected',
  'priority_shift',
  'funnel_gap',
  'win_loss_insight',
  'daily_briefing',
]

const OVERRIDE_EXPIRY_DAYS = 30

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()

  const startTime = Date.now()

  try {
    const supabase = getServiceSupabase()

    const { data: tenants } = await supabase
      .from('tenants')
      .select('id')
      .eq('active', true)

    if (!tenants?.length) {
      return NextResponse.json({ message: 'No active tenants' })
    }

    let totalOverrides = 0

    for (const tenant of tenants) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()

      const { data: feedbacks } = await supabase
        .from('alert_feedback')
        .select('*')
        .eq('tenant_id', tenant.id)
        .gte('created_at', thirtyDaysAgo)

      if (!feedbacks?.length) continue

      const { data: reps } = await supabase
        .from('rep_profiles')
        .select('crm_id, slack_user_id')
        .eq('tenant_id', tenant.id)
        .eq('active', true)

      if (!reps?.length) continue

      for (const rep of reps) {
        const repFeedbacks = feedbacks
          .filter((f) => f.rep_crm_id === rep.crm_id)
          .map((f) => ({
            ...f,
            alert_type: f.alert_type as TriggerType,
            reaction: f.reaction as 'positive' | 'negative' | 'ignored',
          }))

        if (repFeedbacks.length < 5) continue

        const summaries = aggregateFeedback(repFeedbacks, ALL_TRIGGER_TYPES)

        for (const summary of summaries) {
          if (summary.total < 10) continue

          const expiresAt = new Date(Date.now() + OVERRIDE_EXPIRY_DAYS * 86400000).toISOString()

          if (shouldDisableTrigger(summary)) {
            await supabase.from('trigger_overrides').upsert({
              tenant_id: tenant.id,
              rep_crm_id: rep.crm_id,
              trigger_type: summary.trigger_type,
              override_action: 'disable',
              reason: `Auto-disabled: ${summary.positive_rate}% positive rate, ${Math.round((summary.ignored / summary.total) * 100)}% ignored (${summary.total} samples)`,
              feedback_summary: summary,
              active: true,
              expires_at: expiresAt,
            }, {
              onConflict: 'tenant_id,COALESCE(rep_crm_id, \'__tenant__\'),trigger_type',
            })
            totalOverrides++
          } else if (shouldRaiseThreshold(summary)) {
            await supabase.from('trigger_overrides').upsert({
              tenant_id: tenant.id,
              rep_crm_id: rep.crm_id,
              trigger_type: summary.trigger_type,
              override_action: 'raise_threshold',
              threshold_adjustment: { min_propensity: 70 },
              reason: `Auto-raised threshold: ${summary.positive_rate}% positive rate (${summary.total} samples)`,
              feedback_summary: summary,
              active: true,
              expires_at: expiresAt,
            }, {
              onConflict: 'tenant_id,COALESCE(rep_crm_id, \'__tenant__\'),trigger_type',
            })
            totalOverrides++
          }
        }
      }

      await expireOldOverrides(supabase, tenant.id)
    }

    await recordCronRun('/api/cron/calibrate', 'success', Date.now() - startTime, totalOverrides)
    return NextResponse.json({ overrides: totalOverrides })
  } catch (err) {
    console.error('[cron/calibrate]', err)
    await recordCronRun('/api/cron/calibrate', 'error', Date.now() - startTime, 0, err instanceof Error ? err.message : 'Unknown error')
    return NextResponse.json({ error: 'Calibration failed' }, { status: 500 })
  }
}

async function expireOldOverrides(
  supabase: ReturnType<typeof getServiceSupabase>,
  tenantId: string
) {
  await supabase
    .from('trigger_overrides')
    .update({ active: false })
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .lt('expires_at', new Date().toISOString())
}
