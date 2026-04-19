import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Every event that can happen in the agent loop or in the system's
 * interaction with the outside world. These feed the learning loop:
 * eval growth, prompt optimizer, tool bandit, citation ranker, attribution.
 *
 * Discipline: every string written to the `agent_events.event_type` column
 * MUST appear in this union. The DB column is VARCHAR so drift goes silent;
 * this union is the contract. If you add a new emitter, add the type here.
 */
export type AgentEventType =
  | 'interaction_started'
  | 'step_finished'
  | 'tool_called'
  | 'tool_result'
  | 'tool_error'
  | 'citation_clicked'
  | 'citation_missing' // Phase 4: tool returned { data, citations } with empty citations
  | 'response_finished'
  | 'feedback_given'
  | 'action_invoked'
  | 'clarification_requested'
  | 'clarification_provided'
  | 'escalation_needs_review' // Phase 5: loopUntil maxed out, queue for human review
  | 'proactive_push_sent'     // emitted by adapters/notifications/push-budget
  // Context Pack (Phase 1): per-slice telemetry feeds the bandit + attribution.
  // `context_slice_loaded` fires per slice the packer hydrates per turn,
  // carrying { slug, intent_class, role, rows, tokens, duration_ms, source,
  // cache_hit, fetched_at }. `context_slice_failed` fires when a loader
  // times out or throws — surfaced into the data-coverage warnings slice
  // and into the nightly self_improve workflow's failure clusters.
  | 'context_slice_loaded'
  | 'context_slice_failed'
  // Context Pack (Phase 3): emitted post-response when the assistant text
  // references a URN that came from a specific slice's citations. Without
  // this event the bandit can only learn "which slices were loaded", not
  // "which slices were actually useful". Carries { slug, urns_referenced,
  // intent_class, role } and fires once per slice the response touched.
  | 'context_slice_consumed'
  // Emitted by `apps/web/src/lib/agent/tool-loader.ts` when one or more
  // `tool_registry` rows have no matching TS handler in HANDLERS. The
  // payload carries `{ missing_handlers: string[], role }`. Surfacing
  // this as an event (not just a console warn) lets `/admin/adaptation`
  // and the self-improve workflow detect partial-degradation drift —
  // the failure mode where an agent silently runs with a subset of its
  // configured toolset.
  | 'tool_registry_drift'
  // Onboarding lifecycle events. Emitted by the wizard's server actions
  // in `apps/web/src/app/actions/onboarding.ts` and the baseline
  // survey at `apps/web/src/app/actions/baseline-survey.ts`. Without
  // these, operators have no way to measure completion rate per step,
  // time-to-first-cited-answer, or where users drop off the funnel.
  // Payload conventions:
  //   onboarding_step_completed: { step: 'welcome' | 'crm' | 'sync' | ... }
  //   crm_connected: { crm_type: 'hubspot' | 'salesforce', webhook_subscribed: boolean }
  //   onboarding_proposals_loaded: { icp_source: 'derived'|'default', funnel_source, won_deals }
  //   onboarding_config_applied: { kind: 'icp' | 'funnel' }
  //   onboarding_completed: { duration_ms?, completed_steps[] }
  //   baseline_submitted: { task_count }
  | 'onboarding_step_completed'
  | 'crm_connected'
  | 'onboarding_proposals_loaded'
  | 'onboarding_config_applied'
  | 'onboarding_completed'
  | 'baseline_submitted'
  // Scoring lifecycle. Emitted per tenant by the nightly cron at
  // `apps/web/src/app/api/cron/score/route.ts` so /admin/adaptation
  // and the self-improve workflow can detect tenants whose scoring
  // has been silently failing. Payload:
  // { companies_scored, benchmarks_written, duration_ms, status, error? }
  | 'scoring_run_completed'
  // Phase 3 T1.2 — prompt-injection defence at ingest. Emitted by the
  // transcript ingester when the Anthropic summary output fails to
  // parse against `SummarizeResultSchema`. The ingester then persists
  // `summary = null` rather than the raw model output, so the
  // ontology never carries a malformed-shape summary downstream into
  // search_transcripts / conversation memory / brief generation. The
  // event payload carries `{ source, source_id, zod_issues, raw_length }`
  // so /admin/adaptation can show "the model got coerced N times this
  // week on tenant X" — a hard signal for either prompt drift or
  // adversarial input.
  | 'summarise_invalid_output'
  | 'error'

/**
 * Outcome events observed from the CRM / calendar / email side.
 * Sourced from webhooks and nightly delta syncs. These are the "labels"
 * for attribution and per-tenant scoring calibration.
 *
 * `workflow_fatal` is emitted by the workflow runner when a step fails
 * unrecoverably; it lives on outcome_events so the attribution job can
 * correlate ops failures with deal slippage.
 */
export type OutcomeEventType =
  | 'deal_stage_changed'
  | 'deal_amount_changed'
  | 'meeting_booked'
  | 'meeting_held'
  | 'note_created'
  | 'deal_closed_won'
  | 'deal_closed_lost'
  | 'contract_renewed'
  | 'churned'
  | 'email_sent'
  | 'email_replied'
  | 'workflow_fatal'

export interface AgentEventInput {
  tenant_id: string
  interaction_id?: string | null
  user_id?: string | null
  role?: string | null
  event_type: AgentEventType
  subject_urn?: string | null
  payload?: Record<string, unknown>
}

export interface OutcomeEventInput {
  tenant_id: string
  subject_urn: string
  event_type: OutcomeEventType
  source?: string
  user_id?: string | null
  payload?: Record<string, unknown>
  value_amount?: number
}

/**
 * Fire-and-forget event emitter. Swallows errors so a telemetry blip never
 * breaks an agent response. In tests / dev, failures get logged.
 */
export async function emitAgentEvent(
  supabase: SupabaseClient,
  event: AgentEventInput
): Promise<void> {
  try {
    const { error } = await supabase.from('agent_events').insert({
      tenant_id: event.tenant_id,
      interaction_id: event.interaction_id ?? null,
      user_id: event.user_id ?? null,
      role: event.role ?? null,
      event_type: event.event_type,
      subject_urn: event.subject_urn ?? null,
      payload: event.payload ?? {},
    })
    if (error) {
      console.warn('[telemetry] agent_events insert failed:', error.message)
    }
  } catch (err) {
    console.warn('[telemetry] agent_events emit threw:', err)
  }
}

export async function emitOutcomeEvent(
  supabase: SupabaseClient,
  event: OutcomeEventInput
): Promise<void> {
  try {
    const { error } = await supabase.from('outcome_events').insert({
      tenant_id: event.tenant_id,
      subject_urn: event.subject_urn,
      event_type: event.event_type,
      source: event.source ?? null,
      user_id: event.user_id ?? null,
      payload: event.payload ?? {},
      value_amount: event.value_amount ?? null,
    })
    if (error) {
      console.warn('[telemetry] outcome_events insert failed:', error.message)
    }
  } catch (err) {
    console.warn('[telemetry] outcome_events emit threw:', err)
  }
}

/**
 * Batch emitter for hot paths (agent loop emits several events per step).
 * Still swallows errors — telemetry is not load-bearing for correctness.
 */
export async function emitAgentEvents(
  supabase: SupabaseClient,
  events: AgentEventInput[]
): Promise<void> {
  if (events.length === 0) return
  try {
    const rows = events.map((e) => ({
      tenant_id: e.tenant_id,
      interaction_id: e.interaction_id ?? null,
      user_id: e.user_id ?? null,
      role: e.role ?? null,
      event_type: e.event_type,
      subject_urn: e.subject_urn ?? null,
      payload: e.payload ?? {},
    }))
    const { error } = await supabase.from('agent_events').insert(rows)
    if (error) {
      console.warn('[telemetry] batch agent_events insert failed:', error.message)
    }
  } catch (err) {
    console.warn('[telemetry] batch agent_events emit threw:', err)
  }
}
