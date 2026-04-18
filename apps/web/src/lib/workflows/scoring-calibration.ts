import type { SupabaseClient } from '@supabase/supabase-js'
import {
  analyzeCalibration,
  shouldAutoApply,
  type DealOutcomeRecord,
  type PropensityWeights,
} from '@prospector/core'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Scoring calibration — weekly workflow. Pulls closed deals from the last
 * 90 days, runs `analyzeCalibration` from @prospector/core, and writes a
 * `calibration_proposals` row if it finds dimensions that diverge from the
 * current weights. The admin calibration page (already built) reviews and
 * accept/rejects. This wires an existing core module that had no production
 * caller before.
 */

export async function enqueueScoringCalibration(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const week = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'scoring_calibration',
    idempotencyKey: `sc:${tenantId}:${week}`,
    input: { week },
  })
}

export async function runScoringCalibration(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_deals',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
        const { data: deals } = await ctx.supabase
          .from('opportunities')
          .select('id, company_id, is_won, value, closed_at')
          .eq('tenant_id', ctx.tenantId)
          .eq('is_closed', true)
          .gte('closed_at', since)

        if (!deals || deals.length < 20) {
          return { count: deals?.length ?? 0, insufficient: true }
        }

        // Enrich with company scoring dimensions at close time (best effort:
        // we use current scores as a proxy until we snapshot per-deal).
        const companyIds = deals.map((d) => d.company_id).filter(Boolean)
        const { data: companies } = await ctx.supabase
          .from('companies')
          .select('id, icp_score, signal_score, engagement_score, contact_coverage_score, velocity_score, win_rate_score, industry_group')
          .in('id', companyIds)

        const byId = new Map(
          (companies ?? []).map((c) => [c.id as string, c] as const),
        )

        const outcomes: DealOutcomeRecord[] = deals.flatMap((d) => {
          const c = d.company_id ? byId.get(d.company_id) : undefined
          if (!c) return []
          const icp = (c.icp_score as number) ?? 0
          const signal = (c.signal_score as number) ?? 0
          const engagement = (c.engagement_score as number) ?? 0
          const contact = (c.contact_coverage_score as number) ?? 0
          const velocity = (c.velocity_score as number) ?? 0
          const winRate = (c.win_rate_score as number) ?? 0
          const propensity = Math.round(
            0.2 * icp + 0.15 * signal + 0.15 * engagement + 0.1 * contact + 0.2 * velocity + 0.2 * winRate,
          )
          return [{
            icp_score_at_entry: icp,
            signal_score_at_entry: signal,
            engagement_score_at_entry: engagement,
            contact_coverage_at_entry: contact,
            velocity_at_entry: velocity,
            win_rate_at_entry: winRate,
            propensity_at_entry: propensity,
            outcome: d.is_won ? 'won' : 'lost',
          }]
        })

        return { count: outcomes.length, outcomes }
      },
    },
    {
      name: 'analyze',
      run: async (ctx) => {
        const loaded = ctx.stepState.load_deals as {
          count: number
          insufficient?: boolean
          outcomes?: DealOutcomeRecord[]
        }
        if (loaded.insufficient || !loaded.outcomes) {
          return { skipped: true, reason: 'insufficient_data', count: loaded.count }
        }

        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { data: tenant } = await ctx.supabase
          .from('tenants')
          .select('scoring_config')
          .eq('id', ctx.tenantId)
          .single()

        const currentWeights: PropensityWeights =
          (tenant?.scoring_config as { propensity_weights?: PropensityWeights } | null)
            ?.propensity_weights ?? {
            icp_fit: 0.2,
            signal_momentum: 0.15,
            engagement_depth: 0.15,
            contact_coverage: 0.1,
            stage_velocity: 0.2,
            profile_win_rate: 0.2,
          }

        const analysis = analyzeCalibration(loaded.outcomes, currentWeights)
        if (!analysis) return { skipped: true, reason: 'insufficient_for_analysis' }

        const autoApply = shouldAutoApply(analysis)

        return { analysis, auto_apply: autoApply }
      },
    },
    {
      name: 'write_proposal',
      run: async (ctx) => {
        const analyzed = ctx.stepState.analyze as {
          skipped?: boolean
          analysis?: Record<string, unknown>
          auto_apply?: boolean
        }
        if (analyzed.skipped) return { skipped: true }

        if (!ctx.tenantId) throw new Error('Missing tenant')

        const { error } = await ctx.supabase
          .from('calibration_proposals')
          .insert({
            tenant_id: ctx.tenantId,
            proposal_type: 'propensity_weights',
            proposed_config: analyzed.analysis,
            created_at: new Date().toISOString(),
          })
        if (error) {
          console.warn('[scoring-calibration] proposal insert:', error.message)
        }

        return { auto_apply: analyzed.auto_apply ?? false }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
