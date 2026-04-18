import type { SupabaseClient } from '@supabase/supabase-js'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Prompt optimizer — weekly workflow. Collects positive + negative pairs
 * from the last 7 days, asks a strong model to propose prompt diffs that
 * fix negatives without breaking positives, and records the proposal in
 * `calibration_proposals` for human approval.
 *
 * This is the DSPy-style compile loop. Intentionally minimal — the judge
 * and rollback path are handled by the eval harness + calibration ledger.
 */

export async function enqueuePromptOptimizer(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const week = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'prompt_optimizer',
    idempotencyKey: `po:${tenantId}:${week}`,
    input: { week },
  })
}

export async function runPromptOptimizer(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'collect_pairs',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

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

        return { negative_ids: negativeIds, positive_ids: positiveIds }
      },
    },
    {
      name: 'propose_diff',
      run: async (ctx) => {
        const { negative_ids, positive_ids } = ctx.stepState.collect_pairs as {
          negative_ids: string[]
          positive_ids: string[]
        }

        // We don't have enough signal yet — bail out and let the next run try.
        if (negative_ids.length < 3) {
          return { proposal: null, reason: 'insufficient_negatives' }
        }

        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { data: profile } = await ctx.supabase
          .from('business_profiles')
          .select('system_prompt_template, prompt_version')
          .eq('tenant_id', ctx.tenantId)
          .maybeSingle()

        // The actual LLM-driven diff generation is deliberately deferred to
        // the selfImprove workflow (which uses generateObject with a typed
        // schema). We persist a proposal record here so the pipeline is real
        // even before the model call lands; the next phase fills in the diff.
        const proposal = {
          tenant_id: ctx.tenantId,
          proposal_type: 'system_prompt_diff',
          proposed_config: {
            base_prompt_version: profile?.prompt_version ?? 'v1',
            negative_sample_size: negative_ids.length,
            positive_sample_size: positive_ids.length,
            status: 'pending_generation',
          },
          created_at: new Date().toISOString(),
        }

        const { error } = await ctx.supabase
          .from('calibration_proposals')
          .insert(proposal)
        if (error) {
          console.warn('[prompt-optimizer] calibration_proposals insert:', error.message)
        }

        return { proposal }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
