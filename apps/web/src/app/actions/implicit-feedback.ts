'use server'

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

async function resolveRepContext() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, rep_profile_id')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) throw new Error('No profile')

  const { data: rep } = await supabase
    .from('rep_profiles')
    .select('crm_id')
    .eq('id', profile.rep_profile_id)
    .single()

  return {
    tenant_id: profile.tenant_id,
    rep_crm_id: rep?.crm_id ?? user.id,
  }
}

export type ImplicitSignalType =
  | 'card_expanded'
  | 'card_drafted'
  | 'card_skipped'
  | 'agent_copy'
  | 'agent_deep_dive'
  | 'mailto_click'
  | 'account_viewed'

/**
 * Telemetry must NEVER throw into the UX path — these helpers are called
 * from buttons, page mounts, and chat events where a thrown error would
 * break the rep's flow. We catch and log; we never re-throw. But we also
 * stopped doing the empty-catch pattern: silent telemetry failures used to
 * mask real bugs (broken Supabase queries, schema drift). The console.warn
 * keeps the rep happy while still leaving a breadcrumb in server logs and
 * in the Vercel function trace for ops to grep.
 */
function logTelemetryError(scope: string, err: unknown): void {
  console.warn(
    `[implicit-feedback:${scope}] swallowed:`,
    err instanceof Error ? err.message : err,
  )
}

export async function trackImplicitSignal(
  signalType: ImplicitSignalType,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>
) {
  try {
    const ctx = await resolveRepContext()
    const supabase = getServiceSupabase()

    await supabase.from('implicit_signals').insert({
      tenant_id: ctx.tenant_id,
      rep_crm_id: ctx.rep_crm_id,
      signal_type: signalType,
      entity_type: entityType,
      entity_id: entityId,
      metadata: metadata ?? {},
    })
  } catch (err) {
    logTelemetryError('trackImplicitSignal', err)
  }
}

export async function recordAgentFeedback(
  interactionId: string,
  feedback: 'positive' | 'negative',
  reason?: string
) {
  try {
    const ctx = await resolveRepContext()
    const supabase = getServiceSupabase()

    const update: Record<string, unknown> = { feedback }
    if (reason) {
      update.downstream_outcome = reason
    }

    await supabase
      .from('agent_interaction_outcomes')
      .update(update)
      .eq('id', interactionId)
      .eq('tenant_id', ctx.tenant_id)

    // Emit to the event log so the learning loop (eval autogrowth,
    // prompt optimizer, tool bandit) sees the signal.
    await supabase.from('agent_events').insert({
      tenant_id: ctx.tenant_id,
      interaction_id: interactionId,
      role: 'rep',
      event_type: 'feedback_given',
      payload: { value: feedback, reason: reason ?? null },
    })

    // Propagate to tool priors: every tool called during this interaction
    // gets credited with the outcome. The tool bandit uses these posteriors
    // when ranking tools for future similar intents.
    const { data: started } = await supabase
      .from('agent_events')
      .select('payload')
      .eq('interaction_id', interactionId)
      .eq('event_type', 'interaction_started')
      .limit(1)
      .maybeSingle()

    const intentClass =
      (started?.payload as { intent_class?: string } | null)?.intent_class ?? 'general_query'

    const { data: toolCalls } = await supabase
      .from('agent_events')
      .select('payload')
      .eq('interaction_id', interactionId)
      .eq('event_type', 'tool_called')

    // The tool middleware (lib/agent/tools/middleware.ts) is the canonical
    // emitter for tool_called and uses `payload.slug`. Older event rows
    // written by the route used `payload.tool_name`; we accept both so the
    // bandit keeps learning across the migration window.
    const seen = new Set<string>()
    for (const tc of toolCalls ?? []) {
      const payload = (tc.payload as { slug?: string; tool_name?: string } | null)
      const name = payload?.slug ?? payload?.tool_name
      if (!name || seen.has(name)) continue
      seen.add(name)

      const { updateToolPrior } = await import('@/lib/agent/tool-bandit')
      await updateToolPrior(
        supabase,
        ctx.tenant_id,
        intentClass,
        name,
        feedback === 'positive',
      )
    }
  } catch (err) {
    logTelemetryError('recordAgentFeedback', err)
  }
}

/**
 * Records pill-render impressions for a batch of citations (C5.3).
 *
 * Until now, `retrieval_priors.impressions` only ever incremented on
 * the FIRST click for a never-seen source — meaning CTR was always
 * 100% (every impression also a click). That made the
 * retrieval_priors signal useless for ranking. With this batched
 * impression logger:
 *   - One INSERT/UPSERT round-trip per pill render (deduplicated by
 *     source key).
 *   - CTR becomes a real number (clicks / impressions).
 *   - The retrieval-CTR booster in the packer (C5.3) finally has
 *     meaningful input.
 *
 * Telemetry-only: failures swallow so a bad row doesn't break pill
 * rendering.
 */
export async function recordCitationImpressions(
  citations: Array<{ source_type: string; source_id: string | null }>,
) {
  if (citations.length === 0) return
  try {
    const ctx = await resolveRepContext()
    const supabase = getServiceSupabase()

    // Dedup within the batch — pills are de-duplicated client-side
    // already, but we re-dedup here in case two render passes fire
    // before the first DB write completes.
    const seen = new Set<string>()
    const unique = citations.filter((c) => {
      const k = `${c.source_type}:${c.source_id ?? ''}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })

    // For each unique citation, increment impressions. Upsert with
    // an ON CONFLICT DO UPDATE pattern via a plain SQL would be
    // ideal; PostgREST doesn't expose increment directly, so we
    // read-add-write per row. Volume is bounded (~5 pills per
    // message) so this is acceptable.
    for (const c of unique) {
      const { data: existing } = await supabase
        .from('retrieval_priors')
        .select('id, impressions')
        .eq('tenant_id', ctx.tenant_id)
        .eq('source_type', c.source_type)
        .eq('source_id', c.source_id ?? '')
        .maybeSingle()

      if (existing) {
        await supabase
          .from('retrieval_priors')
          .update({
            impressions: (existing.impressions ?? 0) + 1,
            last_updated: new Date().toISOString(),
          })
          .eq('id', existing.id)
      } else {
        await supabase.from('retrieval_priors').insert({
          tenant_id: ctx.tenant_id,
          source_type: c.source_type,
          source_id: c.source_id,
          impressions: 1,
          clicks: 0,
        })
      }
    }
  } catch (err) {
    logTelemetryError('recordCitationImpressions', err)
  }
}

/**
 * Records that a user clicked a citation pill. Feeds the per-tenant
 * retrieval-usefulness ranker (Phase 7e / C5.3): sources that get
 * clicked get surfaced more, sources that get ignored get deprioritised.
 */
export async function recordCitationClick(
  interactionId: string,
  sourceType: string,
  sourceId: string | null,
  sourceUrl: string | null
) {
  try {
    const ctx = await resolveRepContext()
    const supabase = getServiceSupabase()

    await supabase.from('agent_events').insert({
      tenant_id: ctx.tenant_id,
      interaction_id: interactionId,
      role: 'rep',
      event_type: 'citation_clicked',
      payload: {
        source_type: sourceType,
        source_id: sourceId,
        source_url: sourceUrl,
      },
    })

    // Upsert impression/click counts for the ranker bandit.
    const { data: existing } = await supabase
      .from('retrieval_priors')
      .select('id, impressions, clicks')
      .eq('tenant_id', ctx.tenant_id)
      .eq('source_type', sourceType)
      .eq('source_id', sourceId ?? '')
      .maybeSingle()

    if (existing) {
      await supabase
        .from('retrieval_priors')
        .update({
          clicks: (existing.clicks ?? 0) + 1,
          last_updated: new Date().toISOString(),
        })
        .eq('id', existing.id)
    } else {
      // First-ever click on a source we never logged an impression
      // for — pre-C5.3 this would set impressions=1, making CTR=100%
      // for every brand-new source. Now we set impressions=0 so the
      // separate `recordCitationImpressions` writer is the canonical
      // impression source. CTR converges to a real number as
      // impressions accumulate.
      await supabase.from('retrieval_priors').insert({
        tenant_id: ctx.tenant_id,
        source_type: sourceType,
        source_id: sourceId,
        impressions: 0,
        clicks: 1,
      })
    }
  } catch (err) {
    logTelemetryError('recordCitationClick', err)
  }
}

/**
 * Records that an action button was clicked from the Action Panel.
 * This is the strongest positive signal: the user not only read the
 * response, they acted on it. Attribution keys heavily off this event.
 */
export async function recordActionInvoked(
  interactionId: string | null,
  actionId: string,
  subjectUrn: string | null
) {
  try {
    const ctx = await resolveRepContext()
    const supabase = getServiceSupabase()

    await supabase.from('agent_events').insert({
      tenant_id: ctx.tenant_id,
      interaction_id: interactionId,
      role: 'rep',
      event_type: 'action_invoked',
      subject_urn: subjectUrn,
      payload: { action_id: actionId },
    })
  } catch (err) {
    logTelemetryError('recordActionInvoked', err)
  }
}

export async function recordOutcomeAction(
  accountId: string,
  outcomeAction: string
) {
  try {
    const ctx = await resolveRepContext()
    const supabase = getServiceSupabase()

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    await supabase
      .from('alert_feedback')
      .update({ outcome_action: outcomeAction })
      .eq('tenant_id', ctx.tenant_id)
      .eq('rep_crm_id', ctx.rep_crm_id)
      .eq('company_id', accountId)
      .eq('action_taken', true)
      .gte('created_at', todayStart.toISOString())
  } catch (err) {
    logTelemetryError('recordOutcomeAction', err)
  }
}

export async function submitWeeklyPulse(
  topAccountId: string | null,
  accountOutcome: string,
  priorityAccuracy: string
) {
  const ctx = await resolveRepContext()
  const supabase = getServiceSupabase()

  const today = new Date()
  const dayOfWeek = today.getDay()
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - ((dayOfWeek + 6) % 7))
  const weekStartStr = weekStart.toISOString().split('T')[0]

  await supabase.from('weekly_pulse_responses').upsert({
    tenant_id: ctx.tenant_id,
    rep_crm_id: ctx.rep_crm_id,
    week_start: weekStartStr,
    top_account_id: topAccountId,
    account_outcome: accountOutcome,
    priority_accuracy: priorityAccuracy,
  }, { onConflict: 'tenant_id,rep_crm_id,week_start' })
}
