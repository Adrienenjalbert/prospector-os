import type { AgentContext } from '@prospector/core'
import { tool, type Tool } from 'ai'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  createPipelineCoachTools,
  buildPipelineCoachPrompt,
  buildPipelineCoachPromptParts,
} from '../agents/pipeline-coach'
import {
  createAccountStrategistTools,
  buildAccountStrategistPrompt,
  buildAccountStrategistPromptParts,
} from '../agents/account-strategist'
import {
  createLeadershipLensTools,
  buildLeadershipLensPrompt,
  buildLeadershipLensPromptParts,
} from '../agents/leadership-lens'
import {
  createOnboardingTools,
  buildOnboardingCoachPrompt,
} from '../agents/onboarding'
import type { SystemPromptParts } from '../agents/_shared'
import type { PackedContext } from '../context'
import { loadToolsForAgent, type ToolRegistryRow } from '../tool-loader'
import { registerBuiltinToolHandlers } from './handlers'
import {
  DEFAULT_MIDDLEWARE,
  withMiddleware,
  type ToolMiddlewareCtx,
} from './middleware'
import { rankToolsByBandit } from '../tool-bandit'

/**
 * One universal agent, multiple surfaces.
 *
 * Per MISSION.md: "We have one agent, many tools." The list below is NOT
 * a list of distinct agents — it's the set of surface presets the same
 * agent presents itself as based on `(role, activeUrn)`. Each surface
 * picks a different prompt + tool subset; the runtime, model, telemetry,
 * citation engine, and workflow harness are shared.
 *
 * `AgentSurface` is the canonical name; `AgentType` is kept as an alias
 * so existing callers (chat sidebar, agent panel, hooks, tests) don't
 * need to change. New code should import `AgentSurface`.
 */
export const AGENT_SURFACES = [
  'pipeline-coach',
  'account-strategist',
  'leadership-lens',
  'onboarding-coach',
] as const

export type AgentSurface = (typeof AGENT_SURFACES)[number]

/** @deprecated Use `AGENT_SURFACES`. Kept as alias to avoid mass renames. */
export const AGENT_TYPES = AGENT_SURFACES
/** @deprecated Use `AgentSurface`. Kept as alias to avoid mass renames. */
export type AgentType = AgentSurface

export function isAgentSurface(value: unknown): value is AgentSurface {
  return typeof value === 'string' && (AGENT_SURFACES as readonly string[]).includes(value)
}

/** @deprecated Use `isAgentSurface`. */
export const isAgentType = isAgentSurface

// --------------------------------------------------------------------------
// Role + active-object dispatch
// --------------------------------------------------------------------------

/**
 * Every role the platform recognises. Kept short deliberately — role
 * definitions are a per-tenant concern (`business_profiles.role_definitions`),
 * but the union here enumerates what the dispatcher knows how to route.
 */
export type AgentRole =
  | 'nae'
  | 'ae'
  | 'growth_ae'
  | 'ad'
  | 'csm'
  | 'leader'
  | 'admin'
  | 'rep'

/**
 * Map role → AgentType default. When a user opens chat from the generic
 * sidebar (no active object), we land them in the surface that matches their
 * role. The ontology browser Action Panel can still override per-click.
 */
const ROLE_DEFAULT_AGENT: Record<string, AgentType> = {
  nae: 'account-strategist',
  ae: 'pipeline-coach',
  growth_ae: 'account-strategist',
  ad: 'account-strategist',
  csm: 'pipeline-coach',
  leader: 'leadership-lens',
  admin: 'leadership-lens',
  rep: 'pipeline-coach',
}

export interface AgentDispatch {
  agentType: AgentType
  role: AgentRole
  activeUrn: string | null
}

/**
 * Decides which agent surface to run based on (role, active object). The
 * active object wins when set: viewing a deal hands the user a deal-deep
 * agent regardless of role preset.
 */
export function dispatchAgent(opts: {
  role?: string | null
  activeUrn?: string | null
  explicitAgentType?: AgentType | null
}): AgentDispatch {
  const role = (opts.role as AgentRole) ?? 'rep'
  const activeUrn = opts.activeUrn ?? null

  if (opts.explicitAgentType) {
    return { agentType: opts.explicitAgentType, role, activeUrn }
  }

  if (activeUrn?.includes(':deal:') || activeUrn?.includes(':opportunity:')) {
    return { agentType: 'pipeline-coach', role, activeUrn }
  }
  if (activeUrn?.includes(':company:')) {
    return { agentType: 'account-strategist', role, activeUrn }
  }

  return {
    agentType: ROLE_DEFAULT_AGENT[role] ?? 'pipeline-coach',
    role,
    activeUrn,
  }
}

// --------------------------------------------------------------------------
// Static tool factories (fallback when tool_registry is empty)
// --------------------------------------------------------------------------

export function createAgentTools(
  tenantId: string,
  repId: string,
  agentType: AgentType,
): Record<string, Tool> {
  switch (agentType) {
    case 'pipeline-coach':
      return createPipelineCoachTools(tenantId, repId)
    case 'account-strategist':
      return createAccountStrategistTools(tenantId, repId)
    case 'leadership-lens':
      return createLeadershipLensTools(tenantId)
    case 'onboarding-coach':
      return createOnboardingTools(tenantId)
  }
}

export async function buildSystemPromptForAgent(
  agentType: AgentType,
  tenantId: string,
  agentContext: AgentContext | null,
  packed: PackedContext | null = null,
): Promise<string> {
  switch (agentType) {
    case 'pipeline-coach':
      return buildPipelineCoachPrompt(tenantId, agentContext, packed)
    case 'account-strategist':
      return buildAccountStrategistPrompt(tenantId, agentContext, packed)
    case 'leadership-lens':
      return buildLeadershipLensPrompt(tenantId, agentContext, packed)
    case 'onboarding-coach':
      return buildOnboardingCoachPrompt(tenantId)
  }
}

/**
 * Cache-aware variant of `buildSystemPromptForAgent`. Returns the system
 * prompt as `(staticPrefix, dynamicSuffix)` parts so the route can mark
 * the prefix as cacheable via Anthropic's `cacheControl: ephemeral`
 * provider option. ~50% input-token reduction within a session.
 *
 * Onboarding-coach has no prompt-caching split today (its prompt is
 * already small + tenant-specific) — returns the whole thing in
 * `staticPrefix` for callers that just want a single string.
 */
export async function buildSystemPromptParts(
  agentType: AgentType,
  tenantId: string,
  agentContext: AgentContext | null,
  packed: PackedContext | null = null,
): Promise<SystemPromptParts> {
  switch (agentType) {
    case 'pipeline-coach':
      return buildPipelineCoachPromptParts(tenantId, agentContext, packed)
    case 'account-strategist':
      return buildAccountStrategistPromptParts(tenantId, agentContext, packed)
    case 'leadership-lens':
      return buildLeadershipLensPromptParts(tenantId, agentContext, packed)
    case 'onboarding-coach': {
      const single = await buildOnboardingCoachPrompt(tenantId)
      return { staticPrefix: single, dynamicSuffix: '' }
    }
  }
}

// --------------------------------------------------------------------------
// Registry-driven tool loader (preferred path)
// --------------------------------------------------------------------------

/**
 * Loads tools from the tool_registry table for this tenant + role. Falls back
 * to the static agent-type factory when the registry is empty (new install)
 * or when the registry has no rows matching the role.
 *
 * Two paths for two stages of the platform lifecycle:
 *   1. No registry yet (greenfield): static factory ensures first-run works.
 *   2. Registry populated (steady state): DB drives what's available.
 */
export async function loadToolsForDispatch(opts: {
  supabase: SupabaseClient
  tenantId: string
  repId: string
  userId: string
  role: AgentRole
  agentType: AgentSurface
  activeUrn?: string | null
  /** Interaction id the agent route assigned for this turn. */
  interactionId?: string | null
  /**
   * Intent class from the route's `classifyIntent`. Used by the Thompson
   * tool bandit to rank tools by per-tenant priors. Optional so workflow
   * callers without an intent classification still work.
   */
  intentClass?: string | null
}): Promise<Record<string, Tool>> {
  registerBuiltinToolHandlers()

  const { tools, loaded } = await loadToolsForAgent({
    supabase: opts.supabase,
    tenantId: opts.tenantId,
    repId: opts.repId,
    userId: opts.userId,
    role: opts.role,
    activeUrn: opts.activeUrn ?? null,
    interactionId: opts.interactionId ?? null,
  })

  const baseTools =
    loaded.length > 0
      ? tools
      : // Fallback: nothing in registry for this (tenant, role). Use the static
        // factory so the agent still works on a greenfield tenant before
        // `scripts/seed-tools.ts` has run. CRITICAL: we wrap the same middleware
        // chain around the static tools so the harness contract holds —
        // citations, write-approval, telemetry, connector freshness all run
        // regardless of which path served the tool.
        (() => {
          console.warn(
            `[tools] tool_registry empty for tenant=${opts.tenantId} role=${opts.role}; falling back to harnessed static factory for agentType=${opts.agentType}`,
          )
          return wrapStaticToolsWithMiddleware(
            createAgentTools(opts.tenantId, opts.repId, opts.agentType),
            {
              supabase: opts.supabase,
              tenantId: opts.tenantId,
              repId: opts.repId,
              userId: opts.userId,
              role: opts.role,
              activeUrn: opts.activeUrn ?? null,
              interactionId: opts.interactionId ?? null,
            },
          )
        })()

  // Apply bandit ranking when we have an intent class. The model sees tools
  // in the resulting iteration order; for ambiguous prompts it tends to
  // prefer earlier-listed tools, biasing toward tools that have worked for
  // this tenant on this intent class. Failure here never blocks tool
  // availability — fall back to insertion order on error.
  if (opts.intentClass) {
    try {
      const ranked = await rankToolsByBandit(
        opts.supabase,
        opts.tenantId,
        opts.intentClass,
        Object.keys(baseTools),
      )
      const reordered: Record<string, Tool> = {}
      for (const slug of ranked) {
        if (baseTools[slug]) reordered[slug] = baseTools[slug]
      }
      // Append any tool the bandit forgot (defensive).
      for (const [slug, t] of Object.entries(baseTools)) {
        if (!reordered[slug]) reordered[slug] = t
      }
      return reordered
    } catch (err) {
      console.warn('[tools] bandit ranking failed, using insertion order:', err)
    }
  }

  return baseTools
}

// --------------------------------------------------------------------------
// Middleware wrapper for the static fallback path
// --------------------------------------------------------------------------

interface WrapStaticOpts {
  supabase: SupabaseClient
  tenantId: string
  repId: string
  userId: string
  role: AgentRole
  activeUrn: string | null
  interactionId: string | null
}

/**
 * The static factory returns AI-SDK `Tool` instances directly (with bound
 * execute functions). The registry path runs them through the middleware
 * chain in `tool-loader.ts`. Without this wrapper, fallback tools bypass
 * citation enforcement, write-approval, and telemetry — a silent harness
 * bypass that violates MISSION's Tier 2 contract. We synthesize a minimal
 * `ToolRegistryRow` per slug so the same middlewares can run.
 */
function wrapStaticToolsWithMiddleware(
  toolMap: Record<string, Tool>,
  opts: WrapStaticOpts,
): Record<string, Tool> {
  const wrapped: Record<string, Tool> = {}

  for (const [slug, t] of Object.entries(toolMap)) {
    const inner = t as Tool & {
      execute?: (args: unknown) => Promise<unknown>
      parameters?: unknown
      description?: string
    }

    if (typeof inner.execute !== 'function') {
      // Pass through anything we can't wrap (no execute = no harness needed).
      wrapped[slug] = t
      continue
    }

    const synthesizedRow: ToolRegistryRow = {
      slug,
      display_name: slug,
      description: inner.description ?? slug,
      available_to_roles: [],
      enabled: true,
      is_builtin: true,
      tool_type: 'builtin',
      execution_config: { handler: slug },
      citation_config: null,
    }

    const ctx: ToolMiddlewareCtx = {
      slug,
      tenantId: opts.tenantId,
      repId: opts.repId,
      userId: opts.userId,
      role: opts.role,
      activeUrn: opts.activeUrn,
      supabase: opts.supabase,
      registryRow: synthesizedRow,
      interactionId: opts.interactionId,
    }

    const originalExecute = inner.execute.bind(inner)
    const wrappedExecute = withMiddleware(originalExecute, ctx, DEFAULT_MIDDLEWARE)

    wrapped[slug] = tool({
      description: inner.description ?? slug,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: inner.parameters as any,
      execute: async (args: unknown) => {
        try {
          return ((await wrappedExecute(args)) ?? {}) as Record<string, unknown>
        } catch (err) {
          return {
            error:
              err instanceof Error ? err.message : 'tool_execution_failed',
          }
        }
      },
    })
  }

  return wrapped
}

export {
  createPipelineCoachTools,
  createAccountStrategistTools,
  createLeadershipLensTools,
  createOnboardingTools,
}
