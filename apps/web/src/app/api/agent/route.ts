import { streamText, convertToCoreMessages, type CoreMessage } from 'ai'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  assembleContextForStrategy,
  assembleContextPack,
  pickContextStrategy,
} from '@/lib/agent/context-strategies'
import { consumedSlicesFromResponse, type IntentClass } from '@/lib/agent/context'
import {
  AGENT_TYPES,
  buildSystemPromptForAgent,
  buildSystemPromptParts,
  dispatchAgent,
  loadToolsForDispatch,
  type AgentRole,
} from '@/lib/agent/tools'
import {
  CitationCollector,
  emitAgentEvent,
  emitAgentEvents,
  urn,
  type AgentEventInput,
} from '@prospector/core'
import { recordCitationsFromToolResult } from '@/lib/agent/citations'
import { chooseModel, getModel } from '@/lib/agent/model-registry'

const ROLLING_MESSAGE_LIMIT = 20
const USAGE_MONTH_KEY = 'prospector_ai_usage_month'

function currentUsageMonthKey(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function truncate(s: string, max = 500): string {
  if (!s) return ''
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/**
 * Lightweight intent classifier. Feeds the tool-selection bandit
 * (Phase 7) and the Context Pack selector. Kept tiny and rule-based for
 * now; a proper classifier can replace this without changing the schema.
 *
 * The return type is `IntentClass` so the Context Pack selector type-checks
 * at compile time — adding a new intent here forces the slice triggers to
 * acknowledge it.
 */
function classifyIntent(lastUserText: string): IntentClass {
  const t = lastUserText.toLowerCase()
  if (!t.trim()) return 'unknown'
  if (/(draft|write|compose|send).*(email|message|outreach)/.test(t)) return 'draft_outreach'
  if (/(stall|stuck|risk|at risk|slowing)/.test(t)) return 'risk_analysis'
  if (/(brief|prep|pre-call|meeting)/.test(t)) return 'meeting_prep'
  if (/(why|cause|reason|diagnose)/.test(t)) return 'diagnosis'
  if (/(forecast|pipeline|attainment|quota)/.test(t)) return 'forecast'
  if (/(signal|intent|buying)/.test(t)) return 'signal_triage'
  if (/(stakeholder|champion|decision|map)/.test(t)) return 'stakeholder_mapping'
  if (/(theme|churn|portfolio|health)/.test(t)) return 'portfolio_health'
  if (/(what|who|show|list|find)/.test(t)) return 'lookup'
  return 'general_query'
}

const requestSchema = z.object({
  messages: z.array(
    z.object({ role: z.string(), content: z.string() })
  ),
  agent_type: z.enum(AGENT_TYPES, {
    errorMap: () => ({
      message: `agent_type is required and must be one of: ${AGENT_TYPES.join(', ')}`,
    }),
  }),
  context: z.object({
    pageContext: z
      .object({
        page: z.string(),
        accountId: z.string().optional(),
        dealId: z.string().optional(),
        activeUrn: z.string().optional(),
      })
      .optional(),
  }),
})

export async function POST(req: Request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const token = authHeader.slice(7)
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id, rep_profile_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return new Response(JSON.stringify({ error: 'User profile not found' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { data: repProfile } = await supabase
      .from('rep_profiles')
      .select('crm_id')
      .eq('id', profile.rep_profile_id)
      .single()

    const body = await req.json()
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: parsed.error.issues }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const tenantId = profile.tenant_id
    const repId = repProfile?.crm_id ?? user.id
    const userRole = profile.role ?? 'rep'
    const { messages, agent_type: agentType, context } = parsed.data
    const lastUserMessage =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    const intentClass = classifyIntent(lastUserMessage)
    const subjectUrn = context.pageContext?.activeUrn ?? null

    const { data: tenantRow, error: tenantError } = await supabase
      .from('tenants')
      .select('ai_token_budget_monthly, ai_tokens_used_current, business_config, crm_type')
      .eq('id', tenantId)
      .single()

    if (tenantError || !tenantRow) {
      return new Response(JSON.stringify({ error: 'Tenant not found' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const monthKey = currentUsageMonthKey()
    const cfg = (tenantRow.business_config as Record<string, unknown> | null) ?? {}
    const storedMonth =
      typeof cfg[USAGE_MONTH_KEY] === 'string' ? (cfg[USAGE_MONTH_KEY] as string) : null

    let tokensUsed = tenantRow.ai_tokens_used_current ?? 0

    if (storedMonth !== monthKey) {
      const { error: resetErr } = await supabase
        .from('tenants')
        .update({
          ai_tokens_used_current: 0,
          business_config: { ...cfg, [USAGE_MONTH_KEY]: monthKey },
        })
        .eq('id', tenantId)

      if (!resetErr) tokensUsed = 0
    }

    const budget = tenantRow.ai_token_budget_monthly ?? 1_000_000

    if (tokensUsed >= budget) {
      return new Response(
        JSON.stringify({ error: 'AI budget exceeded for this month. Contact your admin.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const modelId = chooseModel({
      tokensUsedThisMonth: tokensUsed,
      monthlyBudget: budget,
    })

    const interactionId = crypto.randomUUID()
    const citations = new CitationCollector(tenantId, interactionId)
    const citationCtx = { collector: citations, crmType: tenantRow.crm_type ?? null }

    // Emit interaction_started so the event log has one authoritative start marker.
    // This is the anchor every later event in the learning loop keys off.
    await emitAgentEvent(supabase, {
      tenant_id: tenantId,
      interaction_id: interactionId,
      user_id: user.id,
      role: userRole,
      event_type: 'interaction_started',
      subject_urn: subjectUrn,
      payload: {
        agent_type: agentType,
        intent_class: intentClass,
        model: modelId,
        message_count: messages.length,
        last_user_message: truncate(lastUserMessage, 300),
        page: context.pageContext?.page ?? null,
      },
    })

    const dispatch = dispatchAgent({
      role: userRole,
      activeUrn: subjectUrn,
      explicitAgentType: agentType,
    })

    // Resolve the active conversation row up-front so per-conversation
    // tools (record_conversation_note) and the conversation-memory slice
    // can scope their queries correctly. The route's onFinish handler
    // creates/updates this row at the END of each turn, so on turn 2+
    // we hit an existing row; turn 1 returns null (handler no-ops
    // gracefully — the observation will be capturable next turn).
    const threadType = agentType === 'onboarding-coach' ? 'onboarding' : 'general'
    const { data: existingConversation } = await supabase
      .from('ai_conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .eq('thread_type', threadType)
      .is('thread_entity_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const activeConversationId = existingConversation?.id ?? null

    const tools = await loadToolsForDispatch({
      supabase,
      tenantId,
      repId,
      userId: user.id,
      role: dispatch.role as AgentRole,
      agentType: dispatch.agentType,
      activeUrn: dispatch.activeUrn,
      interactionId,
      intentClass,
      conversationId: activeConversationId,
    })

    const contextSelection = pickContextStrategy({
      role: userRole,
      activeUrn: subjectUrn,
    })

    // Run the legacy assembler and the new Context Pack packer in parallel.
    // Phase 1 keeps both — the legacy AgentContext stays the source of
    // truth for prompt builders, the PackedContext layers in URN-cited
    // slice citations into the citation collector and emits per-slice
    // telemetry the bandit + attribution workflows rely on.
    const [agentContext, packed] = await Promise.all([
      dispatch.agentType === 'onboarding-coach'
        ? Promise.resolve(null)
        : assembleContextForStrategy({
            supabase,
            tenantId,
            repId,
            selection: contextSelection,
            pageContext: context.pageContext,
          }),
      dispatch.agentType === 'onboarding-coach'
        ? Promise.resolve(null)
        : assembleContextPack({
            supabase,
            tenantId,
            repId,
            userId: user.id,
            role: dispatch.role,
            selection: contextSelection,
            intentClass: intentClass,
            pageContext: context.pageContext,
            interactionId,
            crmType: tenantRow.crm_type ?? null,
          }).catch((err) => {
            // Context Pack failures must NEVER break a turn — log and
            // proceed with the legacy AgentContext only.
            console.warn('[agent] context-pack failed:', err)
            return null
          }),
    ])

    // Forward slice citations into the collector so the same UI pills
    // surface them. Cite-or-shut-up holds for context evidence too.
    if (packed) {
      for (const c of packed.citations) {
        citations.addCitation(c)
      }
    }

    // Build the system prompt as parts so the static prefix can be marked
    // for Anthropic prompt caching. Cache window is 5 minutes (Anthropic
    // ephemeral TTL) — matches typical chat-session length, so turn 2
    // onwards reuses the cached static portion (~50% input-token
    // reduction on the cached tokens, ~90% latency reduction).
    const promptParts = await buildSystemPromptParts(
      dispatch.agentType,
      tenantId,
      agentContext,
      packed,
    )

    // Anthropic supports multiple system messages and per-message
    // providerOptions. We send two: one cacheable (static), one not
    // (dynamic). When there is no dynamic content (onboarding-coach), fall
    // back to the plain `system: string` form so we don't pay for an
    // unnecessary message-array construction.
    const baseUserMessages = convertToCoreMessages(
      messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    )

    const useCaching = promptParts.dynamicSuffix.length > 0
    const messagesForStream: CoreMessage[] = useCaching
      ? [
          {
            role: 'system' as const,
            content: promptParts.staticPrefix,
            providerOptions: {
              anthropic: { cacheControl: { type: 'ephemeral' } },
            },
          },
          {
            role: 'system' as const,
            content: promptParts.dynamicSuffix,
          },
          ...baseUserMessages,
        ]
      : baseUserMessages

    const toolCallsMade: string[] = []

    const result = streamText({
      model: getModel(modelId),
      ...(useCaching ? {} : { system: promptParts.staticPrefix }),
      messages: messagesForStream,
      tools,
      maxSteps: 8,
      temperature: 0.3,
      maxTokens: 3000,
      onStepFinish: (step) => {
        const s = step as unknown as {
          toolCalls?: Array<{ toolName: string; args?: unknown }>
          toolResults?: Array<{ toolName: string; result: unknown }>
          usage?: { totalTokens?: number }
          text?: string
        }

        const stepEvents: AgentEventInput[] = []

        // NOTE: `tool_called` is intentionally NOT emitted here. The
        // middleware (lib/agent/tools/middleware.ts `telemetryEmitter`)
        // owns that event with a richer payload (slug, duration_ms,
        // citation_count, has_error). Emitting from both places would
        // double-count for the bandit and ROI workflows. Here we still
        // record toolCallsMade for the local budget guard plus emit
        // tool_result / tool_error / step_finished — events the middleware
        // does NOT emit. (B2 dedupe, see plan.)
        if (s.toolCalls?.length) {
          for (const tc of s.toolCalls) {
            toolCallsMade.push(tc.toolName)
          }
        }

        if (s.toolResults?.length) {
          for (const tr of s.toolResults) {
            recordCitationsFromToolResult(citationCtx, tr.toolName, tr.result)
            const resultRecord =
              tr.result && typeof tr.result === 'object'
                ? (tr.result as Record<string, unknown>)
                : null
            const hasError =
              !!resultRecord && typeof resultRecord['error'] === 'string'

            stepEvents.push({
              tenant_id: tenantId,
              interaction_id: interactionId,
              user_id: user.id,
              role: userRole,
              event_type: hasError ? 'tool_error' : 'tool_result',
              subject_urn: subjectUrn,
              payload: {
                slug: tr.toolName,
                intent_class: intentClass,
                error: hasError
                  ? truncate(String(resultRecord['error']), 300)
                  : undefined,
              },
            })
          }
        }

        stepEvents.push({
          tenant_id: tenantId,
          interaction_id: interactionId,
          user_id: user.id,
          role: userRole,
          event_type: 'step_finished',
          subject_urn: subjectUrn,
          payload: {
            tokens: s.usage?.totalTokens ?? 0,
            text_length: s.text?.length ?? 0,
          },
        })

        // Fire-and-forget — telemetry must never block streaming.
        void emitAgentEvents(supabase, stepEvents)
      },
      onFinish: async (event) => {
        try {
          const assistantText = event.steps
            .map(s => s.text)
            .filter(t => t && t.trim().length > 0)
            .join('\n\n')
            .trim()

          const usageTotal = event.steps.reduce(
            (acc, s) => acc + (s.usage?.totalTokens ?? 0),
            0
          )

          const baseMessages = messages.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }))

          const fullMessages = [...baseMessages]
          if (assistantText) {
            fullMessages.push({ role: 'assistant' as const, content: assistantText })
          }

          const rolling = fullMessages.slice(-ROLLING_MESSAGE_LIMIT)

          const threadType = agentType === 'onboarding-coach' ? 'onboarding' : 'general'

          const { data: existing } = await supabase
            .from('ai_conversations')
            .select('id, total_tokens_used')
            .eq('user_id', user.id)
            .eq('tenant_id', tenantId)
            .eq('thread_type', threadType)
            .is('thread_entity_id', null)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          const totalTokensUsed = (existing?.total_tokens_used ?? 0) + usageTotal

          const payload = {
            tenant_id: tenantId,
            user_id: user.id,
            thread_type: threadType,
            thread_entity_id: null as string | null,
            messages: rolling,
            message_count: rolling.length,
            total_tokens_used: totalTokensUsed,
          }

          let conversationId: string | null = existing?.id ?? null
          if (existing?.id) {
            await supabase.from('ai_conversations').update(payload).eq('id', existing.id)
          } else {
            const { data: inserted } = await supabase
              .from('ai_conversations')
              .insert(payload)
              .select('id')
              .single()
            conversationId = inserted?.id ?? null
          }

          // Persist the interaction row FIRST, using the same id the client has in
          // `X-Interaction-Id`. Without this, every thumbs up/down UPDATE WHERE id=...
          // was a silent no-op.
          await supabase.from('agent_interaction_outcomes').insert({
            id: interactionId,
            tenant_id: tenantId,
            conversation_id: conversationId,
            rep_crm_id: repId,
            query_type: agentType,
            query_summary: truncate(lastUserMessage, 500),
            response_summary: truncate(assistantText, 800),
          })

          const finishMonth = currentUsageMonthKey()
          const { data: usageTenant } = await supabase
            .from('tenants')
            .select('ai_tokens_used_current, business_config')
            .eq('id', tenantId)
            .single()

          const usageCfg = (usageTenant?.business_config as Record<string, unknown> | null) ?? {}
          const usageStored =
            typeof usageCfg[USAGE_MONTH_KEY] === 'string'
              ? (usageCfg[USAGE_MONTH_KEY] as string)
              : null

          if (usageStored !== finishMonth) {
            await supabase
              .from('tenants')
              .update({
                ai_tokens_used_current: usageTotal,
                business_config: { ...usageCfg, [USAGE_MONTH_KEY]: finishMonth },
              })
              .eq('id', tenantId)
          } else {
            await supabase
              .from('tenants')
              .update({
                ai_tokens_used_current: (usageTenant?.ai_tokens_used_current ?? 0) + usageTotal,
              })
              .eq('id', tenantId)
          }

          try {
            await citations.flush(supabase)
          } catch (citationErr) {
            console.error('[agent] citation flush:', citationErr)
          }

          // Per-slice "consumed" telemetry. This is what makes the bandit
          // learn — without it we only know which slices were *loaded*,
          // not which ones the response actually leaned on. Fires one
          // event per slice whose URN tokens appeared in the assistant
          // text. Non-cited slices stay silent (treated as neutral by
          // the bandit, not negative).
          if (packed) {
            const consumed = consumedSlicesFromResponse(packed, assistantText)
            if (consumed.length > 0) {
              const consumedEvents = consumed.map((c) => ({
                tenant_id: tenantId,
                interaction_id: interactionId,
                user_id: user.id,
                role: userRole,
                event_type: 'context_slice_consumed' as const,
                subject_urn: subjectUrn,
                payload: {
                  slug: c.slug,
                  urns_referenced: c.urns_referenced,
                  intent_class: intentClass,
                  query_type: agentType,
                },
              }))
              void emitAgentEvents(supabase, consumedEvents)
            }
          }

          // response_finished is the "label anchor" for attribution + eval growth.
          // Carries the summary metrics the optimiser will key off nightly.
          await emitAgentEvent(supabase, {
            tenant_id: tenantId,
            interaction_id: interactionId,
            user_id: user.id,
            role: userRole,
            event_type: 'response_finished',
            subject_urn: subjectUrn ?? urn.interaction(tenantId, interactionId),
            payload: {
              agent_type: agentType,
              intent_class: intentClass,
              model: modelId,
              step_count: event.steps.length,
              tool_calls: toolCallsMade,
              citation_count: citations.getCitations().length,
              tokens_total: usageTotal,
              response_length: assistantText.length,
              slices_loaded: packed?.hydrated ?? [],
              slices_consumed: packed
                ? consumedSlicesFromResponse(packed, assistantText).map(
                    (c) => c.slug,
                  )
                : [],
            },
          })
        } catch (persistErr) {
          console.error('[agent] onFinish persist:', persistErr)
          await emitAgentEvent(supabase, {
            tenant_id: tenantId,
            interaction_id: interactionId,
            user_id: user.id,
            role: userRole,
            event_type: 'error',
            payload: {
              where: 'onFinish',
              message: truncate(String(persistErr), 300),
            },
          })
        }
      },
    })

    return result.toDataStreamResponse({
      headers: { 'X-Interaction-Id': interactionId },
    })
  } catch (err) {
    console.error('[agent] Error:', err)
    return new Response(
      JSON.stringify({ error: 'Agent unavailable. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
