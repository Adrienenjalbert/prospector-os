import type { SupabaseClient } from '@supabase/supabase-js'
import { SlackDispatcher, SupabaseCooldownStore } from '@prospector/adapters'
import type {
  DailyDigestParams,
  DailyDigestPriority,
  DailyDigestActionButton,
} from '@prospector/adapters'
import { emitAgentEvent, urn } from '@prospector/core'

import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'
import { shouldSuppressPush } from './holdout'

/**
 * Daily Push workflow (Sprint 2 — Mission–Reality Gap roadmap).
 *
 * MISSION §7 lists "Slack daily push + pre-call brief T-15" as the
 * AE's primary touchpoint. Pre-call brief shipped; daily push did
 * not — until now. The Pull-to-Push Ratio that the mission calls
 * "the single diagnostic adoption metric" depends on this workflow
 * producing the denominator.
 *
 * Contract (every cap from MISSION §9.1 baked in mechanically):
 *   - Top-N capped at 3 — the message renders the rep's three
 *     highest-composite-priority accounts, nothing more. Anything
 *     beyond bundles into tomorrow's push.
 *   - alert_frequency cap enforced via SlackDispatcher's push budget.
 *     A rep with `alert_frequency='low'` sees one push/day; the
 *     daily push uses the full budget (= 1 message), so other
 *     proactive pushes for that rep on the same day will skip.
 *   - shouldSuppressPush gates control-cohort reps so the influenced
 *     ARR number on /admin/roi stays causal.
 *   - Idempotency keyed `daily_push:{tenant}:{rep}:{YYYY-MM-DD}` so
 *     a re-run on the same day is a no-op at the workflow_runs layer.
 *   - Empty rep books skip silently (no "no priorities" push).
 *
 * Trigger: hourly cron at /api/cron/daily-push fans out across tenants
 * + active reps whose local briefing time falls in this UTC hour.
 */

export interface DailyPushInput {
  rep_id: string
  /** ISO date for the day this push targets — used in the idempotency key. */
  push_date: string
  /** Optional override channel; defaults to the rep's Slack DM. */
  channel?: string
}

interface PriorityRow {
  id: string
  name: string
  priority_tier: string | null
  priority_reason: string | null
  expected_revenue: number | null
  urgency_multiplier: number | null
  signal_score: number | null
}

export async function enqueueDailyPush(
  supabase: SupabaseClient,
  tenantId: string,
  input: DailyPushInput,
): Promise<WorkflowRunRow> {
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'daily_push',
    idempotencyKey: `daily_push:${tenantId}:${input.rep_id}:${input.push_date}`,
    input: input as unknown as Record<string, unknown>,
  })
}

export async function runDailyPush(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'gather_priorities',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant for daily_push')
        const { rep_id } = ctx.input as unknown as DailyPushInput

        // Resolve the rep so we have name + slack_user_id + frequency
        // before we look at their book. Also re-check snooze here in
        // case the rep snoozed between fan-out and step execution.
        const { data: rep } = await ctx.supabase
          .from('rep_profiles')
          .select('id, name, slack_user_id, crm_id, alert_frequency, snooze_until')
          .eq('tenant_id', ctx.tenantId)
          .eq('id', rep_id)
          .maybeSingle()

        if (!rep) throw new Error(`Rep not found: ${rep_id}`)

        // Snooze trumps everything — even a green-light push budget
        // gets dropped if the rep asked for quiet.
        if (rep.snooze_until && new Date(rep.snooze_until) > new Date()) {
          return { rep, accounts: [] as PriorityRow[], snoozed: true }
        }

        // Pull a generous candidate pool ordered by raw expected
        // revenue so the JS re-rank by composite priority
        // (`expected_revenue × urgency_multiplier`) has enough signal
        // to surface the right top-3. Same approach as the inbox page
        // so the rep sees the same names in Slack as they see at
        // their desk.
        const { data: candidates } = await ctx.supabase
          .from('companies')
          .select('id, name, priority_tier, priority_reason, expected_revenue, urgency_multiplier, signal_score')
          .eq('tenant_id', ctx.tenantId)
          .eq('owner_crm_id', rep.crm_id)
          .in('priority_tier', ['HOT', 'WARM'])
          .order('expected_revenue', { ascending: false, nullsFirst: false })
          .limit(30)

        const ranked = (candidates ?? [])
          .map((c) => ({
            ...c,
            _composite: (c.expected_revenue ?? 0) * (c.urgency_multiplier ?? 1),
          }))
          .sort((a, b) => b._composite - a._composite)
          // MISSION §9.1: ≤ 3 items per list section. The cap is
          // the entire point of the workflow — never expand.
          .slice(0, 3)

        return { rep, accounts: ranked as PriorityRow[], snoozed: false }
      },
    },

    {
      name: 'compose_blocks',
      run: async (ctx) => {
        const { rep, accounts, snoozed } = ctx.stepState.gather_priorities as {
          rep: { id: string; name: string; slack_user_id: string | null; crm_id: string; alert_frequency: string | null }
          accounts: PriorityRow[]
          snoozed: boolean
        }

        if (snoozed) return { skipped: true, reason: 'snoozed' as const, blocks: null, params: null }
        if (accounts.length === 0) return { skipped: true, reason: 'empty_book' as const, blocks: null, params: null }

        // Build DailyDigestParams for the dispatcher. The dispatcher
        // does the Block Kit assembly + button rendering; this step
        // owns the content — picking which reason line to surface
        // (priority_reason from the scorer, fallback to a generic).
        const interactionId = crypto.randomUUID()
        const priorities: DailyDigestPriority[] = accounts.map((a) => ({
          accountName: a.name,
          reason: (a.priority_reason ?? `Priority ${a.priority_tier ?? 'WARM'}`).slice(0, 140),
          accountUrn: urn.company(ctx.tenantId!, a.id),
        }))

        // Three Next-Step buttons, the cap from MISSION §9.1.
        // "Open inbox" deep-links to the dashboard inbox view where
        // the same priorities are listed; "Snooze today" sets
        // snooze_until = +24h via the existing snooze_ handler;
        // "Done" records positive feedback via the existing
        // feedback_pos_ handler. Both prefixes are wired in
        // `apps/web/src/app/api/slack/events/route.ts`.
        const dashboardOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? ''
        const actionButtons: DailyDigestActionButton[] = [
          {
            label: 'Open inbox',
            actionId: `open_inbox_${interactionId}`,
            value: `inbox:${rep.id}`,
            url: dashboardOrigin ? `${dashboardOrigin}/inbox` : undefined,
          },
          {
            label: 'Snooze today',
            actionId: `snooze_${interactionId}`,
            value: `snooze:eod:${rep.id}`,
          },
          {
            label: 'Done',
            actionId: `feedback_pos_${interactionId}`,
            value: interactionId,
          },
        ]

        return {
          skipped: false,
          interactionId,
          priorities,
          actionButtons,
          recipientName: rep.name,
        }
      },
    },

    {
      name: 'dispatch_slack',
      run: async (ctx) => {
        const { rep } = ctx.stepState.gather_priorities as {
          rep: { id: string; name: string; slack_user_id: string | null; crm_id: string; alert_frequency: string | null }
        }
        const composed = ctx.stepState.compose_blocks as
          | {
              skipped: true
              reason: 'snoozed' | 'empty_book'
            }
          | {
              skipped: false
              interactionId: string
              priorities: DailyDigestPriority[]
              actionButtons: DailyDigestActionButton[]
              recipientName: string
            }

        if (composed.skipped) {
          return { skipped: true, reason: composed.reason }
        }

        if (!rep.slack_user_id || !ctx.tenantId) {
          return { skipped: true, reason: 'missing_slack_or_tenant' as const }
        }

        // Holdout suppression. Control-cohort reps get attribution
        // recorded but receive no push, preserving the causal
        // integrity of the influenced-ARR number on /admin/roi.
        const suppress = await shouldSuppressPush(ctx.supabase, ctx.tenantId, rep.id)
        if (suppress) {
          await emitAgentEvent(ctx.supabase, {
            tenant_id: ctx.tenantId,
            interaction_id: composed.interactionId,
            user_id: rep.id,
            role: 'ae',
            event_type: 'response_finished',
            subject_urn: urn.interaction(ctx.tenantId, composed.interactionId),
            // Required-key shape from validate-events.ts. Workflow
            // pushes don't call tools or LLMs but the schema is
            // shared across all surfaces; we report 0s + a stable
            // agent_type so the events table stays uniform.
            payload: {
              agent_type: 'pipeline-coach',
              tool_calls: [],
              citation_count: 0,
              tokens_total: 0,
              workflow: 'daily_push',
              skipped: true,
              reason: 'holdout_control',
              priority_count: composed.priorities.length,
            },
          })
          return { skipped: true, reason: 'holdout_control' as const }
        }

        const slackToken = process.env.SLACK_BOT_TOKEN
        if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set')

        const dispatcher = new SlackDispatcher(
          slackToken,
          new SupabaseCooldownStore(ctx.supabase),
          ctx.supabase,
        )

        const dmChannel = await dispatcher.openDMChannel(rep.slack_user_id)

        const params: DailyDigestParams = {
          channel: dmChannel,
          recipientName: composed.recipientName,
          priorities: composed.priorities,
          actionButtons: composed.actionButtons,
          interactionId: composed.interactionId,
        }

        const result = await dispatcher.sendDailyDigest(
          params,
          {
            tenantId: ctx.tenantId,
            // Cooldown subject keys the dispatcher off (rep, day) so
            // re-running this same workflow run after a transient
            // failure doesn't double-DM.
            subjectKey: `daily_push:${rep.crm_id}:${new Date().toISOString().slice(0, 10)}`,
          },
          {
            tenantId: ctx.tenantId,
            repUserId: rep.id,
            frequency:
              (rep.alert_frequency as 'high' | 'medium' | 'low' | null) ?? 'medium',
          },
        )

        await emitAgentEvent(ctx.supabase, {
          tenant_id: ctx.tenantId,
          interaction_id: composed.interactionId,
          user_id: rep.id,
          role: 'ae',
          event_type: result.ok ? 'response_finished' : 'error',
          subject_urn: urn.interaction(ctx.tenantId, composed.interactionId),
          payload: {
            agent_type: 'pipeline-coach',
            tool_calls: [],
            citation_count: 0,
            tokens_total: 0,
            workflow: 'daily_push',
            skipped: result.skipped ?? false,
            reason: result.skippedReason ?? result.error ?? null,
            priority_count: composed.priorities.length,
            budget_used: result.budgetUsed ?? null,
            budget_limit: result.budgetLimit ?? null,
          },
        })

        return result
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
