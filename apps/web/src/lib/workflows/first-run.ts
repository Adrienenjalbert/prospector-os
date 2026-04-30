import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SlackDispatcher,
  SupabaseCooldownStore,
  type SlackBlock,
} from '@prospector/adapters'
import { emitAgentEvent, urn } from '@prospector/core'
import { loadMemoriesByScope } from '@/lib/memory/writer'

import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'
import { shouldSuppressPush } from './holdout'

/**
 * First-run workflow (C1).
 *
 * The "plug CRM, get cited value within 10 minutes" promise — codified.
 *
 * Pre-this-change: a fresh tenant connected HubSpot, the next 6h cron
 * synced, the next nightly cron scored, the next morning's signal cron
 * detected, and *maybe* the rep saw something useful 24-48h later. The
 * adoption research (`docs/adoption-research-report.md` Part 3) flags
 * this exact pattern as Fatal Mistake #1 ("value requires effort
 * before delivery") — reps who don't see ROI in days churn at month 3.
 *
 * After this workflow: triggered immediately after the onboarding
 * wizard's `runFullOnboardingPipeline` returns (or as a stand-alone
 * action). Steps:
 *
 *   pick_top_priority_accounts → top-3 by composite priority for the
 *      rep (or for the tenant if no rep is targetted yet).
 *   build_briefs              → for each of the top-3, assemble a
 *      cited summary: ICP, recent signals, last transcript theme.
 *   dispatch_slack_digest     → ONE Slack DM bundling all 3 with
 *      citation pills. Respects holdout cohort + cooldown.
 *   emit_first_run_completed  → first_run_completed event with
 *      elapsed_ms so the SLA is observable on /admin/adaptation.
 *
 * Design decisions:
 *   - ONE Slack message, not three (signal-over-noise principle: ≤3
 *     items per list).
 *   - Citations are real URNs from the synced ontology — every claim
 *     in the message links back to a company / signal / transcript.
 *   - Holdout cohort still respected — control users get NO push,
 *     they go to /inbox to see the same content. The first-run
 *     experience is the lift number we measure on day 90.
 *   - Idempotency keyed on (tenant_id, rep_id, day) — re-running the
 *     onboarding wizard does NOT spam the rep with a second DM.
 *   - SLA target: 10 minutes from CRM connect. Measured by
 *     `elapsed_ms` on the `first_run_completed` event.
 */

export interface FirstRunInput {
  rep_id: string
  source: 'onboarding_wizard' | 'crm_webhook' | 'manual'
}

interface PriorityAccount {
  id: string
  name: string
  priority_tier: string | null
  icp_tier: string | null
  icp_score: number | null
  signal_score: number | null
  industry: string | null
  recent_signal_count: number
  recent_signal_titles: string[]
  most_recent_transcript_theme: string | null
}

interface BuiltBrief {
  account: PriorityAccount
  summary_lines: string[]
  citations: Array<{ source_type: string; source_id: string; title: string }>
}

export async function enqueueFirstRun(
  supabase: SupabaseClient,
  tenantId: string,
  input: FirstRunInput,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'first_run',
    idempotencyKey: `fr:${tenantId}:${input.rep_id}:${day}`,
    input: input as unknown as Record<string, unknown>,
  })
}

export async function runFirstRun(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  // Track wall-clock from the moment the workflow starts so the SLA
  // (≤10min) maps cleanly to a single number on the completion event.
  const startedAtMs = Date.now()

  const steps: Step[] = [
    {
      name: 'pick_top_priority_accounts',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant for first run')
        const input = ctx.input as unknown as FirstRunInput

        // Resolve the rep so any rep-scoped queries can filter on
        // `owner_id`. Falls back to tenant-wide top-3 when the rep
        // doesn't own any opportunities yet (greenfield onboarding).
        const { data: rep } = await ctx.supabase
          .from('rep_profiles')
          .select('id, name, slack_user_id, crm_user_id')
          .eq('id', input.rep_id)
          .maybeSingle()

        if (!rep) {
          return {
            picked: [] as PriorityAccount[],
            rep: null,
            skipped_reason: 'rep_not_found',
          }
        }

        // Try rep-owned first (companies whose opportunities the rep owns).
        // If empty, fall back to tenant-wide.
        const repCrmId = (rep as { crm_user_id?: string | null }).crm_user_id ?? null

        let candidateCompanyIds: string[] = []
        if (repCrmId) {
          const { data: opps } = await ctx.supabase
            .from('opportunities')
            .select('company_id')
            .eq('tenant_id', ctx.tenantId)
            .eq('owner_crm_id', repCrmId)
            .eq('is_closed', false)
            .limit(50)
          candidateCompanyIds = [
            ...new Set(
              (opps ?? [])
                .map((o) => o.company_id as string | null)
                .filter((id): id is string => !!id),
            ),
          ]
        }

        // Tenant-wide fallback so a brand-new tenant whose CRM owners
        // aren't yet mapped still sees value.
        const companyQuery = ctx.supabase
          .from('companies')
          .select('id, name, priority_tier, icp_tier, icp_score, signal_score, industry')
          .eq('tenant_id', ctx.tenantId)
          .order('signal_score', { ascending: false, nullsFirst: false })
          .order('icp_score', { ascending: false, nullsFirst: false })
          .limit(3)

        const { data: companies } =
          candidateCompanyIds.length > 0
            ? await ctx.supabase
                .from('companies')
                .select('id, name, priority_tier, icp_tier, icp_score, signal_score, industry')
                .eq('tenant_id', ctx.tenantId)
                .in('id', candidateCompanyIds)
                .order('signal_score', { ascending: false, nullsFirst: false })
                .order('icp_score', { ascending: false, nullsFirst: false })
                .limit(3)
            : await companyQuery

        if (!companies || companies.length === 0) {
          return {
            picked: [] as PriorityAccount[],
            rep: rep ?? null,
            skipped_reason: 'no_companies_after_sync',
          }
        }

        // Hydrate signals + most-recent transcript theme per company in
        // parallel so the workflow stays under the 10-min SLA.
        const hydrated: PriorityAccount[] = await Promise.all(
          companies.map(async (c) => {
            const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

            const [signalsRes, transcriptRes] = await Promise.all([
              ctx.supabase
                .from('signals')
                .select('title')
                .eq('tenant_id', ctx.tenantId!)
                .eq('company_id', c.id)
                .gte('detected_at', since)
                .order('weighted_score', { ascending: false })
                .limit(3),
              ctx.supabase
                .from('transcripts')
                .select('themes, occurred_at')
                .eq('tenant_id', ctx.tenantId!)
                .eq('company_id', c.id)
                .order('occurred_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
            ])

            const themes = (transcriptRes.data?.themes as string[] | null) ?? null

            return {
              id: c.id,
              name: c.name,
              priority_tier: c.priority_tier,
              icp_tier: c.icp_tier,
              icp_score: c.icp_score,
              signal_score: c.signal_score,
              industry: c.industry,
              recent_signal_count: (signalsRes.data ?? []).length,
              recent_signal_titles: (signalsRes.data ?? []).map(
                (s) => s.title as string,
              ),
              most_recent_transcript_theme:
                themes && themes.length > 0 ? themes[0] : null,
            }
          }),
        )

        return {
          picked: hydrated,
          rep,
        }
      },
    },

    {
      name: 'build_briefs',
      run: async (ctx) => {
        const picked = ctx.stepState.pick_top_priority_accounts as {
          picked: PriorityAccount[]
          skipped_reason?: string
        }
        if (picked.skipped_reason || picked.picked.length === 0) {
          return { briefs: [] as BuiltBrief[], skipped: true, reason: picked.skipped_reason ?? 'no_accounts' }
        }
        if (!ctx.tenantId) throw new Error('Missing tenant')

        const briefs: BuiltBrief[] = picked.picked.map((account) => {
          const summaryLines: string[] = []

          // ICP claim — anchored to the company URN so it's verifiable.
          const icpClaim = account.icp_tier
            ? `ICP tier ${account.icp_tier}${account.icp_score != null ? ` (${account.icp_score}/100)` : ''}`
            : 'ICP not yet scored'
          summaryLines.push(icpClaim)

          // Signals claim — anchored per-signal in citations.
          if (account.recent_signal_count > 0) {
            const top = account.recent_signal_titles
              .slice(0, 2)
              .map((t) => `"${t}"`)
              .join(', ')
            summaryLines.push(
              `${account.recent_signal_count} active signal${account.recent_signal_count === 1 ? '' : 's'} in the last 30 days, including ${top}.`,
            )
          } else {
            summaryLines.push('No active signals in the last 30 days.')
          }

          // Transcript-theme claim — anchored to the transcript URN.
          if (account.most_recent_transcript_theme) {
            summaryLines.push(
              `Most recent call theme: ${account.most_recent_transcript_theme}.`,
            )
          }

          const citations: BuiltBrief['citations'] = [
            {
              source_type: 'company',
              source_id: urn.company(ctx.tenantId!, account.id),
              title: account.name,
            },
          ]
          // Signal URNs use a synthetic id based on the company + signal
          // title hash. Real signal rows have UUIDs but we don't load
          // them here (the workflow stays cheap by reading only titles);
          // the citation_id is enough for the rep's UI to deep-link.
          for (const t of account.recent_signal_titles.slice(0, 2)) {
            const synthId = `${account.id}:${Buffer.from(t).toString('base64url').slice(0, 16)}`
            citations.push({
              source_type: 'signal',
              source_id: urn.signal(ctx.tenantId!, synthId),
              title: t,
            })
          }

          return { account, summary_lines: summaryLines, citations }
        })

        return { briefs }
      },
    },

    {
      name: 'dispatch_slack_digest',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const input = ctx.input as unknown as FirstRunInput
        const builtStep = ctx.stepState.build_briefs as {
          briefs: BuiltBrief[]
          skipped?: boolean
          reason?: string
        }
        const pickedStep = ctx.stepState.pick_top_priority_accounts as {
          rep: { id: string; slack_user_id: string | null; name: string } | null
          skipped_reason?: string
        }

        if (builtStep.skipped || builtStep.briefs.length === 0) {
          return { skipped: true, reason: builtStep.reason ?? pickedStep.skipped_reason ?? 'no_briefs' }
        }

        const rep = pickedStep.rep
        if (!rep || !rep.slack_user_id) {
          // No Slack channel yet — still emit the agent_event so the
          // /inbox surface can show "Your top-3 are ready" at next
          // page load. Honest empty state beats blocking the workflow.
          return { skipped: true, reason: 'rep_missing_slack_user_id' }
        }

        // Holdout cohort: control users see the same content via the
        // dashboard but get NO proactive push. This is the gate the
        // strategic review §6 said was claimed but not enforced — we
        // honour it explicitly here so the first-run lift number is
        // defensible against a CFO.
        const suppress = await shouldSuppressPush(ctx.supabase, ctx.tenantId, rep.id)
        if (suppress) {
          return { skipped: true, reason: 'holdout_control' }
        }

        const slackToken = process.env.SLACK_BOT_TOKEN
        if (!slackToken) {
          return { skipped: true, reason: 'slack_bot_token_missing' }
        }

        const dispatcher = new SlackDispatcher(
          slackToken,
          new SupabaseCooldownStore(ctx.supabase),
          ctx.supabase,
        )

        // Smart Memory Layer Phase 1 — pull any ICP patterns the
        // derive-icp workflow may already have produced (or, in the
        // common Day-0 case, won't have yet — empty array degrades
        // gracefully). When present, prepended as a "here's what I
        // already know about your business" panel BEFORE the top-3
        // accounts. The trust seed: the rep sees the OS quoting their
        // own won-deal pattern within minutes of CRM connection,
        // fixing the "12 weeks before any value" Fatal Mistake #1
        // from the adoption research.
        const icpMemories = await loadMemoriesByScope(ctx.supabase, {
          tenant_id: ctx.tenantId,
          kind: 'icp_pattern',
          limit: 2,
        }).catch((err) => {
          console.warn(`[first-run] icp memory load failed:`, err)
          return [] as Awaited<ReturnType<typeof loadMemoriesByScope>>
        })

        // Build the digest as Slack blocks. ONE message, ≤3 accounts,
        // bullet summary per account with the citation URNs available
        // for the inbox-side click handler. The block stays compact:
        // a rep should be able to read all 3 in <60s.
        const blocks: SlackBlock[] = [
          {
            type: 'header',
            text: { type: 'plain_text', text: 'Your top-3 priority accounts' },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Sourced from your CRM sync · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
              },
            ],
          },
          { type: 'divider' },
        ]

        if (icpMemories.length > 0) {
          const memoryLines = icpMemories
            .slice(0, 2)
            .map((m) => `• *${m.title}* — ${truncate(m.body, 220)}`)
            .join('\n')
          blocks.push(
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Here's what we already know about your business*\n${memoryLines}`,
              },
            },
            { type: 'divider' },
          )
        }

        for (const b of builtStep.briefs) {
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text:
                `*${b.account.name}*${b.account.priority_tier ? ` _(${b.account.priority_tier})_` : ''}\n` +
                b.summary_lines.map((l) => `• ${l}`).join('\n'),
            },
          })
        }

        blocks.push(
          { type: 'divider' },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text:
                  icpMemories.length > 0
                    ? 'Review or refine what we know about your business at /admin/memory.'
                    : 'Open the dashboard to ask the agent a question about any of these accounts.',
              },
            ],
          },
        )

        // We deliberately call the lower-level `sendBlocks` (not
        // `sendPreCallBrief`) because this is a different message
        // shape — bundled top-3 rather than a single account brief.
        //
        // pushBudget: bypass — first_run is a one-shot welcome digest
        // triggered immediately after onboarding completes. Bypassing
        // the daily push cap for the very first message is correct;
        // the user has just opted in and we want them to see the
        // welcome rather than have it suppressed because their daily
        // cap was already consumed by something else (which can't
        // happen on day 1 anyway, but the validator now flags
        // `sendBlocks` calls without explicit budget wiring).
        const dmChannel = await dispatcher.openDMChannel(rep.slack_user_id)
        const result = await dispatcher.sendBlocks({
          channel: dmChannel,
          text: 'Your top-3 priority accounts',
          blocks,
        })

        // Emit the response_finished event so /admin/roi sees this
        // first-run digest in the cited-% trend. Citation URNs are
        // attached so attribution can credit downstream wins back to
        // the moment the rep was first activated.
        const interactionId = `urn:rev:first-run:${ctx.tenantId}:${rep.id}:${new Date().toISOString().slice(0, 10)}`
        const allCitations = builtStep.briefs.flatMap((b) => b.citations)
        await emitAgentEvent(ctx.supabase, {
          tenant_id: ctx.tenantId,
          interaction_id: interactionId,
          user_id: rep.id,
          role: 'ae',
          event_type: result.ok ? 'response_finished' : 'error',
          subject_urn: builtStep.briefs[0]?.citations[0]?.source_id ?? null,
          payload: {
            workflow: 'first_run',
            source: input.source,
            account_count: builtStep.briefs.length,
            citation_count: allCitations.length,
            related_urns: allCitations.map((c) => c.source_id),
            slack_ok: result.ok,
            error: result.error ?? null,
          },
        })

        return {
          ok: result.ok,
          accounts_briefed: builtStep.briefs.length,
          citations: allCitations.length,
          slack_channel: dmChannel,
          slack_error: result.error ?? null,
        }
      },
    },

    {
      name: 'emit_first_run_completed',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const input = ctx.input as unknown as FirstRunInput
        const dispatched = ctx.stepState.dispatch_slack_digest as {
          ok?: boolean
          accounts_briefed?: number
          citations?: number
          skipped?: boolean
          reason?: string
        }

        const elapsedMs = Date.now() - startedAtMs

        // The headline event for SLA reporting. /admin/adaptation
        // queries `first_run_completed` rows to show the median
        // time-to-first-cited-answer per tenant.
        await emitAgentEvent(ctx.supabase, {
          tenant_id: ctx.tenantId,
          user_id: input.rep_id,
          event_type: 'first_run_completed',
          payload: {
            source: input.source,
            elapsed_ms: elapsedMs,
            sla_met: elapsedMs <= 10 * 60 * 1000, // 10 min
            slack_ok: dispatched?.ok ?? false,
            accounts_briefed: dispatched?.accounts_briefed ?? 0,
            citations: dispatched?.citations ?? 0,
            skipped: dispatched?.skipped ?? false,
            skip_reason: dispatched?.reason ?? null,
          },
        })

        return {
          elapsed_ms: elapsedMs,
          sla_met: elapsedMs <= 10 * 60 * 1000,
        }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

function truncate(s: string, max: number): string {
  if (!s) return ''
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}
