import type { SupabaseClient } from '@supabase/supabase-js'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Baseline metrics snapshot workflow (P0.2).
 *
 * Captures every north-star KPI weekly so improvement is attributable
 * to specific sprint deliveries. Without this trendline, "Sprint 3 cut
 * cost 15%" is opinion; with it, the chart on /admin/adaptation makes
 * the claim verifiable.
 *
 * Captured per-tenant snapshot:
 *   - per_rep_cost_30d_usd          spend per active rep, last 30d
 *   - cited_answer_rate             % of response_finished rows with
 *                                    citation_count > 0
 *   - thumbs_up_rate                explicit + implicit positives
 *   - slice_priors_sample_count     bandit convergence telemetry
 *   - eval_cases_accepted           growth count
 *   - hallucinated_signals_30d      `claude_research`-source signals
 *                                    that DON'T have payload.source_url
 *   - holdout_treatment_arr_30d     ROI-style influenced ARR for
 *                                    treatment cohort only
 *
 * Stored in `improvement_reports` with kind='baseline_snapshot' and
 * the structured metrics in the `metrics` JSONB column (migration
 * 019).
 *
 * Idempotency keyed by ISO week so a single snapshot lands per tenant
 * per week regardless of cron retries.
 */

export async function enqueueBaselineSnapshot(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const week = isoWeekKey(new Date())
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'baseline_snapshot',
    idempotencyKey: `bs:${tenantId}:${week}`,
    input: { week },
  })
}

function isoWeekKey(date: Date): string {
  // Year-week tag (e.g. '2026-W17'). Stable across cron retries on
  // any day of the same week.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

interface SnapshotMetrics {
  captured_at: string
  per_rep_cost_30d_usd: number
  cited_answer_rate: number
  thumbs_up_rate: number
  slice_priors_sample_count: number
  eval_cases_accepted: number
  hallucinated_signals_30d: number
  holdout_treatment_arr_30d: number
  active_users_30d: number
  /**
   * Track E — prompt-optimizer activity. Counts calibration proposals
   * with config_type='prompt' approved in the last 30 days. The
   * strategic review §13 defines this as the headline "is the
   * self-improving claim true?" metric — non-zero monthly rate is
   * the proof point that the per-tenant Opus call is actually
   * shipping diffs reps and admins consume.
   */
  prompt_diffs_30d: number
  first_run_completed_30d: number
  first_run_p50_elapsed_ms: number | null
}

export async function runBaselineSnapshot(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'compute_metrics',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

        // Cost per rep — sum agent_token_costs_daily over 30d / unique users.
        const monthDay = monthAgo.slice(0, 10)
        const [
          costRes,
          responsesRes,
          feedbackRes,
          sliceRes,
          evalRes,
          signalRes,
          attrRes,
          promptDiffRes,
          firstRunRes,
        ] = await Promise.all([
          ctx.supabase
            .from('agent_token_costs_daily')
            .select('cost_usd')
            .eq('tenant_id', ctx.tenantId)
            .gte('day', monthDay),
          ctx.supabase
            .from('agent_events')
            .select('payload, user_id')
            .eq('tenant_id', ctx.tenantId)
            .eq('event_type', 'response_finished')
            .gte('occurred_at', monthAgo),
          ctx.supabase
            .from('agent_events')
            .select('payload')
            .eq('tenant_id', ctx.tenantId)
            .eq('event_type', 'feedback_given')
            .gte('occurred_at', monthAgo),
          ctx.supabase
            .from('context_slice_priors')
            .select('sample_count')
            .eq('tenant_id', ctx.tenantId),
          ctx.supabase
            .from('eval_cases')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', ctx.tenantId)
            .eq('status', 'accepted'),
          ctx.supabase
            .from('signals')
            .select('source, source_url')
            .eq('tenant_id', ctx.tenantId)
            .eq('source', 'claude_research')
            .gte('detected_at', monthAgo),
          ctx.supabase
            .from('attributions')
            .select('confidence, outcome_event_id, is_control_cohort')
            .eq('tenant_id', ctx.tenantId)
            .eq('is_control_cohort', false)
            .gte('created_at', monthAgo),
          // Prompt diffs / month — calibration_proposals approved in
          // the last 30d with config_type='prompt'. See strategic
          // review §13: the headline "self-improving" metric.
          ctx.supabase
            .from('calibration_proposals')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', ctx.tenantId)
            .eq('config_type', 'prompt')
            .eq('status', 'approved')
            .gte('created_at', monthAgo),
          // First-run digests delivered in the window (C1 SLA tracking).
          // Counts payload.skipped=false events; computes p50 elapsed_ms.
          ctx.supabase
            .from('agent_events')
            .select('payload')
            .eq('tenant_id', ctx.tenantId)
            .eq('event_type', 'first_run_completed')
            .gte('occurred_at', monthAgo),
        ])

        const totalCost = (costRes.data ?? []).reduce(
          (s, r) => s + Number(r.cost_usd ?? 0),
          0,
        )
        const uniqueUsers = new Set(
          (responsesRes.data ?? [])
            .map((r) => r.user_id as string | null)
            .filter((u): u is string => !!u),
        ).size
        const perRepCost = uniqueUsers > 0 ? totalCost / uniqueUsers : 0

        const totalResponses = (responsesRes.data ?? []).length
        const citedCount = (responsesRes.data ?? []).filter(
          (r) => ((r.payload as { citation_count?: number } | null)?.citation_count ?? 0) > 0,
        ).length
        const citedAnswerRate = totalResponses > 0 ? citedCount / totalResponses : 0

        const feedback = feedbackRes.data ?? []
        const positives = feedback.filter((f) => {
          const v = (f.payload as { value?: string } | null)?.value
          return v === 'positive' || v === 'thumbs_up'
        }).length
        const thumbsUpRate = feedback.length > 0 ? positives / feedback.length : 0

        const slicePriorsSampleCount = (sliceRes.data ?? []).reduce(
          (s, r) => s + Number(r.sample_count ?? 0),
          0,
        )

        const hallucinatedSignals = (signalRes.data ?? []).filter(
          (s) => !s.source_url,
        ).length

        // Influenced ARR for treatment cohort (matches /admin/roi math).
        const outcomeIds = (attrRes.data ?? []).map((a) => a.outcome_event_id)
        let treatmentArr = 0
        if (outcomeIds.length > 0) {
          const { data: outcomes } = await ctx.supabase
            .from('outcome_events')
            .select('id, value_amount, event_type')
            .in('id', outcomeIds)
            .eq('event_type', 'deal_closed_won')
          const byId = new Map(
            (outcomes ?? []).map((o) => [o.id, Number(o.value_amount ?? 0)]),
          )
          for (const a of attrRes.data ?? []) {
            const value = byId.get(a.outcome_event_id) ?? 0
            treatmentArr += value * Number(a.confidence ?? 0)
          }
        }

        // First-run telemetry — count of completed digests + p50 SLA.
        // Only count rows where the digest actually delivered
        // (skipped=false); the SLA target is 10min so p50 should
        // sit well below 600_000ms once C1 has shipped to a few
        // tenants.
        const firstRuns = (firstRunRes.data ?? [])
          .filter((r) => {
            const p = r.payload as { skipped?: boolean } | null
            return p && p.skipped === false
          })
          .map(
            (r) =>
              ((r.payload as { elapsed_ms?: number } | null)?.elapsed_ms ?? 0) as number,
          )
          .filter((n) => n > 0)
          .sort((a, b) => a - b)
        const firstRunP50 =
          firstRuns.length > 0
            ? firstRuns[Math.floor(firstRuns.length / 2)]
            : null

        const metrics: SnapshotMetrics = {
          captured_at: new Date().toISOString(),
          per_rep_cost_30d_usd: round(perRepCost, 4),
          cited_answer_rate: round(citedAnswerRate, 4),
          thumbs_up_rate: round(thumbsUpRate, 4),
          slice_priors_sample_count: slicePriorsSampleCount,
          eval_cases_accepted: evalRes.count ?? 0,
          hallucinated_signals_30d: hallucinatedSignals,
          holdout_treatment_arr_30d: round(treatmentArr, 2),
          active_users_30d: uniqueUsers,
          prompt_diffs_30d: promptDiffRes.count ?? 0,
          first_run_completed_30d: firstRuns.length,
          first_run_p50_elapsed_ms: firstRunP50,
        }

        return { metrics }
      },
    },
    {
      name: 'persist_snapshot',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { metrics } = ctx.stepState.compute_metrics as { metrics: SnapshotMetrics }

        // Single human-readable summary string for ops eyeballs;
        // the structured payload lives in the new `metrics` column
        // (migration 019).
        const summary = [
          `# Baseline metrics snapshot (${metrics.captured_at.slice(0, 10)})`,
          '',
          `- Per-rep AI cost (30d): $${metrics.per_rep_cost_30d_usd.toFixed(2)}`,
          `- Cited-answer rate: ${(metrics.cited_answer_rate * 100).toFixed(1)}%`,
          `- Thumbs-up rate: ${(metrics.thumbs_up_rate * 100).toFixed(1)}%`,
          `- Slice priors sample count: ${metrics.slice_priors_sample_count}`,
          `- Eval cases accepted: ${metrics.eval_cases_accepted}`,
          `- Hallucinated signals (30d): ${metrics.hallucinated_signals_30d}`,
          `- Treatment-cohort ARR (30d): $${metrics.holdout_treatment_arr_30d.toFixed(2)}`,
          `- Active users (30d): ${metrics.active_users_30d}`,
          `- Prompt diffs approved (30d): ${metrics.prompt_diffs_30d}`,
          `- First-run digests delivered (30d): ${metrics.first_run_completed_30d}${
            metrics.first_run_p50_elapsed_ms != null
              ? ` · p50 ${(metrics.first_run_p50_elapsed_ms / 1000).toFixed(1)}s`
              : ''
          }`,
        ].join('\n')

        const periodEnd = new Date()
        const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

        const { error } = await ctx.supabase.from('improvement_reports').insert({
          tenant_id: ctx.tenantId,
          kind: 'baseline_snapshot',
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
          failure_cluster_count: 0,
          report_markdown: summary,
          proposed_fixes: [],
          metrics,
        })
        if (error) {
          throw new Error(`baseline_snapshot insert: ${error.message}`)
        }

        return { ok: true, metrics }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

function round(n: number, places: number): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}
