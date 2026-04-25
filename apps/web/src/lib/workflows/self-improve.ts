import type { SupabaseClient } from '@supabase/supabase-js'
import { generateObject } from 'ai'
import { ClusterSummarySchema, type ClusterSummary } from '@prospector/core'
import { getModel } from '@/lib/agent/model-registry'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Self-improve workflow (C6.2). Weekly per-tenant cycle:
 *   1. Pull last 7 days of failure events (tool_error,
 *      feedback_given negative, zero-citation responses).
 *   2. Cluster categorically by (tool_name) + (intent_class).
 *      Embedding-based HDBSCAN is the longer-term plan; categorical
 *      clusters are the high-precision starting point and avoid
 *      a heavy clustering dep.
 *   3. For the TOP 3 clusters by impact (count × user weight), call
 *      Sonnet ONCE per cluster with `generateObject(ClusterSummarySchema)`
 *      to produce a structured theme + proposed engineering fix +
 *      sample interaction URNs.
 *   4. Persist as `improvement_reports` with kind='failure_cluster'
 *      (migration 019), structured payload in the new `metrics` JSONB.
 *      Markdown view is kept for /admin/adaptation backwards compat.
 *
 * Cost: ≤ 3 Sonnet calls/tenant/week (~$0.10/tenant/week). Skipped
 * entirely if there are no failures in the window.
 */

export async function enqueueSelfImprove(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'self_improve',
    idempotencyKey: `si:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runSelfImprove(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'pull_failure_events',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

        const [toolErrors, feedback, zeroCitation] = await Promise.all([
          ctx.supabase
            .from('agent_events')
            .select('interaction_id, payload, role')
            .eq('tenant_id', ctx.tenantId)
            .eq('event_type', 'tool_error')
            .gte('occurred_at', since),
          ctx.supabase
            .from('agent_events')
            .select('interaction_id, payload')
            .eq('tenant_id', ctx.tenantId)
            .eq('event_type', 'feedback_given')
            .gte('occurred_at', since),
          ctx.supabase
            .from('agent_events')
            .select('interaction_id, payload, role')
            .eq('tenant_id', ctx.tenantId)
            .eq('event_type', 'response_finished')
            .gte('occurred_at', since),
        ])

        return {
          tool_errors: toolErrors.data ?? [],
          feedback: feedback.data ?? [],
          zero_citation: (zeroCitation.data ?? []).filter((r) => {
            const p = r.payload as { citation_count?: number }
            return (p?.citation_count ?? 0) === 0
          }),
        }
      },
    },
    {
      name: 'cluster',
      run: async (ctx) => {
        const pulled = ctx.stepState.pull_failure_events as {
          tool_errors: Array<{ payload: { tool_name?: string } }>
          feedback: Array<{ payload: { value?: string } }>
          zero_citation: Array<{ payload: { intent_class?: string } }>
        }

        const toolErrorsByTool = new Map<string, number>()
        for (const t of pulled.tool_errors) {
          const name = t.payload?.tool_name ?? 'unknown'
          toolErrorsByTool.set(name, (toolErrorsByTool.get(name) ?? 0) + 1)
        }

        const zeroCitationByIntent = new Map<string, number>()
        for (const r of pulled.zero_citation) {
          const intent = r.payload?.intent_class ?? 'unknown'
          zeroCitationByIntent.set(intent, (zeroCitationByIntent.get(intent) ?? 0) + 1)
        }

        const negativeCount = pulled.feedback.filter((f) => {
          const v = f.payload?.value
          return v === 'negative' || v === 'thumbs_down'
        }).length

        return {
          tool_errors_by_tool: Object.fromEntries(toolErrorsByTool),
          zero_citation_by_intent: Object.fromEntries(zeroCitationByIntent),
          negative_feedback_count: negativeCount,
        }
      },
    },
    {
      name: 'enrich_clusters_with_llm',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const clusters = ctx.stepState.cluster as {
          tool_errors_by_tool: Record<string, number>
          zero_citation_by_intent: Record<string, number>
          negative_feedback_count: number
        }
        const pulled = ctx.stepState.pull_failure_events as {
          tool_errors: Array<{ interaction_id: string | null; payload: { tool_name?: string; error?: string } }>
          zero_citation: Array<{ interaction_id: string | null; payload: { intent_class?: string } }>
        }

        // Build candidate clusters with sample interaction URNs.
        type Candidate = {
          theme_seed: string
          source: 'tool_error' | 'zero_citation'
          sample_count: number
          sample_urns: string[]
          sample_errors: string[]
        }
        const candidates: Candidate[] = []
        for (const [tool, count] of Object.entries(clusters.tool_errors_by_tool)) {
          const samples = pulled.tool_errors
            .filter((e) => (e.payload?.tool_name ?? 'unknown') === tool)
            .slice(0, 5)
          candidates.push({
            theme_seed: `tool '${tool}' errors`,
            source: 'tool_error',
            sample_count: count,
            sample_urns: samples.map((s) => `urn:rev:${ctx.tenantId}:interaction:${s.interaction_id}`),
            sample_errors: samples.map((s) => String(s.payload?.error ?? '')).filter(Boolean),
          })
        }
        for (const [intent, count] of Object.entries(clusters.zero_citation_by_intent)) {
          const samples = pulled.zero_citation
            .filter((e) => (e.payload?.intent_class ?? 'unknown') === intent)
            .slice(0, 5)
          candidates.push({
            theme_seed: `zero-citation responses on intent '${intent}'`,
            source: 'zero_citation',
            sample_count: count,
            sample_urns: samples.map((s) => `urn:rev:${ctx.tenantId}:interaction:${s.interaction_id}`),
            sample_errors: [],
          })
        }

        // Top-3 by sample count — Sonnet calls only on the high-impact
        // clusters, keeping per-tenant weekly cost ≤ 3 calls.
        const top = candidates.sort((a, b) => b.sample_count - a.sample_count).slice(0, 3)
        const summaries: ClusterSummary[] = []

        for (const cand of top) {
          try {
            const prompt = `You are an SRE-grade reviewer for a sales AI agent. Summarise this failure cluster:

Theme seed: ${cand.theme_seed}
Sample count: ${cand.sample_count}
Source: ${cand.source}
${cand.sample_errors.length > 0 ? `\nSample error messages:\n${cand.sample_errors.map((e) => `- ${e.slice(0, 200)}`).join('\n')}` : ''}

Sample interaction URNs (cite up to 5 in evidence_urns):
${cand.sample_urns.slice(0, 5).join('\n')}

Produce a single ClusterSummary describing the theme, user impact,
and a CONCRETE engineering or config fix the on-call should attempt.
Be specific — don't say "improve error handling"; say what specifically
to validate, prompt, or guard against.`

            const { object } = await generateObject({
              model: getModel('anthropic/claude-sonnet-4'),
              schema: ClusterSummarySchema,
              prompt,
              maxTokens: 800,
              temperature: 0.2,
            })
            summaries.push(object)
          } catch (err) {
            console.warn(
              '[self-improve] cluster summary failed:',
              cand.theme_seed,
              err instanceof Error ? err.message : err,
            )
            // Fall back to a deterministic summary so the report still
            // surfaces the cluster — degraded but visible.
            summaries.push({
              theme: cand.theme_seed,
              sample_count: cand.sample_count,
              user_impact: cand.sample_count > 5 ? 'medium' : 'low',
              proposed_fix:
                'Sonnet enrichment failed — inspect sample URNs manually and consider adding input validation or a citation-required prompt instruction.',
              evidence_urns: cand.sample_urns.slice(0, 5),
            })
          }
        }

        return { cluster_summaries: summaries, candidates_count: candidates.length }
      },
    },
    {
      name: 'write_report',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const clusters = ctx.stepState.cluster as {
          tool_errors_by_tool: Record<string, number>
          zero_citation_by_intent: Record<string, number>
          negative_feedback_count: number
        }
        const enriched = ctx.stepState.enrich_clusters_with_llm as {
          cluster_summaries: ClusterSummary[]
          candidates_count: number
        }

        const failureClusterCount =
          Object.keys(clusters.tool_errors_by_tool).length +
          Object.keys(clusters.zero_citation_by_intent).length

        const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const periodEnd = new Date().toISOString()

        // Mix the deterministic counts with the AI-enriched cluster
        // summaries — both into proposed_fixes so /admin/adaptation
        // shows the rich text immediately, and into the structured
        // metrics blob for downstream processing.
        const proposedFixes: Record<string, unknown>[] = enriched.cluster_summaries.map(
          (s) => ({
            kind: 'failure_cluster',
            theme: s.theme,
            user_impact: s.user_impact,
            sample_count: s.sample_count,
            description: s.proposed_fix,
            evidence_urns: s.evidence_urns,
          }),
        )

        if (clusters.negative_feedback_count > 0) {
          proposedFixes.push({
            kind: 'prompt_diff',
            description: `${clusters.negative_feedback_count} thumbs-down(s) in the last 7 days — the prompt_optimizer workflow will propose fixes on its weekly run.`,
            count: clusters.negative_feedback_count,
          })
        }

        const markdown = [
          `# Weekly improvement report`,
          ``,
          `Period: ${periodStart.slice(0, 10)} → ${periodEnd.slice(0, 10)}`,
          ``,
          `## Top failure clusters (${enriched.cluster_summaries.length} of ${enriched.candidates_count} total)`,
          ``,
          ...enriched.cluster_summaries.map(
            (s, i) =>
              `### ${i + 1}. ${s.theme} (impact: ${s.user_impact}, ${s.sample_count}×)\n\n${s.proposed_fix}\n\n_Evidence:_ ${s.evidence_urns.slice(0, 3).join(', ')}`,
          ),
          ``,
          `## Negative feedback`,
          ``,
          `${clusters.negative_feedback_count} thumbs-down interactions.`,
        ].join('\n')

        const { error } = await ctx.supabase.from('improvement_reports').insert({
          tenant_id: ctx.tenantId,
          kind: 'failure_cluster',
          period_start: periodStart,
          period_end: periodEnd,
          failure_cluster_count: failureClusterCount,
          report_markdown: markdown,
          proposed_fixes: proposedFixes,
          metrics: {
            cluster_summaries: enriched.cluster_summaries,
            negative_feedback_count: clusters.negative_feedback_count,
            tool_errors_by_tool: clusters.tool_errors_by_tool,
            zero_citation_by_intent: clusters.zero_citation_by_intent,
          },
        })
        if (error) throw new Error(`improvement_reports insert: ${error.message}`)

        return { failure_cluster_count: failureClusterCount, proposals: proposedFixes.length }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
