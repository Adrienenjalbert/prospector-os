import type { SupabaseClient } from '@supabase/supabase-js'
import { SlackDispatcher, SupabaseCooldownStore } from '@prospector/adapters'
import type { WeeklyDigestParams } from '@prospector/adapters'
import { emitAgentEvent, urn } from '@prospector/core'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'
import { shouldSuppressPush } from './holdout'

/**
 * Portfolio Digest workflow — Monday morning health digest for a CSM's book.
 * Steps:
 *   1. gather_portfolio      — rep's accounts + latest health scores
 *   2. extract_themes        — last-7-day transcript themes + open signals
 *   3. dispatch_slack        — Slack DM with cited highlights
 *
 * Kept deliberately simple for v1 — the theme extractor and churn ranker
 * can grow nightly (Phase 7's self-improving loop keeps tuning them).
 */

export interface PortfolioDigestInput {
  rep_id: string
  channel?: string
}

export async function enqueuePortfolioDigest(
  supabase: SupabaseClient,
  tenantId: string,
  input: PortfolioDigestInput,
): Promise<WorkflowRunRow> {
  const week = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'portfolio_digest',
    idempotencyKey: `pd:${tenantId}:${input.rep_id}:${week}`,
    input: input as unknown as Record<string, unknown>,
  })
}

export async function runPortfolioDigest(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'gather_portfolio',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant for portfolio digest')
        const { rep_id } = ctx.input as unknown as PortfolioDigestInput

        const { data: rep } = await ctx.supabase
          .from('rep_profiles')
          .select('id, name, slack_user_id, crm_id')
          .eq('tenant_id', ctx.tenantId)
          .eq('crm_id', rep_id)
          .maybeSingle()

        if (!rep) throw new Error(`Rep not found: ${rep_id}`)

        const { data: accounts } = await ctx.supabase
          .from('companies')
          .select('id, name, priority_tier, priority_reason, propensity, churn_risk_score, expected_revenue')
          .eq('tenant_id', ctx.tenantId)
          .eq('owner_crm_id', rep_id)
          .order('expected_revenue', { ascending: false })
          .limit(25)

        return {
          rep,
          accounts: accounts ?? [],
        }
      },
    },
    {
      name: 'extract_themes',
      run: async (ctx) => {
        const { accounts } = ctx.stepState.gather_portfolio as {
          accounts: Array<{
            id: string
            name: string
            priority_tier: string | null
            priority_reason: string | null
            propensity: number | null
            churn_risk_score: number | null
            expected_revenue: number | null
          }>
        }

        // High-risk: churn_risk_score >= 60 or priority_tier = MONITOR
        const highRiskAccounts = accounts
          .filter((a) => (a.churn_risk_score ?? 0) >= 60 || a.priority_tier === 'MONITOR')
          .slice(0, 5)
          .map((a) => ({
            name: a.name,
            reason: a.priority_reason ?? `Churn risk ${a.churn_risk_score?.toFixed(0) ?? 'unknown'}`,
          }))

        const watchAccounts = accounts
          .filter((a) => a.priority_tier === 'WARM')
          .slice(0, 5)
          .map((a) => ({ name: a.name, reason: a.priority_reason ?? 'Watch' }))

        // Signals-derived themes; keep to top 3 distinct titles.
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const accountIds = accounts.map((a) => a.id)
        const { data: signals } = await ctx.supabase
          .from('signals')
          .select('title, signal_type')
          .eq('tenant_id', ctx.tenantId)
          .in('company_id', accountIds.length ? accountIds : ['none'])
          .gte('detected_at', sevenDaysAgo)
          .limit(20)

        const themeCounts = new Map<string, number>()
        for (const s of signals ?? []) {
          const key = s.signal_type ?? s.title ?? 'other'
          themeCounts.set(key, (themeCounts.get(key) ?? 0) + 1)
        }
        const themes = Array.from(themeCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([t, n]) => `${t} (${n})`)

        return { highRiskAccounts, watchAccounts, themes }
      },
    },
    {
      name: 'dispatch_slack',
      run: async (ctx) => {
        const { rep } = ctx.stepState.gather_portfolio as {
          rep: { id: string; name: string; slack_user_id: string | null; crm_id: string }
        }
        const { highRiskAccounts, watchAccounts, themes } =
          ctx.stepState.extract_themes as {
            highRiskAccounts: { name: string; reason: string }[]
            watchAccounts: { name: string; reason: string }[]
            themes: string[]
          }

        if (!rep.slack_user_id || !ctx.tenantId) {
          return { skipped: true, reason: 'missing_slack_or_tenant' }
        }

        // Holdout suppression: control-cohort reps get attribution recorded
        // but receive no proactive push. Preserves causal integrity of the
        // influenced-ARR number on the ROI dashboard. MISSION principle 4.
        const suppress = await shouldSuppressPush(ctx.supabase, ctx.tenantId, rep.id)
        if (suppress) {
          return { skipped: true, reason: 'holdout_control' }
        }

        const slackToken = process.env.SLACK_BOT_TOKEN
        if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set')

        const dispatcher = new SlackDispatcher(
          slackToken,
          new SupabaseCooldownStore(ctx.supabase),
          ctx.supabase,
        )

        const { data: repPref } = await ctx.supabase
          .from('rep_profiles')
          .select('alert_frequency')
          .eq('id', rep.id)
          .maybeSingle()

        const interactionId = crypto.randomUUID()
        const params: WeeklyDigestParams = {
          channel: rep.slack_user_id,
          recipientName: rep.name,
          highRiskAccounts,
          watchAccounts,
          themes,
          positiveSignals: [],
          interactionId,
        }

        const result = await dispatcher.sendWeeklyDigest(
          params,
          {
            tenantId: ctx.tenantId,
            subjectKey: `portfolio_digest:${rep.crm_id}`,
          },
          {
            tenantId: ctx.tenantId,
            repUserId: rep.id,
            frequency: (repPref?.alert_frequency as 'high' | 'medium' | 'low') ?? 'medium',
          },
        )

        await emitAgentEvent(ctx.supabase, {
          tenant_id: ctx.tenantId,
          interaction_id: interactionId,
          user_id: rep.id,
          role: 'csm',
          event_type: result.ok ? 'response_finished' : 'error',
          subject_urn: urn.interaction(ctx.tenantId, interactionId),
          payload: {
            workflow: 'portfolio_digest',
            skipped: result.skipped ?? false,
            reason: result.skippedReason ?? result.error ?? null,
            high_risk: highRiskAccounts.length,
            themes: themes.length,
          },
        })

        return result
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
