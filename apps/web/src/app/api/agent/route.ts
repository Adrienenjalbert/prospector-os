import { streamText, convertToCoreMessages, type CoreMessage } from 'ai'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  assembleContextForStrategy,
  assembleContextPack,
  pickContextStrategy,
} from '@/lib/agent/context-strategies'
import {
  consumedSlicesFromResponse,
  citedMemoryIdsFromResponse,
  injectedMemoryIdsFromPacked,
  type IntentClass,
  type PackedContext,
} from '@/lib/agent/context'
import {
  updateMemoryPosteriors,
  updateWikiPagePosteriors,
} from '@/lib/memory/bandit'
import type { AgentContext } from '@prospector/core'
import type { ContextSelection } from '@/lib/agent/context-strategies'
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
import { compactConversation, COMPACTION_CONSTANTS } from '@/lib/agent/compaction'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

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

/**
 * Hints we hand the slice selector so it can fire stage- and signal-aware
 * boosts. The selector defaults to `stage='other', isStalled=false,
 * signalTypes=[]` when these are absent — which makes the `whenStalled`
 * trigger inert and the signal-substring scoring blind.
 *
 * We derive from the legacy AgentContext (already loaded for prompt
 * builders) so this stays a pure transform: no new DB roundtrip, no
 * dependency on the packer reaching back into the route's data.
 *
 * Order of precedence for `dealStage`:
 *   1. The active deal's stage (when on a deal/opportunity page).
 *   2. The active account's most-progressed deal stage (heuristic for
 *      account_deep selection — tells the selector what stage rep is
 *      likely thinking about).
 *   3. null (selector falls back to its default).
 */
interface IntentHints {
  dealStage: string | null
  isStalled: boolean
  signalTypes: string[]
}

function deriveIntentHints(
  ctx: AgentContext | null,
  selection: ContextSelection,
): IntentHints {
  if (!ctx) {
    return { dealStage: null, isStalled: false, signalTypes: [] }
  }

  let dealStage: string | null = null
  let isStalled = false

  if (selection.strategy === 'deal_deep' && ctx.current_deal) {
    dealStage = ctx.current_deal.stage ?? null
    if (selection.activeDealId) {
      isStalled = ctx.stalled_deals.some((d) => d.id === selection.activeDealId)
    }
  } else if (selection.strategy === 'account_deep' && selection.activeCompanyId) {
    const accountStalled = ctx.stalled_deals.find(
      (d) => d.company_id === selection.activeCompanyId,
    )
    if (accountStalled) {
      dealStage = accountStalled.stage ?? null
      isStalled = true
    } else {
      const accountSummary = ctx.priority_accounts.find(
        (a) => a.id === selection.activeCompanyId,
      )
      if (accountSummary) {
        dealStage = accountSummary.stage ?? null
        isStalled = accountSummary.is_stalled
      }
    }
  } else {
    // rep_centric / portfolio: surface the rep's most-stalled deal
    // stage so the selector still gets a meaningful hint when no
    // single object is active.
    const firstStalled = ctx.stalled_deals[0]
    if (firstStalled) {
      dealStage = firstStalled.stage ?? null
      isStalled = true
    }
  }

  // Signal types: dedupe across the most recent signals, capped to
  // keep the selector's substring scoring bounded.
  const signalTypes = Array.from(
    new Set(
      (ctx.recent_signals ?? [])
        .slice(0, 12)
        .map((s) => s.signal_type)
        .filter((t): t is string => typeof t === 'string' && t.length > 0),
    ),
  )

  return { dealStage, isStalled, signalTypes }
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

    // D7.2 — intent-aware routing. The route already has the intent
    // classified above; pass it through alongside the per-tenant
    // model_routing override so the chooseModel policy can downgrade
    // cheap intents to Haiku safely.
    const tenantBizConfig = (tenantRow.business_config as Record<string, unknown> | null) ?? {}
    const tenantModelRouting = (tenantBizConfig.model_routing ?? null) as
      | Record<string, string>
      | null
    const modelId = chooseModel({
      tokensUsedThisMonth: tokensUsed,
      monthlyBudget: budget,
      intentClass,
      tenantOverride: tenantModelRouting ?? undefined,
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

    // Run the legacy assembler FIRST so we can derive intent hints
    // (dealStage, isStalled, signalTypes) from its result and pass them
    // into the Context Pack. Without these hints the slice selector falls
    // back to defaults (stage='other', isStalled=false, signalTypes=[])
    // and the `whenStalled` / signal-substring scoring effectively never
    // fires — biasing the selector toward generic slices regardless of
    // what the rep is actually looking at.
    //
    // Phase 1 keeps both context paths — the legacy AgentContext stays
    // the source of truth for prompt builders, the PackedContext layers
    // in URN-cited slice citations and emits per-slice telemetry.
    const agentContext =
      dispatch.agentType === 'onboarding-coach'
        ? null
        : await assembleContextForStrategy({
            supabase,
            tenantId,
            repId,
            selection: contextSelection,
            pageContext: context.pageContext,
          })

    // Derive selector hints from the legacy context. This is cheap (pure
    // map lookups), and keeping it in the route rather than inside the
    // packer avoids a second DB roundtrip per turn just to recover what
    // the legacy assembler already loaded.
    const intentHints = deriveIntentHints(agentContext, contextSelection)

    const packed: PackedContext | null =
      dispatch.agentType === 'onboarding-coach'
        ? null
        : await assembleContextPack({
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
            dealStage: intentHints.dealStage,
            isStalled: intentHints.isStalled,
            signalTypes: intentHints.signalTypes,
            // C5.2: forward the user message so RAG slices can do
            // similarity retrieval keyed on the actual question.
            userMessageText: lastUserMessage,
          }).catch((err) => {
            // Context Pack failures must NEVER break a turn — log and
            // proceed with the legacy AgentContext only.
            console.warn('[agent] context-pack failed:', err)
            return null
          })

    // Forward slice citations into the collector so the same UI pills
    // surface them. Cite-or-shut-up holds for context evidence too.
    if (packed) {
      for (const c of packed.citations) {
        citations.addCitation(c)
      }
    }

    // Build the system prompt as parts so both the static prefix AND
    // the trailing behaviour-rules block can be marked for Anthropic
    // prompt caching (B3.1 — two breakpoints). `intentClass` + `role`
    // drive per-turn exemplar selection (A1.1) — the dynamic suffix
    // splices the matching mined few-shots when present.
    const promptParts = await buildSystemPromptParts(
      dispatch.agentType,
      tenantId,
      agentContext,
      packed,
      { intentClass, role: dispatch.role },
    )

    // Compact the message history (Phase 3.9). Threads ≤ 12 messages
    // pass through unchanged; longer threads get the older half summarised
    // by Haiku into a single leading `system` message and the last 8
    // verbatim. Persisted on ai_conversations.summary_text so the cache
    // hits on subsequent turns. Falls back to a rolling slice if the
    // Haiku call fails — the turn never breaks because compaction failed.
    const compacted = await compactConversation({
      messages: messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      supabase,
      conversationId: activeConversationId,
    })

    // Anthropic supports up to 4 cache breakpoints; we use TWO here
    // (B3.1) so both the tenant/role-stable PREFIX and the
    // tenant/role-stable trailing BEHAVIOUR RULES get cached, while
    // per-turn dynamic data flows uncached between them. Layout:
    //
    //   system: staticPrefix      ← cached (breakpoint 1)
    //   system: dynamicSuffix     ← per-turn, never cached
    //   system: cacheableSuffix   ← cached (breakpoint 2) — usually
    //                                commonBehaviourRules() at ~1.2k
    //                                tokens. Kept at the end of the
    //                                prompt for the lost-in-the-middle
    //                                attention bonus on citation
    //                                discipline.
    //
    // Onboarding-coach has no dynamic suffix and no cacheable suffix
    // today, but we still cache its single static prefix (B3.2) — every
    // onboarding-coach turn after the first re-uses the same large
    // prompt, so caching it is pure win.
    const baseUserMessages = convertToCoreMessages(compacted.messages)

    const cacheableSuffix = promptParts.cacheableSuffix ?? ''
    const hasDynamic = promptParts.dynamicSuffix.length > 0
    const hasCacheableSuffix = cacheableSuffix.length > 0

    const messagesForStream: CoreMessage[] = []

    // Always cache the static prefix when we have any further parts to
    // stitch in. This is the B3.2 fix: previously the onboarding-coach
    // (no dynamic, no suffix) fell into the `useCaching=false` branch
    // and lost the cache entirely. Now even the prefix-only case caches.
    messagesForStream.push({
      role: 'system' as const,
      content: promptParts.staticPrefix,
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    })

    if (hasDynamic) {
      messagesForStream.push({
        role: 'system' as const,
        content: promptParts.dynamicSuffix,
      })
    }

    if (hasCacheableSuffix) {
      messagesForStream.push({
        role: 'system' as const,
        content: cacheableSuffix,
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      })
    }

    messagesForStream.push(...baseUserMessages)

    const toolCallsMade: string[] = []

    // Server-side enforcement of MISSION's "≤ 150 words short-form" rule
    // via `maxTokens`. The behaviour-rules block already tells the model
    // to stay short, but a model with 3000 token budget can drift into
    // 600-word answers when the prompt rule loses to verbose tool
    // responses. By scaling the output cap to the rep's `comm_style` we
    // make the cap structural rather than aspirational:
    //   - brief  → ~80 words / ~120 tokens × 4 buffer = 480
    //   - casual → ~150 words / ~225 tokens × 4 buffer = 900
    //   - formal → ~200 words / ~300 tokens × 4 buffer = 1200
    //   - default (no rep_profile) → 3000 (legacy behaviour, no regression)
    // Tool calls + reasoning land in `usage.totalTokens`; this cap only
    // bounds the final response text. A draft-letter tool returning a
    // 500-word email body still works because it lives in the tool result.
    const repCommStyle = agentContext?.rep_profile?.comm_style ?? null
    const responseTokenCap =
      repCommStyle === 'brief'
        ? 480
        : repCommStyle === 'casual'
          ? 900
          : repCommStyle === 'formal'
            ? 1200
            : 3000

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
