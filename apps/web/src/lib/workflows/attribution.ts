import type { SupabaseClient } from '@supabase/supabase-js'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Attribution engine — nightly per-tenant workflow.
 *
 * For every outcome_event in the last 24h, look back 14 days for agent_events
 * on the same subject_urn by the same user. Apply attribution rules and
 * insert rows into `attributions`.
 *
 * Three default rules (override per tenant via attribution_config):
 *   - direct     : action_invoked → outcome within 1h   → conf 0.95
 *   - assisted   : response_finished → outcome within 24h → conf 0.70
 *   - influenced : any agent event on subject → outcome within 14d → conf 0.40
 *
 * Holdout handling: if the user is in the `holdout_assignments` control
 * cohort, we still record attributions (they needed for counterfactual
 * reporting) but flag them so the ROI dashboard can separate treatment vs
 * control cleanly.
 */

interface AttributionRule {
  confidence: number
  max_lag_seconds: number
}

interface AttributionConfig {
  direct: AttributionRule
  assisted: AttributionRule
  influenced: AttributionRule
}

const DEFAULT_RULES: AttributionConfig = {
  direct: { confidence: 0.95, max_lag_seconds: 3600 },
  assisted: { confidence: 0.7, max_lag_seconds: 86400 },
  influenced: { confidence: 0.4, max_lag_seconds: 1209600 },
}

export async function enqueueAttribution(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'attribution',
    idempotencyKey: `attr:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runAttribution(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_rules',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { data } = await ctx.supabase
          .from('attribution_config')
          .select('rules')
          .eq('tenant_id', ctx.tenantId)
          .maybeSingle()

        const rules = ((data?.rules as AttributionConfig | null) ?? DEFAULT_RULES)
        return { rules }
      },
    },
    {
      name: 'match_outcomes',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { rules } = ctx.stepState.load_rules as { rules: AttributionConfig }

        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

        const { data: outcomes } = await ctx.supabase
          .from('outcome_events')
          .select('id, subject_urn, user_id, event_type, occurred_at, value_amount')
          .eq('tenant_id', ctx.tenantId)
          .gte('occurred_at', yesterday)

        if (!outcomes || outcomes.length === 0) {
          return { matched: 0 }
        }

        const windowStart = new Date(
          Date.now() - rules.influenced.max_lag_seconds * 1000 - 24 * 60 * 60 * 1000,
        ).toISOString()

        const subjectUrns = [...new Set(outcomes.map((o) => o.subject_urn))]
        const { data: agentEvents } = await ctx.supabase
          .from('agent_events')
          .select('id, subject_urn, user_id, event_type, occurred_at')
          .eq('tenant_id', ctx.tenantId)
          .in('subject_urn', subjectUrns.length > 0 ? subjectUrns : ['none'])
          .gte('occurred_at', windowStart)

        const byUrn = new Map<string, Array<{ id: string; user_id: string | null; event_type: string; occurred_at: string }>>()
        for (const e of agentEvents ?? []) {
          if (!e.subject_urn) continue
          const list = byUrn.get(e.subject_urn) ?? []
          list.push({
            id: e.id,
            user_id: e.user_id,
            event_type: e.event_type,
            occurred_at: e.occurred_at,
          })
          byUrn.set(e.subject_urn, list)
        }

        // Pre-load holdout cohort assignments for every user that
        // appears in either side of the join. One round-trip rather
        // than a per-outcome lookup. Result is a Set of user_ids in
        // the control cohort — anyone missing is treatment by default.
        //
        // This is the WRITE-TIME enforcement of the holdout rule the
        // /admin/roi page used to *claim* but never actually executed
        // (see strategic review §6.2). Treatment-vs-control lift is
        // now defensible — the control rows are still inserted (so we
        // can compute the counterfactual) but flagged so the ROI sum
        // can exclude them cleanly.
        const userIds = Array.from(
          new Set([
            ...outcomes.map((o) => o.user_id).filter((id): id is string => !!id),
            ...(agentEvents ?? [])
              .map((e) => e.user_id)
              .filter((id): id is string => !!id),
          ]),
        )

        const controlUsers = new Set<string>()
        if (userIds.length > 0) {
          const { data: assignments } = await ctx.supabase
            .from('holdout_assignments')
            .select('user_id, cohort')
            .eq('tenant_id', ctx.tenantId)
            .in('user_id', userIds)
          for (const a of assignments ?? []) {
            if (a.cohort === 'control' && a.user_id) {
              controlUsers.add(a.user_id as string)
            }
          }
        }

        let inserted = 0
        let controlFlagged = 0
        for (const outcome of outcomes) {
          const candidates = (byUrn.get(outcome.subject_urn) ?? []).filter(
            (e) => e.user_id && e.user_id === outcome.user_id,
          )
          const outcomeTime = new Date(outcome.occurred_at).getTime()

          const best = chooseBestAttribution(candidates, outcomeTime, rules)
          if (!best) continue

          // The cohort is bound to the user, so either the outcome's
          // user_id or the chosen agent event's user_id resolves it
          // (they're equal by construction — see filter above).
          const isControl = !!outcome.user_id && controlUsers.has(outcome.user_id)
          if (isControl) controlFlagged += 1

          const { error } = await ctx.supabase.from('attributions').insert({
            tenant_id: ctx.tenantId,
            agent_event_id: best.agent_event_id,
            outcome_event_id: outcome.id,
            attribution_rule: best.rule,
            confidence: best.confidence,
            lag_seconds: best.lag_seconds,
            is_control_cohort: isControl,
          })
          if (!error) inserted += 1
        }

        return { matched: inserted, control_flagged: controlFlagged }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

function chooseBestAttribution(
  candidates: Array<{ id: string; event_type: string; occurred_at: string }>,
  outcomeTime: number,
  rules: AttributionConfig,
): { agent_event_id: string; rule: string; confidence: number; lag_seconds: number } | null {
  let best:
    | { agent_event_id: string; rule: string; confidence: number; lag_seconds: number }
    | null = null

  for (const c of candidates) {
    const t = new Date(c.occurred_at).getTime()
    const lagSeconds = Math.floor((outcomeTime - t) / 1000)
    if (lagSeconds < 0) continue // agent event after outcome — skip

    let rule: 'direct' | 'assisted' | 'influenced' | null = null

    if (c.event_type === 'action_invoked' && lagSeconds <= rules.direct.max_lag_seconds) {
      rule = 'direct'
    } else if (
      c.event_type === 'response_finished' &&
      lagSeconds <= rules.assisted.max_lag_seconds
    ) {
      rule = 'assisted'
    } else if (lagSeconds <= rules.influenced.max_lag_seconds) {
      rule = 'influenced'
    }

    if (!rule) continue
    const confidence = rules[rule].confidence

    // Pick the strongest (highest confidence, or lower lag on ties).
    if (
      !best ||
      confidence > best.confidence ||
      (confidence === best.confidence && lagSeconds < best.lag_seconds)
    ) {
      best = {
        agent_event_id: c.id,
        rule,
        confidence,
        lag_seconds: lagSeconds,
      }
    }
  }

  return best
}
