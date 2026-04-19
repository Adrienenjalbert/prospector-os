import type { SupabaseClient } from '@supabase/supabase-js'
import { emitAgentEvent } from '@prospector/core'

import type { ToolRegistryRow } from '../tool-loader'

/**
 * Tool middleware layer (Phase 4 — Archon-inspired PreToolUse/PostToolUse).
 *
 * Every tool execute() call passes through a chain of middlewares so that
 * cross-cutting concerns (citations, telemetry, write-approval gates,
 * credential freshness) are declarative rather than scattered across
 * handlers.
 *
 * Four built-in middlewares ship with the runtime:
 *   - citationEnforcer   (post) MISSION "cite or shut up" at the source
 *   - writeApprovalGate  (pre)  MISSION "no auto-action without approval"
 *   - connectorFreshness (pre)  clean error when HubSpot/Apollo creds expired
 *   - telemetryEmitter   (post) uniform tool_called events for bandit+ROI
 *
 * Middlewares are cheap by construction — any I/O they do is additive to
 * the tool's own cost and must not exceed 50ms P95 (see PROCESS latency
 * budget). If you catch yourself adding a middleware that hits the DB on
 * every call, you probably want a workflow instead.
 */

export interface ToolMiddlewareCtx {
  slug: string
  tenantId: string
  repId: string
  userId: string
  role: string
  activeUrn: string | null
  supabase: SupabaseClient
  /** The registry row for this tool — lets middlewares read citation_config, execution_config, etc. */
  registryRow: ToolRegistryRow
  /** Interaction id that the agent route assigns per user turn. */
  interactionId: string | null
}

export interface PreToolUseResult {
  /** When false, the tool is NOT invoked. The agent sees `result` as the tool output. */
  allow: boolean
  /** Reason logged + surfaced to the agent when denied. */
  reason?: string
  /** Optional override args — if returned, the tool runs with these instead of the original args. */
  updatedArgs?: unknown
  /**
   * When allow=false, the structured payload the agent will see as the
   * tool result. Should be a shape the agent can reason about (e.g.
   * { awaiting_approval: true, action: '...' }).
   */
  result?: unknown
  /** Additional system-visible context the agent should be reminded of. */
  additionalContext?: string
}

export interface PostToolUseResult {
  /** The (possibly wrapped) tool result the agent will see. */
  result: unknown
  /** Soft warnings for observability — never block the call. */
  warnings?: string[]
}

export interface ToolMiddleware {
  name: string
  /**
   * Runs BEFORE the tool executes. Can deny, modify args, or inject
   * context. Middlewares chain in declaration order; the first one that
   * returns allow=false short-circuits the rest.
   */
  preToolUse?: (
    ctx: ToolMiddlewareCtx,
    args: unknown,
  ) => Promise<PreToolUseResult> | PreToolUseResult
  /**
   * Runs AFTER the tool executes (only when every pre-middleware allowed).
   * Can wrap or annotate the result. Middlewares chain in declaration
   * order — each sees the result of the previous one.
   */
  postToolUse?: (
    ctx: ToolMiddlewareCtx,
    args: unknown,
    result: unknown,
  ) => Promise<PostToolUseResult> | PostToolUseResult
}

// ---------------------------------------------------------------------------
// Built-in middleware 1: citationEnforcer
// Validates that tools shaped `{ data, citations }` return a non-empty
// citations array when they queried real CRM/Tableau/transcript data. Emits
// a `citation_missing` event on violation so the learning loop can catch
// regressions and warns the agent via additional context so the next
// response can self-correct.
// ---------------------------------------------------------------------------

/**
 * Tools that are allowed to return zero citations (e.g. pure draft tools
 * whose source object is provided by the rep at the prompt). Keep this
 * set as small as possible — the cite-or-shut-up rule is the strongest
 * trust gate we have, and exemptions erode it.
 *
 * Note: onboarding tools (explore_crm_fields, propose_*, apply_*) used
 * to be exempt because they "weren't user-facing claims." That was wrong
 * — they return tenant-derived analytics. They now cite their data
 * source via `addOnboardingSource` in citations.ts, so they have been
 * removed from this list and are subject to the enforcer like everyone
 * else.
 */
const NO_CITATION_REQUIRED = new Set<string>([
  'draft_outreach',
  'draft_meeting_brief',
  'suggest_next_action',
])

export const citationEnforcer: ToolMiddleware = {
  name: 'citationEnforcer',
  async postToolUse(ctx, _args, result) {
    const warnings: string[] = []
    if (NO_CITATION_REQUIRED.has(ctx.slug)) return { result, warnings }

    // Only enforce on { data, citations } shaped returns — other shapes
    // (booleans, strings, counts) are tool-specific and opt out by default.
    if (
      !result ||
      typeof result !== 'object' ||
      !('data' in result) ||
      !('citations' in result)
    ) {
      return { result, warnings }
    }

    const citations = (result as { citations: unknown }).citations
    const hasAny = Array.isArray(citations) && citations.length > 0
    if (hasAny) return { result, warnings }

    warnings.push(`${ctx.slug} returned { data, citations } with no citations`)

    // Event-source the violation. The learning loop (exemplarMiner,
    // evalGrowth) picks it up and auto-promotes into a failing eval case.
    if (ctx.interactionId && ctx.tenantId) {
      try {
        await emitAgentEvent(ctx.supabase, {
          tenant_id: ctx.tenantId,
          interaction_id: ctx.interactionId,
          user_id: ctx.userId,
          role: ctx.role,
          event_type: 'citation_missing',
          subject_urn: ctx.activeUrn,
          payload: { slug: ctx.slug },
        })
      } catch (err) {
        console.warn('[citationEnforcer] emit failed:', err)
      }
    }

    // Annotate the result so the agent sees the violation inline and can
    // avoid building on an uncited data point. Preserves the original
    // shape so tools/handlers downstream don't break.
    return {
      result: {
        ...(result as Record<string, unknown>),
        __warning: `Tool ${ctx.slug} produced data without citations. Do not cite specific numbers from this result — call a different tool or state the limitation.`,
      },
      warnings,
    }
  },
}

// ---------------------------------------------------------------------------
// Built-in middleware 2: writeApprovalGate (FAIL-CLOSED, Phase 3 T1.1)
// ---------------------------------------------------------------------------
//
// Blocks tools declared as CRM mutators (tool_registry row has
// execution_config.mutates_crm = true) from running, FULL STOP. The
// previous version of this middleware accepted any non-empty
// `approval_token` string as a valid approval, with the comment "real
// tokens are validated at the handler level against a short-lived nonce
// table in Phase 4.1". That nonce table never shipped, no handler ever
// validated the token, so a hallucinating or adversarial model could
// pass `approval_token: "ok"` and bypass the entire human-in-the-loop
// guarantee promised in MISSION.md "What we explicitly do not do" #3 and
// in the agent behaviour rules in `_shared.ts`. (See audit area C, P0.)
//
// FIX (T1.1): the gate now denies write tools unconditionally and
// returns the `awaiting_approval` shape so the agent surfaces a `[DO]`
// chip the user can read but cannot execute. CRM write-back is also
// disabled at the data layer via `scripts/disable-crm-writes.ts` so
// this gate is defence-in-depth for any tool_registry row that gets
// re-enabled by mistake.
//
// REMOVAL (T3.1): when the `pending_crm_writes` staging table ships,
// this middleware is deleted. The new flow stages the proposed write
// into a row, the user clicks `[DO]`, the UI POSTs to
// `/api/agent/approve`, and that endpoint executes the HubSpot call
// directly. The model never executes the write, no token is involved,
// no gate is needed.
//
// Until then: every write tool call is a no-op that produces a
// human-readable summary the rep can act on manually.

function isWriteTool(row: ToolRegistryRow): boolean {
  const cfg = row.execution_config as Record<string, unknown> | null
  return Boolean(cfg?.mutates_crm) || Boolean(cfg?.is_write)
}

export const writeApprovalGate: ToolMiddleware = {
  name: 'writeApprovalGate',
  async preToolUse(ctx, args) {
    if (!isWriteTool(ctx.registryRow)) return { allow: true }

    // No `approval_token` early-allow path. The token check was a
    // type-only gate (any non-empty string passed) and the nonce
    // table that was supposed to validate it was never built.
    // Until T3.1 ships the staging table, EVERY write tool call is
    // denied — the agent surfaces the proposed args as a `[DO]` chip
    // for the rep to act on manually.
    return {
      allow: false,
      reason: 'write_temporarily_disabled',
      result: {
        awaiting_approval: true,
        tool: ctx.slug,
        proposed_args: args,
        // The agent should surface this as a `[DO]` chip. The
        // SuggestedActions parser in `commonBehaviourRules`
        // understands the shape. Today the chip is informational
        // only — clicking it surfaces the proposed write but does
        // not execute (the executor staging table lands in T3.1).
        next_action: `Surface the proposed ${ctx.slug} call to the user as a [DO] chip. CRM write-back is temporarily disabled platform-wide; the rep must perform the action in the CRM directly until the approval-staging system ships.`,
      },
      additionalContext: `Tool ${ctx.slug} would mutate CRM state. CRM write-back is temporarily DISABLED platform-wide because the previous approval gate had a string-equality bypass (see docs/review/01-audit.md area C). Phase 3 T3.1 ships a real staging table; until then the agent recommends the action and the rep performs it manually. Do NOT attempt to bypass with a fabricated approval_token — none is accepted.`,
    }
  },
}

// ---------------------------------------------------------------------------
// Built-in middleware 3: connectorFreshness
// Tools that depend on a connector (`execution_config.requires_connector_id`)
// must have valid credentials. We check the `connector_registry` row's
// `credentials_expires_at` column (when present) and fail fast with a clean
// error that the agent can surface. Avoids tools burning retries on a
// 401 they can't fix.
// ---------------------------------------------------------------------------

export const connectorFreshness: ToolMiddleware = {
  name: 'connectorFreshness',
  async preToolUse(ctx) {
    const cfg = ctx.registryRow.execution_config as Record<string, unknown> | null
    const connectorId = cfg?.requires_connector_id
    if (!connectorId || typeof connectorId !== 'string') return { allow: true }

    try {
      const { data: connector } = await ctx.supabase
        .from('connector_registry')
        .select('id, credentials_expires_at, enabled')
        .eq('id', connectorId)
        .eq('tenant_id', ctx.tenantId)
        .maybeSingle()

      if (!connector) {
        return {
          allow: false,
          reason: 'connector_not_found',
          result: {
            error: `Tool ${ctx.slug} depends on connector ${connectorId} but it isn't registered for this tenant.`,
          },
        }
      }
      if (connector.enabled === false) {
        return {
          allow: false,
          reason: 'connector_disabled',
          result: { error: `Connector ${connectorId} is disabled for this tenant.` },
        }
      }

      const expiresAt = connector.credentials_expires_at
        ? new Date(connector.credentials_expires_at).getTime()
        : null
      if (expiresAt !== null && expiresAt < Date.now()) {
        return {
          allow: false,
          reason: 'connector_credentials_expired',
          result: {
            error: `Credentials for connector ${connectorId} expired at ${connector.credentials_expires_at}. Reconnect via /onboarding to refresh.`,
          },
        }
      }
    } catch (err) {
      // Never block a tool because freshness check itself failed — log and
      // allow the tool's own error handling to produce a classified error.
      console.warn('[connectorFreshness] check failed:', err)
    }

    return { allow: true }
  },
}

// ---------------------------------------------------------------------------
// Built-in middleware 4: telemetryEmitter
// Emits `tool_called` agent event on every successful invocation with
// duration + result shape hints. The bandit + attribution workflows read
// these events; without them the learning loop has no signal.
// ---------------------------------------------------------------------------

const STARTED_AT = new WeakMap<object, number>()

export const telemetryEmitter: ToolMiddleware = {
  name: 'telemetryEmitter',
  async preToolUse(_ctx, args) {
    // Stash a start timestamp keyed by the args object (cheap weakref).
    if (args && typeof args === 'object') STARTED_AT.set(args, Date.now())
    return { allow: true }
  },
  async postToolUse(ctx, args, result) {
    const startedAt =
      args && typeof args === 'object' ? STARTED_AT.get(args) : undefined
    const durationMs = startedAt ? Date.now() - startedAt : null

    // Heuristic citation count extraction for the event payload. The bandit
    // doesn't need precision — only the order-of-magnitude signal.
    let citationCount: number | null = null
    if (result && typeof result === 'object' && 'citations' in result) {
      const c = (result as { citations: unknown }).citations
      if (Array.isArray(c)) citationCount = c.length
    }

    if (ctx.tenantId && ctx.interactionId) {
      try {
        await emitAgentEvent(ctx.supabase, {
          tenant_id: ctx.tenantId,
          interaction_id: ctx.interactionId,
          user_id: ctx.userId,
          role: ctx.role,
          event_type: 'tool_called',
          subject_urn: ctx.activeUrn,
          payload: {
            slug: ctx.slug,
            duration_ms: durationMs,
            citation_count: citationCount,
            has_error:
              Boolean(
                result &&
                  typeof result === 'object' &&
                  'error' in result &&
                  (result as { error: unknown }).error,
              ) || false,
          },
        })
      } catch (err) {
        console.warn('[telemetryEmitter] emit failed:', err)
      }
    }
    return { result }
  },
}

// ---------------------------------------------------------------------------
// Built-in middleware 5: resultSizeGuard
// Caps the size of any list-shaped tool result so the model isn't drowned
// by a tool that legitimately returned 500 rows but only needs the top 20
// for the answer.
//
// Why declare a framework-level cap rather than per-tool?
//   - Every tool author would otherwise have to remember to cap. They don't.
//     `find_contacts` returned up to 25 contacts; `search_transcripts`
//     used to return 50; `team_patterns` 100+ rows in some tenants.
//   - With this in place, ANY new tool that ships a `results` / `rows` /
//     top-level array exceeding the cap is auto-truncated and tagged
//     with a warning the agent can quote ("showing first 20 of 250").
//   - The agent_events bandit reads `payload.row_count` to learn that
//     bigger isn't better — long lists tend to negatively correlate with
//     thumbs-up.
//
// The cap is intentionally conservative (50). Tools that legitimately need
// more (e.g. `analyze_account_distribution` returning bucket counts)
// should declare a non-array shape so the cap doesn't apply.
// ---------------------------------------------------------------------------

const RESULT_ROW_CAP = 50

function findArrayField(
  obj: Record<string, unknown>,
): { key: string; arr: unknown[] } | null {
  // Common conventions across our tool corpus, in priority order.
  const candidates = [
    'rows', 'results', 'contacts', 'deals', 'opportunities', 'signals',
    'companies', 'accounts', 'transcripts', 'items',
  ]
  for (const key of candidates) {
    const value = obj[key]
    if (Array.isArray(value)) return { key, arr: value }
  }
  return null
}

export const resultSizeGuard: ToolMiddleware = {
  name: 'resultSizeGuard',
  async postToolUse(_ctx, _args, result) {
    if (!result || typeof result !== 'object') return { result }
    const obj = result as Record<string, unknown>
    const found = findArrayField(obj)
    if (!found) return { result }
    if (found.arr.length <= RESULT_ROW_CAP) return { result }

    // Truncate + add a warning the agent can quote so the rep knows
    // there's more available. The original count is preserved in
    // `_truncated_from` for telemetry / debugging.
    const truncated = found.arr.slice(0, RESULT_ROW_CAP)
    const next: Record<string, unknown> = {
      ...obj,
      [found.key]: truncated,
      _truncated_from: found.arr.length,
      _truncation_warning: `Returned the first ${RESULT_ROW_CAP} of ${found.arr.length} ${found.key}; tell the rep there's more if it matters.`,
    }
    return {
      result: next,
      warnings: [`tool result truncated: ${found.key} ${found.arr.length} -> ${RESULT_ROW_CAP}`],
    }
  },
}

// ---------------------------------------------------------------------------
// Chain composition
// ---------------------------------------------------------------------------

/**
 * Default middleware chain applied by the loader. Order matters:
 *
 *   preToolUse:
 *     1. telemetryEmitter (stash start time)
 *     2. connectorFreshness (fail fast on expired creds)
 *     3. writeApprovalGate (block writes without approval)
 *
 *   postToolUse (reverse of pre for symmetry):
 *     1. resultSizeGuard (truncate large arrays before downstream sees them)
 *     2. citationEnforcer (annotate missing citations)
 *     3. telemetryEmitter (emit tool_called event)
 *
 * `resultSizeGuard` runs FIRST in post so the citation enforcer + telemetry
 * see the truncated row count, not the original — otherwise the bandit
 * would credit/punish based on the un-truncated payload.
 */
export const DEFAULT_MIDDLEWARE: ToolMiddleware[] = [
  telemetryEmitter,
  connectorFreshness,
  writeApprovalGate,
  resultSizeGuard,
  citationEnforcer,
]

/**
 * Compose a chain of middlewares around a bare execute function. Returns a
 * wrapped function that honours deny short-circuits and post-wrap results.
 */
export function withMiddleware(
  execute: (args: unknown) => Promise<unknown>,
  ctx: ToolMiddlewareCtx,
  chain: ToolMiddleware[] = DEFAULT_MIDDLEWARE,
): (args: unknown) => Promise<unknown> {
  return async (args: unknown) => {
    let effectiveArgs = args
    const additionalContexts: string[] = []

    // Pre chain — in order.
    for (const mw of chain) {
      if (!mw.preToolUse) continue
      const decision = await mw.preToolUse(ctx, effectiveArgs)
      if (!decision.allow) {
        if (decision.additionalContext) additionalContexts.push(decision.additionalContext)
        const payload = (decision.result ?? {
          error: decision.reason ?? 'tool_denied',
        }) as Record<string, unknown>
        // Merge any additional context so the agent can see why it was denied.
        if (additionalContexts.length > 0) {
          payload.__context = additionalContexts.join(' ')
        }
        return payload
      }
      if (decision.updatedArgs !== undefined) effectiveArgs = decision.updatedArgs
      if (decision.additionalContext) additionalContexts.push(decision.additionalContext)
    }

    // Execute the underlying tool.
    let result: unknown
    try {
      result = await execute(effectiveArgs)
    } catch (err) {
      // Re-throw — the loader already wraps errors into `{ error }` for the
      // agent, and classification happens in the runtime (Phase 2).
      throw err
    }

    // Post chain — in order. Each sees the previous result.
    for (const mw of chain) {
      if (!mw.postToolUse) continue
      const out = await mw.postToolUse(ctx, effectiveArgs, result)
      result = out.result
    }

    return result
  }
}
