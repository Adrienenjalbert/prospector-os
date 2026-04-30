import type { SupabaseClient } from '@supabase/supabase-js'
import { computeBootstrapForecast } from '@prospector/core'

import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Team Aggregation workflow (Sprint 4 — Mission–Reality Gap roadmap).
 *
 * Computes one `team_metrics` row per active rep per night so the
 * `/analytics/team` page (previously a placeholder telling managers
 * to use the ontology browser) can render a real attainment
 * leaderboard, pipeline coverage, stalled-deal heatmap, and forecast
 * roll-up.
 *
 * Why batch (not on-demand): the page renders for every manager visit;
 * computing 50 reps × forecast bootstrap × stall counts inline on
 * every page load would burn cycles for unchanging numbers. Snapshot
 * once per night, read for free during the day.
 *
 * Idempotency keyed on (tenant, day) so the daily cron's natural
 * retries don't double-write. The next day's run produces the next
 * date's row without colliding.
 */

export interface TeamAggregationInput {
  /** ISO date for the metric_date column on the snapshot row. */
  snapshot_date: string
}

interface RepRow {
  id: string
  tenant_id: string
  crm_id: string
  active: boolean | null
  quota_quarterly: number | null
}

interface OppRow {
  owner_crm_id: string | null
  value: number | null
  probability: number | null
  is_closed: boolean | null
  is_won: boolean | null
  is_stalled: boolean | null
  closed_at: string | null
}

export async function enqueueTeamAggregation(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const today = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'team_aggregation',
    idempotencyKey: `ta:${tenantId}:${today}`,
    input: { snapshot_date: today } as Record<string, unknown>,
  })
}

/**
 * Compute the start of the current calendar quarter (ISO date). Used
 * to scope attainment to "won this quarter" rather than all-time.
 */
function quarterStart(d: Date): Date {
  const month = Math.floor(d.getUTCMonth() / 3) * 3
  return new Date(Date.UTC(d.getUTCFullYear(), month, 1))
}

export async function runTeamAggregation(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'gather_team',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant for team_aggregation')

        // Active reps only — terminated reps don't contribute to
        // current quarter forecasting and would skew the median
        // attainment metric.
        const { data: reps } = await ctx.supabase
          .from('rep_profiles')
          .select('id, tenant_id, crm_id, active, quota_quarterly')
          .eq('tenant_id', ctx.tenantId)
          .eq('active', true)

        const repList = (reps ?? []) as RepRow[]
        if (repList.length === 0) {
          return { reps: [], opps: [] }
        }

        // Single tenant-wide opportunity pull, then JS-side group by
        // owner. One round trip beats N round trips per rep.
        const { data: opps } = await ctx.supabase
          .from('opportunities')
          .select('owner_crm_id, value, probability, is_closed, is_won, is_stalled, closed_at')
          .eq('tenant_id', ctx.tenantId)

        return { reps: repList, opps: (opps ?? []) as OppRow[] }
      },
    },

    {
      name: 'compute_metrics',
      run: async (ctx) => {
        const { reps, opps } = ctx.stepState.gather_team as {
          reps: RepRow[]
          opps: OppRow[]
        }

        if (reps.length === 0) return { rows: [] }

        const qStart = quarterStart(new Date()).toISOString()
        const oppsByOwner = new Map<string, OppRow[]>()
        for (const o of opps) {
          if (!o.owner_crm_id) continue
          const list = oppsByOwner.get(o.owner_crm_id) ?? []
          list.push(o)
          oppsByOwner.set(o.owner_crm_id, list)
        }

        // Compute the tenant's overall close-rate as the per-rep
        // bootstrap winRate fallback. Without it a rep's bootstrap
        // forecast collapses to 0 the moment they have no
        // historical closes — which is exactly when leadership most
        // wants a forecast band.
        const tenantClosed = opps.filter((o) => o.is_closed)
        const tenantWon = tenantClosed.filter((o) => o.is_won).length
        const tenantWinRateFallback =
          tenantClosed.length > 0 ? tenantWon / tenantClosed.length : 0.2

        const rows = reps.map((rep) => {
          const repOpps = oppsByOwner.get(rep.crm_id) ?? []
          const openOpps = repOpps.filter((o) => !o.is_closed)
          const closedOpps = repOpps.filter((o) => o.is_closed)
          const wonOpps = closedOpps.filter((o) => o.is_won)

          // Per-rep historical win rate, blended with tenant fallback
          // when the sample is too thin (Bayesian smoothing —
          // 5 closed-deal floor before per-rep rate dominates).
          const repWonThisQ = wonOpps.filter(
            (o) => o.closed_at && o.closed_at >= qStart,
          )
          const wonThisQValue = repWonThisQ.reduce(
            (s, o) => s + Number(o.value ?? 0),
            0,
          )

          const closedCount = closedOpps.length
          const repWinRate =
            closedCount >= 5
              ? wonOpps.length / closedCount
              : tenantWinRateFallback

          // Open weighted pipeline (deal value × probability/100).
          const weightedPipeline = openOpps.reduce(
            (s, o) =>
              s +
              Number(o.value ?? 0) *
                (Number(o.probability ?? 50) / 100),
            0,
          )

          const stalledDealCount = openOpps.filter((o) => o.is_stalled).length

          const quota = rep.quota_quarterly ?? null
          const attainment =
            quota != null && Number(quota) > 0
              ? wonThisQValue / Number(quota)
              : null

          // Pipeline coverage = open weighted pipeline / remaining
          // quota gap. Conventionally "3x coverage" is healthy. When
          // quota is null we leave coverage null so the page renders
          // an empty cell rather than Infinity.
          const remainingGap =
            quota != null && Number(quota) > 0
              ? Math.max(0, Number(quota) - wonThisQValue)
              : null
          const coverage =
            remainingGap != null && remainingGap > 0
              ? weightedPipeline / remainingGap
              : null

          // Bootstrap forecast band over this rep's open opps using
          // their (smoothed) historical win rate. Same routine the
          // /analytics/forecast page uses so manager + rep see
          // numbers that agree.
          const forecast = computeBootstrapForecast({
            opportunities: openOpps.map((o) => ({
              value: Number(o.value ?? 0),
              winRate: repWinRate,
            })),
            iterations: 500,
          })

          return {
            rep_id: rep.id,
            quota_quarterly: quota,
            attainment_quarterly: attainment != null ? Number(attainment.toFixed(3)) : null,
            pipeline_coverage: coverage != null ? Number(coverage.toFixed(3)) : null,
            weighted_pipeline: Math.round(weightedPipeline),
            stalled_deal_count: stalledDealCount,
            forecast_low: forecast.p10,
            forecast_mid: forecast.p50,
            forecast_high: forecast.p90,
          }
        })

        return { rows }
      },
    },

    {
      name: 'persist_snapshots',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant for team_aggregation persist')
        const { rows } = ctx.stepState.compute_metrics as {
          rows: Array<{
            rep_id: string
            quota_quarterly: number | null
            attainment_quarterly: number | null
            pipeline_coverage: number | null
            weighted_pipeline: number
            stalled_deal_count: number
            forecast_low: number
            forecast_mid: number
            forecast_high: number
          }>
        }
        const { snapshot_date } = ctx.input as unknown as TeamAggregationInput

        if (rows.length === 0) {
          return { written: 0 }
        }

        // Upsert on (tenant_id, rep_id, metric_date). Same date +
        // re-run = no duplicate rows; updated_at-style behaviour by
        // virtue of the upsert refreshing the values.
        const payload = rows.map((r) => ({
          tenant_id: ctx.tenantId,
          metric_date: snapshot_date,
          ...r,
          generated_at: new Date().toISOString(),
        }))

        const { error } = await ctx.supabase
          .from('team_metrics')
          .upsert(payload, { onConflict: 'tenant_id,rep_id,metric_date' })

        if (error) {
          throw new Error(`team_metrics upsert failed: ${error.message}`)
        }

        return { written: payload.length }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
