import type { SupabaseClient } from '@supabase/supabase-js'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Nightly workflow that turns real production failures into pending eval
 * cases. Three auto-promotion rules:
 *
 *   1. Every thumbs-down interaction → eval case (question + expected non-
 *      empty citation set that matches what the response DIDN'T provide).
 *   2. Every response_finished with citation_count = 0 → eval case demanding
 *      at least one citation.
 *   3. Every tool_error event → eval case ensuring the failure mode doesn't
 *      return (categorised by tool name so you can see regressions per tool).
 *
 * Cases land in `eval_cases` with status='pending_review'. An admin or the
 * selfImproveWorkflow (Phase 7g) accepts/rejects them. Accepted cases go
 * into the nightly eval run; rejected cases are quietly discarded.
 */

export async function enqueueEvalGrowth(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'eval_growth',
    idempotencyKey: `eg:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runEvalGrowth(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'pull_failures',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant for eval growth')

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

        const { data: feedbackRows } = await ctx.supabase
          .from('agent_events')
          .select('interaction_id, payload, occurred_at')
          .eq('tenant_id', ctx.tenantId)
          .eq('event_type', 'feedback_given')
          .gte('occurred_at', since)

        const negativeInteractions = (feedbackRows ?? [])
          .filter((r) => {
            const payload = r.payload as { value?: string }
            return payload?.value === 'negative' || payload?.value === 'thumbs_down'
          })
          .map((r) => r.interaction_id as string)

        const { data: responses } = await ctx.supabase
          .from('agent_events')
          .select('interaction_id, payload, role')
          .eq('tenant_id', ctx.tenantId)
          .eq('event_type', 'response_finished')
          .gte('occurred_at', since)

        const zeroCitation = (responses ?? []).filter((r) => {
          const payload = r.payload as { citation_count?: number }
          return (payload?.citation_count ?? 0) === 0
        })

        const { data: toolErrors } = await ctx.supabase
          .from('agent_events')
          .select('interaction_id, payload, role')
          .eq('tenant_id', ctx.tenantId)
          .eq('event_type', 'tool_error')
          .gte('occurred_at', since)

        return {
          negativeInteractions,
          zero_citation_count: zeroCitation.length,
          zero_citation_examples: zeroCitation.slice(0, 20).map((r) => r.interaction_id),
          tool_error_count: toolErrors?.length ?? 0,
          tool_error_examples: (toolErrors ?? []).slice(0, 20).map((r) => r.interaction_id),
        }
      },
    },
    {
      name: 'promote_cases',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const pulled = ctx.stepState.pull_failures as {
          negativeInteractions: string[]
          zero_citation_examples: string[]
          tool_error_examples: string[]
        }

        const allIds = [
          ...new Set([
            ...pulled.negativeInteractions,
            ...pulled.zero_citation_examples,
            ...pulled.tool_error_examples,
          ]),
        ]
        if (allIds.length === 0) return { promoted: 0 }

        const { data: interactions } = await ctx.supabase
          .from('agent_interaction_outcomes')
          .select('id, query_type, query_summary, response_summary, rep_crm_id')
          .in('id', allIds)

        const rows = (interactions ?? []).map((i) => {
          const origin = pulled.negativeInteractions.includes(i.id)
            ? 'thumbs_down'
            : pulled.zero_citation_examples.includes(i.id)
              ? 'no_citation'
              : 'tool_error'

          return {
            tenant_id: ctx.tenantId,
            origin,
            category: 'concierge',
            status: 'pending_review',
            question: i.query_summary ?? '',
            expected_citation_types: origin === 'no_citation' ? ['company', 'opportunity'] : [],
            source_interaction_id: i.id,
            notes: `Auto-promoted from ${origin}. Original response: ${(i.response_summary ?? '').slice(0, 200)}`,
          }
        })

        if (rows.length === 0) return { promoted: 0 }

        // Upsert on the (tenant_id, source_interaction_id) unique index
        // added in migration 017. `ignoreDuplicates: true` makes nightly
        // re-runs cheap: we attempt to promote the same failure, the
        // index rejects, the workflow keeps going. Without dedup the
        // /admin/evals page used to fill with one new row per failure
        // per night until the 24h lookback expired.
        const { error } = await ctx.supabase
          .from('eval_cases')
          .upsert(rows, {
            onConflict: 'tenant_id,source_interaction_id',
            ignoreDuplicates: true,
          })
        if (error) throw new Error(`eval_cases upsert: ${error.message}`)

        return { promoted: rows.length }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
