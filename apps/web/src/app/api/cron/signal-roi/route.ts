import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase, recordCronRun } from '@/lib/cron-auth'

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

    let totalUpdated = 0

    for (const tenant of tenants) {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString()

      const { data: signals } = await supabase
        .from('signals')
        .select('id, company_id, signal_type, detected_at')
        .eq('tenant_id', tenant.id)
        .gte('detected_at', ninetyDaysAgo)
        .eq('led_to_action', false)

      if (!signals?.length) continue

      const companyIds = [...new Set(signals.map((s) => s.company_id))]

      const { data: feedbacks } = await supabase
        .from('alert_feedback')
        .select('company_id, action_taken, created_at')
        .eq('tenant_id', tenant.id)
        .in('company_id', companyIds)
        .eq('action_taken', true)

      const actionCompanies = new Set(
        (feedbacks ?? []).map((f) => f.company_id).filter(Boolean)
      )

      const { data: progressedOpps } = await supabase
        .from('opportunities')
        .select('company_id, updated_at')
        .eq('tenant_id', tenant.id)
        .in('company_id', companyIds)
        .eq('is_closed', false)

      const progressedCompanyDates = new Map<string, string>()
      for (const opp of progressedOpps ?? []) {
        if (opp.updated_at) {
          progressedCompanyDates.set(opp.company_id, opp.updated_at)
        }
      }

      for (const signal of signals) {
        const detectedAt = new Date(signal.detected_at)
        const windowEnd = new Date(detectedAt.getTime() + 14 * 86400000)

        const ledToAction = actionCompanies.has(signal.company_id)

        const oppUpdated = progressedCompanyDates.get(signal.company_id)
        const ledToDealProgress = oppUpdated
          ? new Date(oppUpdated) >= detectedAt && new Date(oppUpdated) <= windowEnd
          : false

        if (ledToAction || ledToDealProgress) {
          await supabase
            .from('signals')
            .update({
              led_to_action: ledToAction,
              led_to_deal_progress: ledToDealProgress,
            })
            .eq('id', signal.id)

          totalUpdated++
        }
      }
    }

    await recordCronRun('/api/cron/signal-roi', 'success', Date.now() - startTime, totalUpdated)
    return NextResponse.json({ updated: totalUpdated })
  } catch (err) {
    console.error('[cron/signal-roi]', err)
    await recordCronRun('/api/cron/signal-roi', 'error', Date.now() - startTime, 0, err instanceof Error ? err.message : 'Unknown error')
    return NextResponse.json({ error: 'Signal ROI tracking failed' }, { status: 500 })
  }
}
