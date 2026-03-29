import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase, recordCronRun } from '@/lib/cron-auth'
import { analyzeCalibration, shouldAutoApply } from '@prospector/core'
import type { DealOutcomeRecord } from '@prospector/core'
import type { PropensityWeights, ScoringConfig } from '@prospector/core'

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()

  const startTime = Date.now()

  try {
    const supabase = getServiceSupabase()

    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, scoring_config')
      .eq('active', true)

    if (!tenants?.length) {
      return NextResponse.json({ message: 'No active tenants' })
    }

    let totalProposals = 0

    for (const tenant of tenants) {
      const scoringConfig = tenant.scoring_config as ScoringConfig | null
      if (!scoringConfig?.propensity_weights) continue

      const recalibration = scoringConfig.recalibration
      const minDeals = recalibration?.min_closed_deals ?? recalibration?.min_sample_size ?? 30

      const { data: outcomes } = await supabase
        .from('deal_outcomes')
        .select('icp_score_at_entry, signal_score_at_entry, engagement_score_at_entry, contact_coverage_at_entry, velocity_at_entry, win_rate_at_entry, propensity_at_entry, outcome')
        .eq('tenant_id', tenant.id)

      if (!outcomes?.length) continue

      const typedOutcomes: DealOutcomeRecord[] = outcomes.map((o) => ({
        ...o,
        outcome: o.outcome as 'won' | 'lost',
      }))

      const result = analyzeCalibration(
        typedOutcomes,
        scoringConfig.propensity_weights,
        minDeals
      )

      if (!result) continue

      const autoApply = recalibration?.auto_apply === true && shouldAutoApply(result)

      const status = autoApply ? 'auto_applied' : 'pending'

      await supabase.from('calibration_proposals').insert({
        tenant_id: tenant.id,
        config_type: 'scoring',
        current_config: scoringConfig.propensity_weights,
        proposed_config: result.proposed_weights,
        analysis: result,
        status,
        applied_at: autoApply ? new Date().toISOString() : null,
      })

      if (autoApply) {
        const updatedConfig = {
          ...scoringConfig,
          propensity_weights: result.proposed_weights,
        }

        await supabase
          .from('tenants')
          .update({ scoring_config: updatedConfig })
          .eq('id', tenant.id)

        console.log(
          `[cron/recalibrate] Auto-applied weights for tenant ${tenant.id}. ` +
          `AUC: ${result.model_auc} → ${result.proposed_auc}`
        )
      }

      totalProposals++
    }

    await recordCronRun('/api/cron/recalibrate', 'success', Date.now() - startTime, totalProposals)
    return NextResponse.json({ proposals: totalProposals })
  } catch (err) {
    console.error('[cron/recalibrate]', err)
    await recordCronRun('/api/cron/recalibrate', 'error', Date.now() - startTime, 0, err instanceof Error ? err.message : 'Unknown error')
    return NextResponse.json({ error: 'Recalibration failed' }, { status: 500 })
  }
}
