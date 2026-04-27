import type { SupabaseClient } from '@supabase/supabase-js'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Exemplar miner — nightly workflow that harvests positive interactions and
 * promotes them into few-shot exemplars stored on `business_profiles.exemplars`.
 *
 * Definition of "positive":
 *   - feedback_given with value='positive' (explicit thumbs up), OR
 *   - action_invoked within 14 days of the response_finished for the same
 *     subject_urn (implicit: the user did something with the answer).
 *
 * Top K per (role, intent_class) are stored. The agent surface prompt
 * builders (apps/web/src/lib/agent/agents/*.ts) read them via
 * `loadActiveBusinessSkills` / `composeSkillsForPrompt` and include them
 * in the system prompt for matching sessions.
 */

export async function enqueueExemplarMiner(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'exemplar_miner',
    idempotencyKey: `em:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runExemplarMiner(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'collect_positives',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

        // Pull all `feedback_given` events in the window, then filter
        // for explicit positives. The previous implementation skipped
        // the filter entirely and treated thumbs-DOWN rows as positives
        // — silently learning the WRONG signal. The reader-side
        // payload key is `value` (`{ value: 'positive' | 'negative' }`),
        // matching what `recordAgentFeedback` writes in
        // `apps/web/src/app/actions/implicit-feedback.ts`.
        // We accept the legacy `payload.feedback` shape for historical
        // events written by older callers.
        const [feedbackEvents, actionsInvoked] = await Promise.all([
          ctx.supabase
            .from('agent_events')
            .select('interaction_id, payload')
            .eq('tenant_id', ctx.tenantId)
            .eq('event_type', 'feedback_given')
            .gte('occurred_at', since),
          ctx.supabase
            .from('agent_events')
            .select('interaction_id')
            .eq('tenant_id', ctx.tenantId)
            .eq('event_type', 'action_invoked')
            .gte('occurred_at', since),
        ])

        const positiveIds = new Set<string>()
        for (const row of feedbackEvents.data ?? []) {
          if (!row.interaction_id) continue
          const payload = row.payload as { value?: string; feedback?: string } | null
          const verdict = payload?.value ?? payload?.feedback
          if (verdict === 'positive' || verdict === 'thumbs_up') {
            positiveIds.add(row.interaction_id)
          }
        }
        // `action_invoked` is an implicit-positive signal: the rep did
        // something with the response. Strong but lower confidence than
        // explicit thumbs-up; we still let it contribute since silent
        // engagement is often the only feedback we get.
        for (const row of actionsInvoked.data ?? []) {
          if (row.interaction_id) positiveIds.add(row.interaction_id)
        }

        if (positiveIds.size === 0) return { interactions: [] }

        // Defence in depth: cross-check against the per-interaction
        // outcome row. If `agent_interaction_outcomes.feedback` is
        // explicitly NEGATIVE, drop the interaction even when an
        // event-stream signal said positive — the outcome row is the
        // canonical truth (some interactions get a thumbs-up then a
        // thumbs-down correction; the outcome row reflects the latest
        // user verdict).
        const { data: interactions } = await ctx.supabase
          .from('agent_interaction_outcomes')
          .select('id, query_type, query_summary, response_summary, feedback')
          .in('id', Array.from(positiveIds))
          .or('feedback.is.null,feedback.neq.negative')

        // Join to the interaction_started event to recover role + intent_class.
        const { data: starts } = await ctx.supabase
          .from('agent_events')
          .select('interaction_id, role, payload')
          .eq('tenant_id', ctx.tenantId)
          .eq('event_type', 'interaction_started')
          .in('interaction_id', Array.from(positiveIds))

        const startByInteraction = new Map<string, { role: string; intent_class: string }>()
        for (const s of starts ?? []) {
          const payload = s.payload as { intent_class?: string } | null
          if (s.interaction_id) {
            startByInteraction.set(s.interaction_id, {
              role: s.role ?? 'rep',
              intent_class: payload?.intent_class ?? 'general_query',
            })
          }
        }

        const enriched = (interactions ?? []).map((i) => ({
          id: i.id,
          role: startByInteraction.get(i.id)?.role ?? 'rep',
          intent_class: startByInteraction.get(i.id)?.intent_class ?? 'general_query',
          question: i.query_summary ?? '',
          response: i.response_summary ?? '',
        }))

        return { interactions: enriched }
      },
    },
    {
      name: 'write_exemplars',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { interactions } = ctx.stepState.collect_positives as {
          interactions: Array<{
            id: string
            role: string
            intent_class: string
            question: string
            response: string
          }>
        }

        if (interactions.length === 0) return { groups: 0 }

        // Group by (role, intent_class), keep top 3 by response length (proxy
        // for richness until we add a quality score).
        const groups = new Map<string, typeof interactions>()
        for (const i of interactions) {
          const key = `${i.role}:${i.intent_class}`
          const list = groups.get(key) ?? []
          list.push(i)
          groups.set(key, list)
        }

        const exemplars: Record<string, { role: string; intent_class: string; q: string; a: string }[]> = {}
        for (const [key, list] of groups) {
          const top = [...list]
            .sort((a, b) => (b.response?.length ?? 0) - (a.response?.length ?? 0))
            .slice(0, 3)
            .map((i) => ({
              role: i.role,
              intent_class: i.intent_class,
              q: (i.question ?? '').slice(0, 300),
              a: (i.response ?? '').slice(0, 800),
            }))
          exemplars[key] = top
        }

        await ctx.supabase
          .from('business_profiles')
          .update({
            exemplars,
            prompt_version: `v${Math.floor(Date.now() / 1000)}`,
          })
          .eq('tenant_id', ctx.tenantId)

        return { groups: groups.size, exemplars_count: Object.values(exemplars).flat().length }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
