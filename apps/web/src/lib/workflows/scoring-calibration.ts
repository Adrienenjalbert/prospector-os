import type { SupabaseClient } from '@supabase/supabase-js'
import {
  analyzeCalibration,
  computePropensity,
  shouldAutoApply,
  type DealOutcomeRecord,
  type PropensityWeights,
  type SubScoreSet,
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
 * `calibration_proposals` row when the analysis identifies dimensions that
 * diverge from the tenant's current weights. The `/admin/calibration` page
 * reviews and accepts/rejects proposals.
 *
 * Two production-critical fixes vs the original:
 *
 *   1. The `calibration_proposals` row now matches the schema exactly
 *      (config_type, current_config, proposed_config, analysis). Previously
 *      the insert used `proposal_type` and stuffed the whole analysis blob
 *      into `proposed_config` — the insert failed silently because the
 *      schema requires `current_config` + `analysis` as NOT NULL JSONB.
 *
 *   2. `propensity_at_entry` is computed via `computePropensity` with the
 *      tenant's actual `propensity_weights` instead of a hardcoded formula.
 *      Without this fix, the calibration analysis was comparing against a
 *      DIFFERENT formula than production scoring uses (the default config
 *      ships with `engagement_depth: 0.00`, so the hardcoded
 *      `0.15 * engagement` value was meaningless), making every proposal
 *      misleading.
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

const DEFAULT_WEIGHTS: PropensityWeights = {
  icp_fit: 0.2,
  signal_momentum: 0.15,
  engagement_depth: 0.15,
  contact_coverage: 0.1,
  stage_velocity: 0.2,
  profile_win_rate: 0.2,
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

        // Fetch the tenant's current weights up front so the propensity
        // recomputation matches what production scoring is actually using.
        const { data: tenant } = await ctx.supabase
          .from('tenants')
          .select('scoring_config')
          .eq('id', ctx.tenantId)
          .single()

        const currentWeights: PropensityWeights =
          (tenant?.scoring_config as { propensity_weights?: PropensityWeights } | null)
            ?.propensity_weights ?? DEFAULT_WEIGHTS

        const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
        const { data: deals } = await ctx.supabase
          .from('opportunities')
          .select('id, company_id, is_won, value, closed_at')
          .eq('tenant_id', ctx.tenantId)
          .eq('is_closed', true)
          .gte('closed_at', since)

        if (!deals || deals.length < 20) {
          return { count: deals?.length ?? 0, insufficient: true, currentWeights }
        }

        // Best-effort: enrich each deal with the company's CURRENT
        // sub-scores. Ideally we'd snapshot scores at deal-creation time
        // (and `scoring_snapshots` is already keeping a per-snapshot
        // history we could join against), but using current scores is the
        // pragmatic v1 — calibration is a relative-weight exercise so what
        // matters is dimension discrimination between won and lost, not
        // the absolute snapshot.
        const companyIds = deals.map((d) => d.company_id).filter(Boolean)
        const { data: companies } = await ctx.supabase
          .from('companies')
          .select(
            'id, icp_score, signal_score, engagement_score, contact_coverage_score, velocity_score, win_rate_score',
          )
          .in('id', companyIds)

        const byId = new Map(
          (companies ?? []).map((c) => [c.id as string, c] as const),
        )

        const outcomes: DealOutcomeRecord[] = deals.flatMap((d) => {
          const c = d.company_id ? byId.get(d.company_id) : undefined
          if (!c) return []
          const subScores: SubScoreSet = {
            icp_fit: (c.icp_score as number) ?? 0,
            signal_momentum: (c.signal_score as number) ?? 0,
            engagement_depth: (c.engagement_score as number) ?? 0,
            contact_coverage: (c.contact_coverage_score as number) ?? 0,
            stage_velocity: (c.velocity_score as number) ?? 0,
            profile_win_rate: (c.win_rate_score as number) ?? 0,
          }
          // Real propensity per the tenant's actual weights — not the
          // hardcoded formula the previous version used. This is the
          // BLOCKER fix: without it, the analyzer was comparing against
          // an imaginary scoring model and proposing weight shifts based
          // on noise.
          const propensity = computePropensity(subScores, currentWeights)
          return [{
            icp_score_at_entry: subScores.icp_fit,
            signal_score_at_entry: subScores.signal_momentum,
            engagement_score_at_entry: subScores.engagement_depth,
            contact_coverage_at_entry: subScores.contact_coverage,
            velocity_at_entry: subScores.stage_velocity,
            win_rate_at_entry: subScores.profile_win_rate,
            propensity_at_entry: propensity,
            outcome: d.is_won ? 'won' : 'lost',
          }]
        })

        return { count: outcomes.length, outcomes, currentWeights }
      },
    },
    {
      name: 'analyze',
      run: async (ctx) => {
        const loaded = ctx.stepState.load_deals as {
          count: number
          insufficient?: boolean
          outcomes?: DealOutcomeRecord[]
          currentWeights: PropensityWeights
        }
        if (loaded.insufficient || !loaded.outcomes) {
          return { skipped: true, reason: 'insufficient_data', count: loaded.count }
        }

        const analysis = analyzeCalibration(loaded.outcomes, loaded.currentWeights)
        if (!analysis) return { skipped: true, reason: 'insufficient_for_analysis' }

        const autoApply = shouldAutoApply(analysis)

        return { analysis, auto_apply: autoApply, currentWeights: loaded.currentWeights }
      },
    },
    {
      name: 'write_proposal',
      run: async (ctx) => {
        const analyzed = ctx.stepState.analyze as {
          skipped?: boolean
          analysis?: {
            current_weights: PropensityWeights
            proposed_weights: PropensityWeights
            dimension_analysis: unknown[]
            model_auc: number
            proposed_auc: number
            sample_size: number
            won_count: number
            lost_count: number
            confidence: 'high' | 'medium' | 'low'
          }
          auto_apply?: boolean
          currentWeights?: PropensityWeights
        }
        if (analyzed.skipped || !analyzed.analysis) return { skipped: true }

        if (!ctx.tenantId) throw new Error('Missing tenant')

        // Schema-correct insert. Each column matches `calibration_proposals`
        // (see migration 002 / packages/db/schema/schema.sql).
        //   - config_type    : which JSONB column on `tenants` this proposes
        //                      to update ('scoring' → tenants.scoring_config)
        //   - current_config : the weights we were using when we proposed
        //                      the change (lets the admin see the diff
        //                      and roll back via calibration_ledger)
        //   - proposed_config: the weights to apply if approved (NOT the
        //                      whole analysis blob — that was the bug)
        //   - analysis       : the full diagnostic output the admin UI
        //                      and /admin/adaptation render
        const { error } = await ctx.supabase
          .from('calibration_proposals')
          .insert({
            tenant_id: ctx.tenantId,
            config_type: 'scoring',
            current_config: { propensity_weights: analyzed.analysis.current_weights },
            proposed_config: { propensity_weights: analyzed.analysis.proposed_weights },
            analysis: analyzed.analysis,
            status: 'pending',
            created_at: new Date().toISOString(),
          })
        if (error) {
          console.warn('[scoring-calibration] proposal insert:', error.message)
          throw new Error(`Failed to insert calibration proposal: ${error.message}`)
        }

        return {
          auto_apply: analyzed.auto_apply ?? false,
          confidence: analyzed.analysis.confidence,
          sample_size: analyzed.analysis.sample_size,
          model_auc: analyzed.analysis.model_auc,
          proposed_auc: analyzed.analysis.proposed_auc,
        }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
