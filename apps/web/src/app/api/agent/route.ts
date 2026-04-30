import { streamText } from 'ai'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  consumedSlicesFromResponse,
  citedMemoryIdsFromResponse,
  injectedMemoryIdsFromPacked,
  type IntentClass,
} from '@/lib/agent/context'
import {
  updateMemoryPosteriors,
  updateWikiPagePosteriors,
} from '@/lib/memory/bandit'
import { AGENT_TYPES, type AgentRole } from '@/lib/agent/tools'
import {
  CitationCollector,
  emitAgentEvent,
  emitAgentEvents,
  urn,
  type AgentEventInput,
} from '@prospector/core'
import { recordCitationsFromToolResult } from '@/lib/agent/citations'
import { getModel } from '@/lib/agent/model-registry'
import { getHaikuThumbsUpRate } from '@/lib/agent/intent-quality'
import { compactConversation, COMPACTION_CONSTANTS } from '@/lib/agent/compaction'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { assembleAgentRun } from '@/lib/agent/run-agent'

// `ROLLING_MESSAGE_LIMIT` is the persistence cap on
// `ai_conversations.messages`. It must be at least the compaction tail
// size (KEEP_RECENT_MESSAGES) so the model can always reload the
// verbatim window from history; anything beyond the tail gets
// summarised into `summary_text` on the conversation row, so storing
// more raw turns past the tail is wasted bytes (and risks UIs that
// render history showing more than the model ever saw).
//
// Keep ~2x the tail to give a small "look-back" buffer for analytics
// surfaces or future compaction retries.
const ROLLING_MESSAGE_LIMIT = COMPACTION_CONSTANTS.KEEP_RECENT_MESSAGES * 2
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

// `deriveIntentHints` lived here pre-PR3. It read the legacy
// AgentContext to compute (dealStage, isStalled, signalTypes) hints
// for the packer's slice selector. PR3 reverses the run order
// (packer first, profile-loader second), so by the time the
// AgentContext exists the packer has already shipped — there's
// nowhere to thread the hints. Dropped along with the per-turn
// legacy-assembler call. If a future PR re-wires hints via a small
// targeted query (active deal stage + stalled lookup), the function
// can be reinstated; the prior implementation is in git history.

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

    // Rate limit per user. The chat agent is the most expensive
    // endpoint we expose (Claude tokens + tool fan-out). Without a
    // limiter, a hammering script costs O($) per minute per attacker.
    // Default cap is 10 turns / minute / user — enough for normal
    // conversation, will trip an automated abuser. The check uses
    // `agent_events` as the source so it works across cold-starts and
    // horizontal scale (in-memory state would be effectively unlimited).
    const limit = await checkRateLimit(supabase, user.id)
    if (!limit.allowed) {
      console.warn(
        `[agent] rate-limited user=${user.id} used=${limit.used}/${limit.limit}`,
      )
      return rateLimitResponse(limit)
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

    // D7.2 — intent-aware routing snapshot. We pre-load the historical
    // Haiku thumbs-up rate so we can pass it to assembleAgentRun
    // (avoids a redundant DB roundtrip there) AND surface it in the
    // interaction_started event payload below.
    const tenantBizConfig = (tenantRow.business_config as Record<string, unknown> | null) ?? {}
    const tenantModelRouting = (tenantBizConfig.model_routing ?? null) as
      | Record<string, string>
      | null
    const haikuThumbsUpRate = await getHaikuThumbsUpRate(supabase, tenantId, intentClass)

    const interactionId = crypto.randomUUID()
    const citations = new CitationCollector(tenantId, interactionId)
    const citationCtx = { collector: citations, crmType: tenantRow.crm_type ?? null }

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

    // Compact the message history (Phase 3.9). Threads ≤ 12 messages
    // pass through unchanged; longer threads get the older half
    // summarised by Haiku into a single leading `system` message and
    // the last 8 verbatim. Persisted on `ai_conversations.summary_text`
    // so the cache hits on subsequent turns. Falls back to a rolling
    // slice if the Haiku call fails — the turn never breaks because
    // compaction failed. Compaction is route-owned (not in
    // assembleAgentRun) because it needs the conversation row id and
    // is a per-turn write to ai_conversations.summary_text.
    const compacted = await compactConversation({
      messages: messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      supabase,
      conversationId: activeConversationId,
    })

    // Sprint 3 — Slack/dashboard parity. Both routes now go through
    // assembleAgentRun for tool loading, context assembly, prompt
    // building, model selection, and the two-breakpoint cache layout.
    // The dashboard route remains responsible for auth, rate limiting,
    // ai_token_budget enforcement, conversation persistence, and
    // streaming response — none of which are part of "what the model
    // sees". MISSION §9.4 promises both surfaces hit the same runtime;
    // this delegation is the mechanical implementation.
    const assembled = await assembleAgentRun({
      supabase,
      tenantId,
      repId,
      userId: user.id,
      role: userRole as AgentRole,
      agentTypeOverride: agentType,
      activeUrn: subjectUrn,
      pageContext: context.pageContext,
      userMessageText: lastUserMessage,
      intentClass,
      messages: compacted.messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      interactionId,
      conversationId: activeConversationId,
      crmType: tenantRow.crm_type ?? null,
      tokensUsedThisMonth: tokensUsed,
      monthlyBudget: budget,
      tenantModelRouting,
      // Forward the rate so assembleAgentRun skips its own loader
      // (idempotency-of-DB-load — the test pins this contract).
      historicalHaikuThumbsUpRate: haikuThumbsUpRate,
    })

    const { modelId, dispatch, tools, messages: messagesForStream, responseTokenCap, agentContext, packedContext: packed } = assembled

    // Forward slice citations into the route's collector so the UI
    // pills + onFinish persistence see them. Cite-or-shut-up holds for
    // context evidence too — the assembleAgentRun packer collected
    // them; the route flushes them.
    if (packed) {
      for (const c of packed.citations) {
        citations.addCitation(c)
      }
    }

    // Emit interaction_started AFTER assembleAgentRun so the payload
    // can record the resolved model id (otherwise the event's `model`
    // field would be a guess). This is the anchor every later event
    // in the learning loop keys off.
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

    const toolCallsMade: string[] = []

    const result = streamText({
      model: getModel(modelId),
      messages: messagesForStream,
      tools,
      maxSteps: 8,
      temperature: 0.3,
      maxTokens: responseTokenCap,
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

          // Sum every dimension the AI SDK exposes so the
          // `agent_token_costs_daily` view (P0.1) can compute USD
          // cost per model with the cache-read discount applied.
          // The AI SDK's `usage` object surfaces `promptTokens`,
          // `completionTokens`, `totalTokens`, and (for Anthropic
          // when the prompt cache hits) `cachedPromptTokens` /
          // `cacheReadInputTokens` via providerMetadata. We accept
          // multiple property names so we stay robust to SDK churn.
          let usageInput = 0
          let usageOutput = 0
          let usageCachedInput = 0
          let usageTotal = 0
          for (const s of event.steps) {
            const u = s.usage as
              | {
                  totalTokens?: number
                  promptTokens?: number
                  completionTokens?: number
                  cachedPromptTokens?: number
                  inputTokens?: number
                  outputTokens?: number
                }
              | undefined
            if (!u) continue
            usageTotal += u.totalTokens ?? 0
            usageInput += u.promptTokens ?? u.inputTokens ?? 0
            usageOutput += u.completionTokens ?? u.outputTokens ?? 0
            // Anthropic's cache-read counter lives at one of these
            // names depending on SDK version. Prefer providerMetadata
            // when present (more authoritative) and fall back.
            const pm = (s as unknown as {
              providerMetadata?: {
                anthropic?: {
                  cacheReadInputTokens?: number
                  cacheCreationInputTokens?: number
                }
              }
            }).providerMetadata
            usageCachedInput +=
              pm?.anthropic?.cacheReadInputTokens ??
              u.cachedPromptTokens ??
              0
          }

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

            // Phase 6 (1.2) — close the memory bandit loop. Emit one
            // memory_cited per atom URN the response touched and one
            // wiki_page_cited per page URN. Then batch-update the per-row
            // Beta posterior on tenant_memories.prior_alpha/beta (and
            // wiki_pages.prior_alpha/beta) — alpha += 1 per cited id,
            // beta += 1 per injected id. The packer already emitted
            // memory_injected / wiki_page_injected during load.
            const cited = citedMemoryIdsFromResponse(assistantText, tenantId)
            const injected = injectedMemoryIdsFromPacked(packed)

            const memoryCitedEvents: AgentEventInput[] = cited.memoryIds.map((memoryId) => ({
              tenant_id: tenantId,
              interaction_id: interactionId,
              user_id: user.id,
              role: userRole,
              event_type: 'memory_cited' as const,
              subject_urn: urn.memory(tenantId, memoryId),
              payload: {
                memory_id: memoryId,
                kind: 'unknown', // resolved post-hoc via tenant_memories join
                urn: urn.memory(tenantId, memoryId),
                intent_class: intentClass,
              },
            }))
            const pageCitedEvents: AgentEventInput[] = cited.wikiPageIds.map((pageId) => ({
              tenant_id: tenantId,
              interaction_id: interactionId,
              user_id: user.id,
              role: userRole,
              event_type: 'wiki_page_cited' as const,
              subject_urn: urn.wikiPage(tenantId, pageId),
              payload: {
                page_id: pageId,
                kind: 'unknown', // resolved post-hoc via wiki_pages join
                urn: urn.wikiPage(tenantId, pageId),
                intent_class: intentClass,
              },
            }))
            const allCitedEvents = [...memoryCitedEvents, ...pageCitedEvents]
            if (allCitedEvents.length > 0) {
              void emitAgentEvents(supabase, allCitedEvents)
            }

            // Posterior updates — fire-and-forget. The memory-bandit
            // module swallows any per-row failures so a single dead row
            // can't break the whole turn's learning signal.
            void updateMemoryPosteriors(
              supabase,
              tenantId,
              injected.memoryIds,
              cited.memoryIds,
            )
            void updateWikiPagePosteriors(
              supabase,
              tenantId,
              injected.wikiPageIds,
              cited.wikiPageIds,
            )
          }

          // response_finished is the "label anchor" for attribution + eval growth.
          // Carries the summary metrics the optimiser will key off nightly.
          //
          // Token breakdown is split into (input | output | cached_input)
          // so `agent_token_costs_daily` (migration 018 / P0.1) can
          // compute precise USD cost per model with the prompt-cache
          // discount applied. `tokens_total` is kept for legacy
          // consumers (existing /admin/roi cited-rate calc).
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
              input_tokens: usageInput,
              output_tokens: usageOutput,
              cached_input_tokens: usageCachedInput,
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
