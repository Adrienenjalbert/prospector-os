import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase } from '@/lib/cron-auth'

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()

  try {
    const supabase = getServiceSupabase()
    const today = new Date().toISOString().split('T')[0]
    const dayStart = `${today}T00:00:00Z`

    const { data: tenants } = await supabase
      .from('tenants')
      .select('id')
      .eq('active', true)

    if (!tenants?.length) {
      return NextResponse.json({ message: 'No active tenants' })
    }

    let totalMetrics = 0

    for (const tenant of tenants) {
      const { data: reps } = await supabase
        .from('rep_profiles')
        .select('crm_id')
        .eq('tenant_id', tenant.id)
        .eq('active', true)

      if (!reps?.length) continue

      for (const rep of reps) {
        const [feedbackRes, conversationRes, alertsSentRes] = await Promise.all([
          supabase
            .from('alert_feedback')
            .select('alert_type, reaction, action_taken')
            .eq('tenant_id', tenant.id)
            .eq('rep_crm_id', rep.crm_id)
            .gte('created_at', dayStart),
          supabase
            .from('ai_conversations')
            .select('message_count, updated_at')
            .eq('tenant_id', tenant.id)
            .gte('updated_at', dayStart),
          supabase
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenant.id)
            .gte('created_at', dayStart),
        ])

        const feedback = feedbackRes.data ?? []
        const conversations = conversationRes.data ?? []

        const briefingFeedback = feedback.filter((f) => f.alert_type === 'daily_briefing')
        const briefingOpened = briefingFeedback.length > 0
        const briefingResponded = briefingFeedback.some(
          (f) => f.reaction === 'positive' || f.action_taken,
        )

        const alertsResponded = feedback.filter(
          (f) => f.reaction === 'positive' || f.reaction === 'negative' || f.action_taken,
        ).length

        const agentQueries = conversations.reduce(
          (sum, c) => sum + (c.message_count ?? 0),
          0,
        )

        const alertsSent = alertsSentRes.count ?? 0
        const pullToPush = alertsSent > 0
          ? Math.round((agentQueries / alertsSent) * 100) / 100
          : 0

        await supabase.from('adoption_metrics').upsert(
          {
            tenant_id: tenant.id,
            rep_crm_id: rep.crm_id,
            date: today,
            briefing_opened: briefingOpened,
            briefing_responded: briefingResponded,
            agent_queries: agentQueries,
            alerts_sent: alertsSent,
            alerts_responded: alertsResponded,
            pull_to_push_ratio: pullToPush,
          },
          { onConflict: 'tenant_id,rep_crm_id,date' },
        )

        totalMetrics++
      }
    }

    return NextResponse.json({ metrics_updated: totalMetrics })
  } catch (err) {
    console.error('[cron/adoption]', err)
    return NextResponse.json({ error: 'Adoption metrics failed' }, { status: 500 })
  }
}
