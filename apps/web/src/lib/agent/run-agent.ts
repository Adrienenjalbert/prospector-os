import type { CoreMessage, Tool } from 'ai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { convertToCoreMessages } from 'ai'

import {
  buildSystemPromptParts,
  dispatchAgent,
  loadToolsForDispatch,
  type AgentRole,
  type AgentSurface,
} from './tools'
import {
  assembleContextForStrategy,
  assembleContextPack,
  pickContextStrategy,
} from './context-strategies'
import type { ContextSelection } from './context-strategies'
import type { IntentClass, PackedContext } from './context'
import type { AgentContext, PageContext } from '@prospector/core'
import { chooseModel } from './model-registry'
import { getHaikuThumbsUpRate } from './intent-quality'
import { loadProfilesForPrompt, synthesizePackerSuccessContext } from './profile-loader'

/**
 * Track D — unify Slack and dashboard runtimes.
 *
 * Both `/api/agent` (dashboard, streaming) and `/api/slack/events`
 * (Slack DM, generateText) need the same per-turn assembly:
 *
 *   1. Resolve dispatch from (role, activeUrn, surface)
 *   2. Load tenant-scoped, role-filtered, intent-ranked tools
 *   3. Build the legacy AgentContext (for prompt builders) AND the
 *      Packed Context (for slice citations + telemetry)
 *   4. Build the system prompt parts (cacheable prefix + dynamic +
 *      cacheable suffix)
 *   5. Assemble the message array with two Anthropic cache
 *      breakpoints
 *   6. Pick the right model id via the cost-aware policy (NOT
 *      hardcoded Haiku for Slack — that was the bug Track D fixes)
 *
 * Pre-this-change Slack hardcoded Haiku, used `maxSteps: 4`, set a
 * fixed 2k token cap, and skipped some of the prompt parts. A rep
 * who asked the same question in Slack vs the dashboard got
 * materially different answers. Now both routes call this single
 * function and only override what's truly route-specific:
 *
 *   - streaming vs final text     (the route picks streamText vs generateText)
 *   - persistence (conversations) (the route owns its own onFinish)
 *   - rate-limiting               (the route owns its auth model)
 *
 * The parity test in `__tests__/run-agent-parity.test.ts` locks the
 * shared assembly against future drift.
 */

export interface AssembleAgentRunInput {
  supabase: SupabaseClient
  tenantId: string
  /** Numeric/CRM rep id used for tenant-scoped queries. */
  repId: string
  /** Supabase auth user id. For Slack we re-use repId. */
  userId: string
  role: AgentRole
  /**
   * Optional surface override. When omitted, the dispatcher infers
   * from `(role, activeUrn)`.
   */
  agentTypeOverride?: AgentSurface
  /** URN of the page-level object the user is on, if any. */
  activeUrn?: string | null
  /** Page-context blob from the dashboard. Slack passes undefined. */
  pageContext?: PageContext
  /** The latest user message text — drives intent + RAG queries. */
  userMessageText: string
  /** Pre-classified intent. Routes that classify upstream pass it in. */
  intentClass: IntentClass
  /** The full prior message history (already compacted by the caller). */
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  /** Per-turn id used for telemetry + tool callbacks. */
  interactionId: string
  /** Active conversation row id when the route persists threads. */
  conversationId?: string | null
  /** CRM type for URN deep-link helpers in slices. */
  crmType?: string | null
  /**
   * AI budget snapshot — drives `chooseModel`'s 90%-budget Haiku
   * downgrade. Both routes load this from `tenants` and forward.
   */
  tokensUsedThisMonth: number
  monthlyBudget: number
  /** Per-tenant model routing override. */
  tenantModelRouting?: Record<string, string> | null
  /**
   * Per-rep comm style → output token cap. Routes can omit (defaults
   * to 3000). Slack passes 'brief' to keep DMs short.
   */
  repCommStyle?: 'brief' | 'casual' | 'formal' | null
  /**
   * Optional pre-loaded thumbs-up rate for `claude-haiku-4` on
   * `intentClass`, used by `chooseModel`'s quality gate to refuse
   * cheap-intent downgrades when historical Haiku quality is poor
   * for this tenant.
   *
   * When omitted, the assembler loads it itself via
   * `getHaikuThumbsUpRate`. Routes that already loaded it (e.g. for
   * their own logging) can pass it in to avoid the extra round trip;
   * undefined here is the default ("no signal — apply default
   * routing policy").
   */
  historicalHaikuThumbsUpRate?: number
}

export interface AssembledAgentRun {
  /** Resolved model id (e.g. `anthropic/claude-sonnet-4`). */
  modelId: string
  /** Resolved dispatch (surface + role + activeUrn). */
  dispatch: {
    role: AgentRole
    agentType: AgentSurface
    activeUrn: string | null
  }
  /** Resolved context strategy (drives slice selection). */
  contextSelection: ContextSelection
  /** Loaded tool map (tenant + role + intent ranked). */
  tools: Record<string, Tool>
  /**
   * Full message array with two cache breakpoints positioned per
   * B3.1/B3.2 — first system message + (optional) trailing
   * cacheableSuffix system message both carry the
   * `providerOptions.anthropic.cacheControl` flag.
   */
  messages: CoreMessage[]
  /** Hard ceiling for the response text. */
  responseTokenCap: number
  /** The legacy assembler output (still consumed by some prompt builders). */
  agentContext: AgentContext | null
  /** The Packed Context (slice citations + selection telemetry). */
  packedContext: PackedContext | null
}

const COMM_STYLE_TO_TOKENS: Record<'brief' | 'casual' | 'formal', number> = {
  // Slack defaults to brief; dashboard rep can opt up to casual/formal.
  brief: 480,
  casual: 900,
  formal: 1200,
}

const DEFAULT_TOKEN_CAP = 3000

export async function assembleAgentRun(
  input: AssembleAgentRunInput,
): Promise<AssembledAgentRun> {
  const dispatch = dispatchAgent({
    role: input.role,
    activeUrn: input.activeUrn ?? null,
    explicitAgentType: input.agentTypeOverride,
  })

  // D7.2 intent-aware routing — same call sites, same policy. Slack
  // used to hardcode Haiku; now both routes get the cost-aware
  // chooseModel decision so the tenant's `model_routing` overrides
  // apply equally.
  //
  // Quality gate (PR1): the historical Haiku thumbs-up rate for this
  // (tenant, intent) is loaded here unless the caller already passed
  // it in. `chooseModel` refuses the cheap-intent downgrade when the
  // rate is below MIN_HAIKU_THUMBS_UP, so a regression on any tenant
  // auto-engages the gate without code changes.
  const haikuRate =
    input.historicalHaikuThumbsUpRate ??
    (await getHaikuThumbsUpRate(input.supabase, input.tenantId, input.intentClass))

  const modelId = chooseModel({
    tokensUsedThisMonth: input.tokensUsedThisMonth,
    monthlyBudget: input.monthlyBudget,
    intentClass: input.intentClass,
    tenantOverride: input.tenantModelRouting ?? undefined,
    historicalHaikuThumbsUpRate: haikuRate,
  })

  const contextSelection = pickContextStrategy({
    role: dispatch.role,
    activeUrn: dispatch.activeUrn,
  })

  // Onboarding-coach skips the heavy context assembly — its slices
  // would all hit empty tables on a fresh tenant and the prompt
  // builder explicitly wants the empty/null path.
  const isOnboarding = dispatch.agentType === 'onboarding-coach'

  // PR3: run the packer FIRST. The legacy `assembleContextForStrategy`
  // is now a packer-failure fallback, not an unconditional parallel
  // fetch. When the packer succeeds (the common case), we replace
  // the 7-9 query legacy assembly with a single `loadProfilesForPrompt`
  // call that just fetches the rep_profile row — the only legacy
  // field the prompt builders actually still need (slice rendering
  // already goes through `formatPackedSections(packed)` and the
  // legacy slice arrays sit inside `else if (ctx)` branches that
  // never execute when packed is non-null).
  //
  // Pre-this-change: legacy + packer ran in parallel. Post: packer
  // first, then EITHER profile-load (cheap, success path) OR full
  // legacy assembler (failure path).
  const packedContext: PackedContext | null = isOnboarding
    ? null
    : await assembleContextPack({
        supabase: input.supabase,
        tenantId: input.tenantId,
        repId: input.repId,
        userId: input.userId,
        role: dispatch.role,
        selection: contextSelection,
        intentClass: input.intentClass,
        pageContext: input.pageContext,
        interactionId: input.interactionId,
        crmType: input.crmType ?? null,
        userMessageText: input.userMessageText,
      }).catch((err) => {
        // Match the dashboard route's behaviour: a context-pack
        // failure must NEVER break a turn. Fall back to legacy
        // AgentContext only.
        console.warn('[run-agent] context-pack failed:', err)
        return null
      })

  let agentContext: AgentContext | null
  if (isOnboarding) {
    agentContext = null
  } else if (packedContext) {
    // Packer succeeded — load just the rep_profile (single query).
    // If the profile load itself returns a null rep (misconfigured
    // tenant), drop into the legacy assembler so a missing rep
    // doesn't silently lose the rep header in the prompt.
    const profiles = await loadProfilesForPrompt(
      input.supabase,
      input.tenantId,
      input.repId,
    )
    agentContext = synthesizePackerSuccessContext(profiles)
    if (!agentContext) {
      console.warn(
        '[run-agent] profile-loader returned null rep_profile — falling back to legacy assembler',
      )
      agentContext = await assembleContextForStrategy({
        supabase: input.supabase,
        tenantId: input.tenantId,
        repId: input.repId,
        selection: contextSelection,
        pageContext: input.pageContext,
      })
    }
  } else {
    // Packer failed — full legacy assembler is the graceful
    // degradation path. Preserves pre-PR3 behaviour exactly.
    agentContext = await assembleContextForStrategy({
      supabase: input.supabase,
      tenantId: input.tenantId,
      repId: input.repId,
      selection: contextSelection,
      pageContext: input.pageContext,
    })
  }

  const promptParts = await buildSystemPromptParts(
    dispatch.agentType,
    input.tenantId,
    agentContext,
    packedContext,
    { intentClass: input.intentClass, role: dispatch.role },
  )

  const tools = await loadToolsForDispatch({
    supabase: input.supabase,
    tenantId: input.tenantId,
    repId: input.repId,
    userId: input.userId,
    role: dispatch.role,
    agentType: dispatch.agentType,
    activeUrn: dispatch.activeUrn,
    interactionId: input.interactionId,
    intentClass: input.intentClass,
    conversationId: input.conversationId ?? null,
  })

  // Two-breakpoint cache layout (B3.1):
  //
  //   system: staticPrefix    ← cached
  //   system: dynamicSuffix   ← per-turn, never cached
  //   system: cacheableSuffix ← cached (commonBehaviourRules ~1.2k toks)
  //
  // Both routes use this exact shape so warm sessions get the same
  // cache savings on Slack as on the dashboard.
  const messages: CoreMessage[] = []
  messages.push({
    role: 'system',
    content: promptParts.staticPrefix,
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  })

  if (promptParts.dynamicSuffix.length > 0) {
    messages.push({ role: 'system', content: promptParts.dynamicSuffix })
  }

  const cacheableSuffix = promptParts.cacheableSuffix ?? ''
  if (cacheableSuffix.length > 0) {
    messages.push({
      role: 'system',
      content: cacheableSuffix,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    })
  }

  messages.push(...convertToCoreMessages(input.messages))

  const responseTokenCap = input.repCommStyle
    ? COMM_STYLE_TO_TOKENS[input.repCommStyle]
    : DEFAULT_TOKEN_CAP

  return {
    modelId,
    dispatch,
    contextSelection,
    tools,
    messages,
    responseTokenCap,
    agentContext,
    packedContext,
  }
}
