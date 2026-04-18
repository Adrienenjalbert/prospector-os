import type { SupabaseClient } from '@supabase/supabase-js'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Self-improve workflow — nightly auto-research meta-agent. Takes the last
 * 7 days of failures, clusters them by intent_class + tool_name, asks a
 * strong model to propose fixes, and writes an `improvement_reports` row
 * with proposed fixes. A human (or the CI bot) picks up from there.
 *
 * Kept intentionally small in v1: the clustering is by (intent_class, tool)
 * rather than embedding similarity. When Phase 7's exemplar miner has
 * enough signal we swap in embedding clustering.
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
      name: 'write_report',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const clusters = ctx.stepState.cluster as {
          tool_errors_by_tool: Record<string, number>
          zero_citation_by_intent: Record<string, number>
          negative_feedback_count: number
        }

        const failureClusterCount =
          Object.keys(clusters.tool_errors_by_tool).length +
          Object.keys(clusters.zero_citation_by_intent).length

        const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const periodEnd = new Date().toISOString()

        const proposedFixes: Record<string, unknown>[] = []

        for (const [tool, count] of Object.entries(clusters.tool_errors_by_tool)) {
          proposedFixes.push({
            kind: 'tool_tweak',
            description: `${tool} errored ${count}× this week. Inspect error payloads and add input validation or a fallback.`,
            affected_tool: tool,
            count,
          })
        }
        for (const [intent, count] of Object.entries(clusters.zero_citation_by_intent)) {
          proposedFixes.push({
            kind: 'prompt_diff',
            description: `Intent "${intent}" produced ${count} zero-citation responses. Add explicit "cite your source" instruction when this intent is detected.`,
            affected_intent: intent,
            count,
          })
        }
        if (clusters.negative_feedback_count > 0) {
          proposedFixes.push({
            kind: 'prompt_diff',
            description: `${clusters.negative_feedback_count} thumbs-down(s) in the last 7 days. Run the promptOptimizer to generate fix proposals.`,
            count: clusters.negative_feedback_count,
          })
        }

        const markdown = [
          `# Weekly improvement report`,
          ``,
          `Period: ${periodStart.slice(0, 10)} → ${periodEnd.slice(0, 10)}`,
          ``,
          `## Failure clusters (${failureClusterCount})`,
          ``,
          ...Object.entries(clusters.tool_errors_by_tool).map(([t, c]) => `- **Tool error:** ${t} · ${c}×`),
          ...Object.entries(clusters.zero_citation_by_intent).map(([i, c]) => `- **Zero citation:** intent \`${i}\` · ${c}×`),
          ``,
          `## Negative feedback`,
          ``,
          `${clusters.negative_feedback_count} thumbs-down interactions.`,
          ``,
          `## Proposed fixes`,
          ``,
          ...proposedFixes.map((f, i) => `${i + 1}. **${f.kind}** — ${f.description}`),
        ].join('\n')

        const { error } = await ctx.supabase.from('improvement_reports').insert({
          tenant_id: ctx.tenantId,
          period_start: periodStart,
          period_end: periodEnd,
          failure_cluster_count: failureClusterCount,
          report_markdown: markdown,
          proposed_fixes: proposedFixes,
        })
        if (error) throw new Error(`improvement_reports insert: ${error.message}`)

        return { failure_cluster_count: failureClusterCount, proposals: proposedFixes.length }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
