import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Context-slice calibration — nightly Beta-Bernoulli update for the
 * per-tenant `context_slice_priors` table that the selector reads.
 *
 * Pipeline:
 *
 *   1. Pull recent (intent_class, role, slug, urns_referenced) tuples from
 *      `agent_events` where event_type = 'context_slice_consumed'.
 *   2. Pull recent positive / negative `feedback_given` events keyed by
 *      interaction_id.
 *   3. Join: for each consumed slice, look up whether the response on
 *      that interaction got positive or negative feedback. Positive →
 *      alpha++ for that (intent, role, slug). Negative → beta++.
 *   4. Upsert into `context_slice_priors` — same shape pattern as
 *      `tool_priors`. The selector reads these on the next turn.
 *
 * Idempotency: keyed by `csc:{tenant}:{ISO date}` so daily reruns are
 * safe. Day-bucket overlap is handled by reading a small look-back window
 * (3 days) and the running upsert with NUMERIC `alpha` / `beta` increments
 * — converging Beta-Bernoulli estimates are tolerant of repeated counts.
 *
 * Why this matters:
 *   - Without calibration, slice selection is stuck at the heuristic.
 *     The bandit infrastructure exists (bandit.ts + the priors table)
 *     but stays dormant.
 *   - With calibration, every tenant's selector tunes itself per
 *     (intent, role, slice) using THAT tenant's positive feedback —
 *     the OS becomes measurably better per tenant per week.
 */

interface ConsumedRow {
  interaction_id: string | null
  payload: Record<string, unknown> | null
}

interface FeedbackRow {
  interaction_id: string
  payload: Record<string, unknown> | null
}

const LOOKBACK_DAYS = 3

export async function enqueueContextSliceCalibration(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'context_slice_calibration',
    idempotencyKey: `csc:${tenantId}:${day}`,
    input: { day, lookback_days: LOOKBACK_DAYS },
  })
}

export async function runContextSliceCalibration(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_consumed',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(
          Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()

        const { data, error } = await ctx.supabase
          .from('agent_events')
          .select('interaction_id, payload')
          .eq('tenant_id', ctx.tenantId)
          .eq('event_type', 'context_slice_consumed')
          .gte('occurred_at', since)
        if (error) throw new Error(`load_consumed: ${error.message}`)
        return { rows: (data ?? []) as ConsumedRow[] }
      },
    },
    {
      name: 'load_feedback',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(
          Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()

        const { data, error } = await ctx.supabase
          .from('agent_events')
          .select('interaction_id, payload')
          .eq('tenant_id', ctx.tenantId)
          .eq('event_type', 'feedback_given')
          .gte('occurred_at', since)
        if (error) throw new Error(`load_feedback: ${error.message}`)
        return { rows: (data ?? []) as FeedbackRow[] }
      },
    },
    {
      name: 'compute_updates',
      run: async (ctx) => {
        const consumed = (ctx.stepState.load_consumed as { rows: ConsumedRow[] }).rows
        const feedback = (ctx.stepState.load_feedback as { rows: FeedbackRow[] }).rows

        // interaction_id -> 'positive' | 'negative' (latest feedback wins)
        const verdict = new Map<string, 'positive' | 'negative'>()
        for (const f of feedback) {
          if (!f.interaction_id) continue
          const v = (f.payload as { feedback?: string } | null)?.feedback
          if (v === 'positive' || v === 'negative') verdict.set(f.interaction_id, v)
        }

        // Aggregate (intent_class, role, slug) -> { alpha_inc, beta_inc, n }
        type Agg = { alpha_inc: number; beta_inc: number; n: number }
        const agg = new Map<string, Agg & { intent_class: string; role: string; slug: string }>()

        for (const c of consumed) {
          if (!c.interaction_id) continue
          const v = verdict.get(c.interaction_id)
          if (!v) continue
          const slug = (c.payload as { slug?: string } | null)?.slug
          const intent = (c.payload as { intent_class?: string } | null)?.intent_class
          const role = (c.payload as { query_type?: string } | null)?.query_type
          if (!slug || !intent || !role) continue
          const key = `${intent}::${role}::${slug}`
          const cur = agg.get(key) ?? {
            alpha_inc: 0,
            beta_inc: 0,
            n: 0,
            intent_class: intent,
            role,
            slug,
          }
          if (v === 'positive') cur.alpha_inc += 1
          else cur.beta_inc += 1
          cur.n += 1
          agg.set(key, cur)
        }

        return { updates: Array.from(agg.values()) }
      },
    },
    {
      name: 'upsert_priors',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const updates = (ctx.stepState.compute_updates as {
          updates: {
            intent_class: string
            role: string
            slug: string
            alpha_inc: number
            beta_inc: number
            n: number
          }[]
        }).updates

        if (updates.length === 0) {
          return { updated: 0, skipped_reason: 'no_signal' }
        }

        let updated = 0
        for (const u of updates) {
          // Upsert pattern that mirrors the tool_priors update flow.
          // Fetch current alpha/beta, add increments, write back. Doing this
          // per-row rather than via a SQL UPDATE keeps the workflow runner
          // logic transactional-friendly and lets us tolerate row-not-found.
          const { data: existing } = await ctx.supabase
            .from('context_slice_priors')
            .select('alpha, beta, sample_count')
            .eq('tenant_id', ctx.tenantId)
            .eq('intent_class', u.intent_class)
            .eq('role', u.role)
            .eq('slice_slug', u.slug)
            .maybeSingle()

          const newAlpha = (Number(existing?.alpha ?? 1)) + u.alpha_inc
          const newBeta = (Number(existing?.beta ?? 1)) + u.beta_inc
          const newSamples = (existing?.sample_count ?? 0) + u.n

          const { error } = await ctx.supabase
            .from('context_slice_priors')
            .upsert(
              {
                tenant_id: ctx.tenantId,
                intent_class: u.intent_class,
                role: u.role,
                slice_slug: u.slug,
                alpha: newAlpha,
                beta: newBeta,
                sample_count: newSamples,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'tenant_id,intent_class,role,slice_slug' },
            )
          if (!error) updated += 1
          else console.warn('[csc] upsert failed:', error.message)
        }

        return { updated, total_signals: updates.length }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
