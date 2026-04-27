import { tool, type Tool } from 'ai'
import type { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { emitAgentEvent } from '@prospector/core'
import {
  DEFAULT_MIDDLEWARE,
  withMiddleware,
  type ToolMiddleware,
  type ToolMiddlewareCtx,
} from './tools/middleware'
import {
  decodeTier2Config,
  isCrmWriteEnabled,
  TIER2_WRITE_TOOL_SLUGS,
} from '@/lib/tier2/config'
import { getCachedByTenant } from './cached-tool-registry'

// Re-export the invalidator so admin-side mutators can import it from
// the same module they import the loader from. This keeps the
// "remember to invalidate" surface small.
export { invalidateTenantCache as invalidateToolRegistryCache } from './cached-tool-registry'

/**
 * The tool registry makes the agent platform config-driven: tools are rows in
 * `tool_registry`, filtered at runtime by (tenant, role, enabled). Adding a
 * new tool is a DB insert plus a handler registration — no agent redeploy.
 *
 * We pair DB rows with TypeScript handlers:
 *   - DB row  → slug, description, role gating, citation_config, enabled
 *   - Handler → Zod schema for inputs, execute() function
 *
 * Matching happens by slug. A handler that is not in the registry is ignored
 * (so we can register unreleased handlers safely); a registry row without a
 * matching handler logs a warning and is dropped.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolHandler<TSchema extends z.ZodType<any, any, any> = z.ZodType<any, any, any>> = {
  slug: string
  schema: TSchema
  build: (ctx: ToolHandlerContext) => (args: z.infer<TSchema>) => Promise<unknown>
}

export interface ToolHandlerContext {
  tenantId: string
  repId: string
  userId: string
  role: string
  /** URN of the object the user is currently viewing, if any. */
  activeUrn: string | null
  supabase: SupabaseClient
  /**
   * Active ai_conversations.id for the current chat thread, if any.
   * Threaded through by the agent route so tools that scope per-
   * conversation (record_conversation_note, future memory variants)
   * can write/read the right conversation. Null when no conversation
   * row exists yet (e.g. first turn before persist).
   */
  conversationId?: string | null
  /** Interaction id (per-turn). Some tools emit telemetry with this. */
  interactionId?: string | null
}

export interface ToolRegistryRow {
  slug: string
  display_name: string
  description: string
  available_to_roles: string[]
  enabled: boolean
  is_builtin: boolean
  tool_type: string
  execution_config: { handler?: string } | null
  citation_config: Record<string, unknown> | null
  /**
   * Soft-deprecation timestamp (migration 012). When set, the loader
   * silently drops the tool from the per-turn list so the agent stops
   * calling it — without hard-deleting the row, which would cascade
   * into orphan `agent_events.tool_called` rows the bandit reads from.
   * The optional `deprecation_replacement` slug surfaces in the agent's
   * error message when an old call is attempted, nudging the model
   * toward the new tool.
   */
  deprecated_at: string | null
  deprecation_replacement: string | null
}

// --------------------------------------------------------------------------
// Handler registry (TS-side)
// --------------------------------------------------------------------------

const HANDLERS = new Map<string, ToolHandler>()

/**
 * Register a handler by its slug. Called at module load time from each
 * handler file (see `handlers/*`).
 */
export function registerToolHandler(handler: ToolHandler): void {
  HANDLERS.set(handler.slug, handler)
}

export function getRegisteredHandler(slug: string): ToolHandler | undefined {
  return HANDLERS.get(slug)
}

export function listRegisteredHandlers(): string[] {
  return Array.from(HANDLERS.keys())
}

// --------------------------------------------------------------------------
// Loader — the critical function that the agent route calls
// --------------------------------------------------------------------------

export interface LoadToolsOptions {
  tenantId: string
  repId: string
  userId: string
  role: string
  activeUrn?: string | null
  supabase: SupabaseClient
  /**
   * Optional slug allow-list. If passed, only tools matching are returned —
   * used when the agent route wants to constrain to "just the tools needed
   * for this role-preset".
   *
   * The agent route also passes the role's `default_tools` array from
   * `business_profiles.role_definitions[role]` here. Pre-this-change
   * `default_tools` was dead config (defined in the seed, never read at
   * runtime) so a tenant who set "AE only gets these 6 tools" still saw
   * every registry row matching the AE role. Now the loader honours the
   * intersection of: (registry row enabled, deprecated_at null,
   * available_to_roles ∋ role, slug ∈ allowlist if set).
   */
  allowlist?: string[]
  /**
   * Interaction id the agent route assigned for this user turn. Used by
   * the telemetry middleware to tie tool_called events back to a turn.
   * Optional so workflow-side callers without a turn id can still load.
   */
  interactionId?: string | null
  /**
   * Active ai_conversations.id, when known. Threaded into ToolHandlerContext
   * so per-conversation tools (record_conversation_note) can scope their
   * writes correctly. Resolved + persisted in the agent route's onFinish;
   * tools called before persist see null and gracefully no-op.
   */
  conversationId?: string | null
  /**
   * Optional override chain. When omitted, DEFAULT_MIDDLEWARE applies
   * (citations, telemetry, write-approval, connector freshness). Pass
   * `[]` to disable all middleware (discouraged outside tests).
   */
  middleware?: ToolMiddleware[]
}

export interface LoadedTool {
  slug: string
  tool: Tool
  description: string
  available_to_roles: string[]
}

/**
 * Queries the tool_registry for a tenant, filters by role + enabled, matches
 * each row against a registered handler, and returns a map ready to pass
 * into `streamText({ tools })`.
 */
export async function loadToolsForAgent(opts: LoadToolsOptions): Promise<{
  tools: Record<string, Tool>
  loaded: LoadedTool[]
  missingHandlers: string[]
}> {
  const { tenantId, role, supabase, allowlist } = opts

  // Phase 3 T3.2 — fetch the tenant's tier-2 CRM-write enablement
  // config in parallel with the registry query. Used downstream to
  // exclude write tools whose per-handler flag is false. The agent
  // literally never sees a tool the admin has not explicitly
  // enabled — defence-in-depth on top of T3.1's staging table
  // (which by itself only enforces "no write executes without an
  // approval click", not "the write tool was even on the menu").
  //
  // CRM_WRITES_TIER2_GATE env flag controls rollout. Off by default
  // for one release so existing tenants who had writes enabled
  // before T1.1 can be migrated via the operator runbook before
  // the gate slams shut. After the migration: flip to 'on' in
  // production.
  const tier2GateEnabled = process.env.CRM_WRITES_TIER2_GATE === 'on'

  // B3.3: cache the per-tenant registry rows for an hour. Tool
  // definitions change rarely (admin edits ≈ 1/day in production),
  // and the rows themselves carry no per-request data — the per-turn
  // state (interactionId, conversationId, role) is wired through the
  // middleware below, not the row payload. Safe to cache.
  //
  // Tenant cache is invalidated explicitly from any code path that
  // mutates `tool_registry` (see `invalidateTenantCache` callers in
  // tool-management endpoints).
  const [registryRows, tenantRes] = await Promise.all([
    getCachedByTenant<ToolRegistryRow[]>(tenantId, async () => {
      const res = await supabase
        .from('tool_registry')
        .select(
          'slug, display_name, description, available_to_roles, enabled, is_builtin, tool_type, execution_config, citation_config, deprecated_at, deprecation_replacement',
        )
        .eq('tenant_id', tenantId)
        .eq('enabled', true)
        // Skip soft-deprecated rows. The partial index added in
        // migration 012 means this filter costs nothing on rows with
        // `deprecated_at IS NULL`.
        .is('deprecated_at', null)
      if (res.error) {
        // On error, throw so the cache does NOT memoize a bad result.
        // The route's outer catch handles it.
        throw new Error(`tool_registry query failed: ${res.error.message}`)
      }
      return (res.data ?? []) as ToolRegistryRow[]
    }),
    tier2GateEnabled
      ? supabase
          .from('tenants')
          .select('crm_write_config')
          .eq('id', tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as const),
  ]).catch((err) => {
    // Cache loader threw OR the parallel tenant lookup failed. Either
    // way, log and degrade to empty so a registry outage doesn't
    // 500 every agent turn — the route's static-fallback factory
    // takes over below.
    console.warn(
      '[tool-loader] tool_registry load failed:',
      err instanceof Error ? err.message : err,
    )
    return [[] as ToolRegistryRow[], { data: null, error: null } as const] as const
  })
  const data: ToolRegistryRow[] = registryRows

  const tier2Config = decodeTier2Config(
    (tenantRes as { data: { crm_write_config?: unknown } | null }).data
      ?.crm_write_config,
  )
  const tier2GatedSlugs: string[] = []

  const rows = (data ?? []) as ToolRegistryRow[]
  const tools: Record<string, Tool> = {}
  const loaded: LoadedTool[] = []
  const missingHandlers: string[] = []

  const ctx: ToolHandlerContext = {
    tenantId,
    repId: opts.repId,
    userId: opts.userId,
    role: opts.role,
    activeUrn: opts.activeUrn ?? null,
    supabase: opts.supabase,
    conversationId: opts.conversationId ?? null,
    interactionId: opts.interactionId ?? null,
  }

  for (const row of rows) {
    if (!row.available_to_roles || row.available_to_roles.length === 0) {
      // An empty allowlist means "everyone" — matches the spirit of the
      // current seed where some tools are tenant-wide.
    } else if (!row.available_to_roles.includes(role)) {
      continue
    }

    if (allowlist && !allowlist.includes(row.slug)) continue

    // Phase 3 T3.2 — tier-2 enablement gate. Excludes a write tool
    // entirely from the agent's available set when the per-handler
    // flag in `tenants.crm_write_config` is false. Defence-in-depth
    // on top of T3.1's staging table:
    //   - Without this gate: agent sees the tool, stages a write,
    //     surfaces a [DO] chip; rep clicks it; T3.1's executor
    //     fires the HubSpot call. Safe but the tool is "always on".
    //   - With this gate: agent never sees the tool until the admin
    //     explicitly toggles it ON. Procurement-friendly default.
    //
    // Skipped entirely when CRM_WRITES_TIER2_GATE is off (rollout
    // staging — see env-var note above).
    if (
      tier2GateEnabled &&
      TIER2_WRITE_TOOL_SLUGS.includes(row.slug) &&
      !isCrmWriteEnabled(row.slug, tier2Config)
    ) {
      tier2GatedSlugs.push(row.slug)
      continue
    }

    const handlerSlug = row.execution_config?.handler ?? row.slug
    const handler = HANDLERS.get(handlerSlug)
    if (!handler) {
      missingHandlers.push(row.slug)
      continue
    }

    const execute = handler.build(ctx)

    // Wrap the execute with the middleware chain. Every tool sees the same
    // pre/post hooks so cross-cutting concerns (citations, telemetry,
    // write-approval, connector freshness) are enforced declaratively.
    const mwCtx: ToolMiddlewareCtx = {
      slug: row.slug,
      tenantId,
      repId: opts.repId,
      userId: opts.userId,
      role: opts.role,
      activeUrn: opts.activeUrn ?? null,
      supabase,
      registryRow: row,
      interactionId: opts.interactionId ?? null,
    }
    const chain = opts.middleware ?? DEFAULT_MIDDLEWARE
    const wrapped = withMiddleware(
      (args) => execute(args as z.infer<typeof handler.schema>),
      mwCtx,
      chain,
    )

    const aiTool = tool({
      description: row.description,
      parameters: handler.schema,
      execute: async (args) => {
        try {
          return ((await wrapped(args)) ?? {}) as Record<string, unknown>
        } catch (err) {
          return {
            error:
              err instanceof Error ? err.message : 'tool_execution_failed',
          }
        }
      },
    })

    tools[row.slug] = aiTool
    loaded.push({
      slug: row.slug,
      tool: aiTool,
      description: row.description,
      available_to_roles: row.available_to_roles,
    })
  }

  if (missingHandlers.length > 0) {
    console.warn(
      '[tool-loader] registry rows without registered handlers:',
      missingHandlers.join(', '),
    )
    // Fire-and-forget telemetry so partial degradation surfaces in
    // /admin/adaptation and the nightly self-improve workflow's failure
    // clusters. Without this event, an agent silently running with half
    // its configured toolset is invisible to ops. See AgentEventType
    // definition in `packages/core/src/telemetry/events.ts`.
    void emitAgentEvent(supabase, {
      tenant_id: tenantId,
      user_id: opts.userId,
      role: opts.role,
      interaction_id: opts.interactionId ?? null,
      event_type: 'tool_registry_drift',
      payload: {
        missing_handlers: missingHandlers,
        role: opts.role,
        loaded_count: loaded.length,
        registry_count: rows.length,
      },
    })
  }

  return { tools, loaded, missingHandlers }
}
