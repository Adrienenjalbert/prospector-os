import type { SupabaseClient } from '@supabase/supabase-js'
import { generateObject } from 'ai'
import { PromptDiffSchema } from '@prospector/core'
import { getModel } from '@/lib/agent/model-registry'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Prompt optimiser (C6.1) — weekly per-tenant Opus call that proposes
 * a structured prompt diff against the current `agent_personality`
 * skill, grounded in the last 7 days of negative + positive
 * interactions.
 *
 * Pre-this-change this workflow inserted a `pending_generation`
 * placeholder row whose proposal_type column didn't even exist in
 * the schema (silent insert failure). The "self-improving by
 * default" claim was theatre.
 *
 * After this change:
 *   - Loads positive + negative interactions over the last 14 days
 *     (wider window than the original 7 to give the optimiser more
 *     signal).
 *   - Loads the active `agent_personality` skill body — the prompt
 *     the agent uses today.
 *   - Calls Opus with `generateObject(PromptDiffSchema)` returning a
 *     fully-typed diff: rationale_summary, proposed_prompt_body,
 *     change list, expected_lift estimate.
 *   - Persists as `calibration_proposals` with the schema-correct
 *     columns (config_type, current_config, proposed_config,
 *     analysis) — the rollback API and adaptation page work as
 *     designed.
 *   - Cost: ~$0.50/tenant/week (Opus, ~5k input + 2k output once
 *     per week per tenant).
 *
 * Quality gates layered on top:
 *   - Bail when fewer than 3 negative interactions in the window.
 *   - Bail when the active skill row is missing.
 *   - Bail when expected_lift is negative — the optimiser admitted
 *     it would make things worse; don't ship the proposal.
 */

const NEG_THRESHOLD = 3
const HISTORY_DAYS = 14

export async function enqueuePromptOptimizer(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const week = isoWeekKey(new Date())
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'prompt_optimizer',
    idempotencyKey: `po:${tenantId}:${week}`,
    input: { week },
  })
}

function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

interface CollectedSignal {
  negative_summaries: string[]
  positive_summaries: string[]
}

export async function runPromptOptimizer(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'collect_pairs',
      run: async (ctx): Promise<CollectedSignal | { skipped: true; reason: string }> => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(
          Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()

        const { data: feedback } = await ctx.supabase
          .from('agent_events')
          .select('interaction_id, payload')
          .eq('tenant_id', ctx.tenantId)
          .eq('event_type', 'feedback_given')
          .gte('occurred_at', since)

        const negativeIds: string[] = []
        const positiveIds: string[] = []
        for (const f of feedback ?? []) {
          const payload = f.payload as { value?: string }
          if (!f.interaction_id) continue
          if (payload?.value === 'negative' || payload?.value === 'thumbs_down') {
            negativeIds.push(f.interaction_id)
          } else if (payload?.value === 'positive' || payload?.value === 'thumbs_up') {
            positiveIds.push(f.interaction_id)
          }
        }

        if (negativeIds.length < NEG_THRESHOLD) {
          return { skipped: true, reason: `insufficient_negatives (${negativeIds.length} < ${NEG_THRESHOLD})` }
        }

        // Pull the corresponding interaction rows for context.
        const allIds = [...new Set([...negativeIds.slice(0, 30), ...positiveIds.slice(0, 30)])]
        const { data: interactions } = await ctx.supabase
          .from('agent_interaction_outcomes')
          .select('id, query_summary, response_summary, query_type, feedback')
          .in('id', allIds)

        const negSet = new Set(negativeIds)
        const posSet = new Set(positiveIds)

        const negative_summaries: string[] = []
        const positive_summaries: string[] = []
        for (const i of interactions ?? []) {
          const summary = `Q: ${(i.query_summary ?? '').slice(0, 240)}\nA: ${(i.response_summary ?? '').slice(0, 480)}`
          if (negSet.has(i.id) || i.feedback === 'negative') {
            negative_summaries.push(summary)
          } else if (posSet.has(i.id)) {
            positive_summaries.push(summary)
          }
        }

        return {
          negative_summaries: negative_summaries.slice(0, 10),
          positive_summaries: positive_summaries.slice(0, 5),
        }
      },
    },
    {
      name: 'propose_diff',
      run: async (ctx) => {
        const collected = ctx.stepState.collect_pairs as
          | CollectedSignal
          | { skipped: true; reason: string }
        if ('skipped' in collected && collected.skipped) {
          return { skipped: true, reason: collected.reason }
        }

        if (!ctx.tenantId) throw new Error('Missing tenant')

        // Read the active agent_personality skill — that's the
        // canonical prompt body the agent uses today.
        const { data: activeSkill } = await ctx.supabase
          .from('business_skills')
          .select('id, content_text, version')
          .eq('tenant_id', ctx.tenantId)
          .eq('skill_type', 'agent_personality')
          .eq('active', true)
          .maybeSingle()

        if (!activeSkill?.content_text) {
          return { skipped: true, reason: 'no_active_personality_skill' }
        }

        const promptForOpus = `You are a senior prompt engineer for a sales-AI agent.

Your tenant's current personality prompt body is:
"""
${activeSkill.content_text.slice(0, 4000)}
"""

In the last ${HISTORY_DAYS} days, real reps gave the agent NEGATIVE feedback on these turns:
${(collected as CollectedSignal).negative_summaries.map((s, i) => `\nNEG ${i + 1}:\n${s}`).join('\n')}

Real reps gave POSITIVE feedback on these turns (preserve what's working):
${(collected as CollectedSignal).positive_summaries.map((s, i) => `\nPOS ${i + 1}:\n${s}`).join('\n')}

Your task: propose a SURGICAL revision of the personality prompt that
fixes the patterns the negatives reveal WITHOUT breaking the
positives. Be specific:
  - Each "change" entry must point to a section header in the prompt body.
  - Total changes ≤ 5. Resist the urge to rewrite the whole prompt.
  - "expected_lift" should be conservative (-0.05 to +0.10 typical).
    A negative number is acceptable when you genuinely think the
    proposal is wrong but you're being asked to produce one — the
    workflow will reject negative-lift proposals.

Output strictly the schema. No prose around it.`

        let object: typeof PromptDiffSchema._type
        try {
          const result = await generateObject({
            model: getModel('anthropic/claude-opus-4'),
            schema: PromptDiffSchema,
            prompt: promptForOpus,
            maxTokens: 3000,
            temperature: 0.4,
          })
          object = result.object
        } catch (err) {
          // Opus rate limit / network — bail. Next week's run tries again.
          return {
            skipped: true,
            reason: `opus_call_failed: ${err instanceof Error ? err.message : String(err)}`,
          }
        }

        // Quality gate: refuse to ship a proposal whose own author
        // says will hurt. We persist nothing in this case so the
        // operator's adaptation feed stays clean.
        if (object.expected_lift < 0) {
          return {
            skipped: true,
            reason: `negative_expected_lift (${object.expected_lift.toFixed(2)})`,
          }
        }

        const { error } = await ctx.supabase
          .from('calibration_proposals')
          .insert({
            tenant_id: ctx.tenantId,
            config_type: 'prompt',
            current_config: {
              skill_type: 'agent_personality',
              skill_version: activeSkill.version,
              prompt_body: activeSkill.content_text,
            },
            proposed_config: {
              skill_type: 'agent_personality',
              prompt_body: object.proposed_prompt_body,
            },
            analysis: {
              source: 'prompt_optimizer',
              rationale_summary: object.rationale_summary,
              changes: object.changes,
              expected_lift: object.expected_lift,
              negative_sample_size: (collected as CollectedSignal).negative_summaries.length,
              positive_sample_size: (collected as CollectedSignal).positive_summaries.length,
              generated_at: new Date().toISOString(),
            },
            status: 'pending',
          })
        if (error) {
          throw new Error(`prompt_optimizer proposal insert: ${error.message}`)
        }

        return {
          proposed: true,
          changes: object.changes.length,
          expected_lift: object.expected_lift,
        }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
