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

    let totalTracked = 0

    for (const tenant of tenants) {
      const { data: existingOutcomes } = await supabase
        .from('deal_outcomes')
        .select('opportunity_id')
        .eq('tenant_id', tenant.id)

      const trackedOppIds = new Set(
        (existingOutcomes ?? []).map((d) => d.opportunity_id).filter(Boolean)
      )

      const { data: closedOpps } = await supabase
        .from('opportunities')
        .select('id, company_id, is_won, closed_at, lost_reason, value, stage, days_in_stage, created_at')
        .eq('tenant_id', tenant.id)
        .eq('is_closed', true)

      const untracked = (closedOpps ?? []).filter((o) => !trackedOppIds.has(o.id))
      if (!untracked.length) continue

      for (const opp of untracked) {
        const closedAt = opp.closed_at ? new Date(opp.closed_at) : new Date()

        const lookbackWindows = [30, 60, 90]
        const snapshots: Record<string, Record<string, unknown> | null> = {}

        for (const days of lookbackWindows) {
          const targetDate = new Date(closedAt.getTime() - days * 86400000)
          const windowStart = new Date(targetDate.getTime() - 7 * 86400000)
          const windowEnd = new Date(targetDate.getTime() + 7 * 86400000)

          const { data: snapshot } = await supabase
            .from('scoring_snapshots')
            .select('icp_fit, signal_momentum, engagement_depth, contact_coverage, stage_velocity, profile_win_rate, propensity, expected_revenue')
            .eq('tenant_id', tenant.id)
            .eq('company_id', opp.company_id)
            .gte('created_at', windowStart.toISOString())
            .lte('created_at', windowEnd.toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          snapshots[`score_at_${days}d`] = snapshot
        }

        const entrySnapshot = snapshots['score_at_90d'] ?? snapshots['score_at_60d'] ?? snapshots['score_at_30d']

        await supabase.from('deal_outcomes').insert({
          tenant_id: tenant.id,
          opportunity_id: opp.id,
          company_id: opp.company_id,
          icp_score_at_entry: entrySnapshot?.icp_fit ?? null,
          signal_score_at_entry: entrySnapshot?.signal_momentum ?? null,
          engagement_score_at_entry: entrySnapshot?.engagement_depth ?? null,
          contact_coverage_at_entry: entrySnapshot?.contact_coverage ?? null,
          velocity_at_entry: entrySnapshot?.stage_velocity ?? null,
          win_rate_at_entry: entrySnapshot?.profile_win_rate ?? null,
          propensity_at_entry: entrySnapshot?.propensity ?? null,
          stage_velocities: {
            final_stage: opp.stage,
            days_in_final_stage: opp.days_in_stage,
            deal_value: opp.value,
            snapshots_found: Object.entries(snapshots)
              .filter(([, v]) => v !== null)
              .map(([k]) => k),
          },
          outcome: opp.is_won ? 'won' : 'lost',
          lost_reason: opp.lost_reason ?? null,
        })

        totalTracked++
      }
    }

    await recordCronRun('/api/cron/outcomes', 'success', Date.now() - startTime, totalTracked)
    return NextResponse.json({ tracked: totalTracked })
  } catch (err) {
    console.error('[cron/outcomes]', err)
    await recordCronRun('/api/cron/outcomes', 'error', Date.now() - startTime, 0, err instanceof Error ? err.message : 'Unknown error')
    return NextResponse.json({ error: 'Outcome tracking failed' }, { status: 500 })
  }
}
