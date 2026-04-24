import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentContext, PageContext } from '@prospector/core'
import { parseUrn } from '@prospector/core'
import { assembleAgentContext } from './context-builder'
import {
  packContext,
  resolveTenantOverrides,
  type IntentClass,
  type AgentRole,
  type PackedContext,
} from './context'

/**
 * Five context strategies, picked per (role, activeObject) by the agent route:
 *
 *   rep_centric    — rep's book of business (default for AE/NAE)
 *   portfolio      — CSM portfolio view (all accounts they own)
 *   account_deep   — full detail on ONE company
 *   deal_deep      — full detail on ONE opportunity
 *   open_question  — no active object, no rep anchor (Concierge mode)
 *
 * Each strategy returns an AgentContext the prompt builder can consume.
 * The strategy decides *what data to fetch*; the prompt builder decides
 * *how to shape it for the model*.
 */
export type ContextStrategy =
  | 'rep_centric'
  | 'portfolio'
  | 'account_deep'
  | 'deal_deep'
  | 'open_question'

export interface ContextSelection {
  strategy: ContextStrategy
  activeUrn: string | null
  activeCompanyId: string | null
  activeDealId: string | null
}

// ---------------------------------------------------------------------------
// Routing table (Phase 8 — declarative dispatch)
//
// First matching rule wins. Add new (role, active-object) combinations here
// without touching the caller — "add rows, not code". Keep the table small
// and ordered from most-specific to most-general.
// ---------------------------------------------------------------------------

type ActiveObjectType = 'deal' | 'opportunity' | 'company' | 'other' | 'none'

interface RoutingRule {
  /** Matcher runs in order. First hit selects the strategy. */
  match: (ctx: { role: string; objectType: ActiveObjectType }) => boolean
  strategy: ContextStrategy
  /** Label used in logs and telemetry for observability. */
  label: string
}

/**
 * The full routing table. Order matters — rules are evaluated top-to-
 * bottom and the first match wins. Active-object rules sit first because
 * "user is looking at this deal" outranks role-default behaviour.
 */
const ROUTING_TABLE: RoutingRule[] = [
  // Active object wins regardless of role.
  {
    label: 'deal_active',
    match: ({ objectType }) => objectType === 'deal' || objectType === 'opportunity',
    strategy: 'deal_deep',
  },
  {
    label: 'company_active',
    match: ({ objectType }) => objectType === 'company',
    strategy: 'account_deep',
  },

  // Role-based defaults when no active object is set.
  {
    label: 'csm_portfolio',
    match: ({ role, objectType }) => objectType === 'none' && role === 'csm',
    strategy: 'portfolio',
  },
  {
    label: 'rep_centric',
    match: ({ role, objectType }) =>
      objectType === 'none' && ['nae', 'ae', 'growth_ae', 'ad', 'rep'].includes(role),
    strategy: 'rep_centric',
  },

  // Catch-all. Concierge answers open questions across the tenant.
  {
    label: 'concierge_open',
    match: () => true,
    strategy: 'open_question',
  },
]

function classifyActiveObject(activeUrn: string | null): {
  objectType: ActiveObjectType
  companyId: string | null
  dealId: string | null
} {
  if (!activeUrn) return { objectType: 'none', companyId: null, dealId: null }
  const parsed = parseUrn(activeUrn)
  if (!parsed) return { objectType: 'none', companyId: null, dealId: null }
  if (parsed.type === 'deal' || parsed.type === 'opportunity') {
    return { objectType: parsed.type, companyId: null, dealId: parsed.id }
  }
  if (parsed.type === 'company') {
    return { objectType: 'company', companyId: parsed.id, dealId: null }
  }
  return { objectType: 'other', companyId: null, dealId: null }
}

/**
 * Determine the strategy from (role, activeUrn) via the routing table.
 * Falls back gracefully to `open_question` when no rule matches.
 */
export function pickContextStrategy(opts: {
  role: string
  activeUrn?: string | null
}): ContextSelection {
  const activeUrn = opts.activeUrn ?? null
  const { objectType, companyId, dealId } = classifyActiveObject(activeUrn)

  const rule = ROUTING_TABLE.find((r) => r.match({ role: opts.role, objectType }))!
  const strategy = rule.strategy

  // Null out active-object IDs for non-deep strategies so downstream code
  // can't accidentally depend on a stale reference.
  const shouldCarryActive = strategy === 'deal_deep' || strategy === 'account_deep'

  return {
    strategy,
    activeUrn: shouldCarryActive ? activeUrn : null,
    activeCompanyId: shouldCarryActive ? companyId : null,
    activeDealId: shouldCarryActive ? dealId : null,
  }
}

// Exposed for tests and /admin observability — lets ops see the full
// dispatch matrix without reading TS source.
export function listRoutingRules(): Array<{ label: string; strategy: ContextStrategy }> {
  return ROUTING_TABLE.map((r) => ({ label: r.label, strategy: r.strategy }))
}

/**
 * Main entry: build the agent context for this strategy. Delegates to the
 * existing rep-centric assembler for the known roles, layers on
 * account/deal-specific enrichment for the deep strategies, and degrades to
 * a minimal skeleton for open-question so Concierge-style queries still work.
 */
export async function assembleContextForStrategy(opts: {
  supabase: SupabaseClient
  tenantId: string
  repId: string
  selection: ContextSelection
  pageContext?: PageContext
}): Promise<AgentContext | null> {
  const { tenantId, repId, selection, pageContext } = opts

  // B4.2: skip the rep-wide priority/stalled/signal queries when the
  // packer's per-object slices already cover that ground. For
  // `account_deep` and `deal_deep` strategies the relevant data
  // lives in the active object's slice (current-deal-health,
  // current-company-snapshot, recent-signals scoped to the company),
  // so the rep-wide fan-out queries are pure waste — and they don't
  // even feed the prompt for these strategies.
  //
  // Net per-turn DB-query reduction on deep-strategy turns: 3 fewer
  // (priority_accounts, stalled, signals fan-out).
  const deepSkip: Parameters<typeof assembleAgentContext>[3] = {
    skipPriorityAccounts: true,
    skipStalledDeals: true,
    skipSignals: true,
  }

  switch (selection.strategy) {
    case 'rep_centric':
      return assembleAgentContext(repId, tenantId, pageContext)

    case 'portfolio':
      // CSM portfolio: reuse the rep-centric loader (it already scopes to the
      // rep's accounts) but tag the strategy so the prompt can frame it as
      // "portfolio health" rather than "deals to work".
      return assembleAgentContext(repId, tenantId, pageContext)

    case 'account_deep': {
      // Hand the account id through so the agent has the normal
      // bookend plus the `current_account` anchor; skip the rep-wide
      // queries the packer covers separately.
      const ctx = await assembleAgentContext(
        repId,
        tenantId,
        {
          ...pageContext,
          page: pageContext?.page ?? `/objects/companies/${selection.activeCompanyId}`,
          accountId: selection.activeCompanyId ?? undefined,
        },
        deepSkip,
      )
      return ctx
    }

    case 'deal_deep': {
      const ctx = await assembleAgentContext(
        repId,
        tenantId,
        {
          ...pageContext,
          page: pageContext?.page ?? `/objects/deals/${selection.activeDealId}`,
          dealId: selection.activeDealId ?? undefined,
        },
        deepSkip,
      )
      return ctx
    }

    case 'open_question':
      // No rep anchor: Concierge answers about any object in the tenant.
      // We let the tools do the fetching; context stays minimal to save tokens.
      return null
  }
}

// ---------------------------------------------------------------------------
// Context Pack integration (Phase 1)
//
// `assembleAgentContext` stays as the source of truth for the legacy
// AgentContext shape — every existing prompt builder consumes that.
// `assembleContextPack` runs the new slice-based packer in parallel,
// emitting `context_slice_loaded` telemetry per slice and producing a
// PackedContext the route can splice into the system prompt + harvest
// citations from.
//
// Both run on every turn in Phase 1 — additive only. Phase 2 migrates
// prompt builders onto PackedContext directly and the legacy assembler's
// scope shrinks to just the fields slices don't yet cover.
// ---------------------------------------------------------------------------

export async function assembleContextPack(opts: {
  supabase: SupabaseClient
  tenantId: string
  repId: string
  userId: string
  role: AgentRole
  selection: ContextSelection
  intentClass: IntentClass
  pageContext?: PageContext
  interactionId?: string | null
  crmType: string | null
  /** Token budget for the dynamic context section. Defaults to 2000. */
  tokenBudget?: number
  /**
   * Hint from the route — when known, shortcuts the selector's stalled
   * lookup. Optional: if absent the selector still works but loses the
   * `whenStalled` boost.
   */
  isStalled?: boolean
  /** Same: signal types of the active object. */
  signalTypes?: string[]
  /** Active deal stage (raw CRM string). */
  dealStage?: string | null
  /**
   * Most-recent user message text. Forwarded to SliceLoadCtx so RAG
   * slices (C5.2) can embed the query for similarity retrieval.
   */
  userMessageText?: string | null
}): Promise<PackedContext> {
  // Resolve per-tenant overrides from business_profiles.role_definitions —
  // wires up the previously-dead context_strategy field. This is the single
  // call site that finally makes per-tenant context customisation real.
  const { data: profile } = await opts.supabase
    .from('business_profiles')
    .select('role_definitions')
    .eq('tenant_id', opts.tenantId)
    .maybeSingle()

  const tenantOverrides = profile
    ? resolveTenantOverrides(profile.role_definitions, opts.role)
    : undefined

  return packContext({
    tenantId: opts.tenantId,
    repId: opts.repId,
    userId: opts.userId,
    role: opts.role,
    crmType: opts.crmType,
    activeUrn: opts.selection.activeUrn,
    pageContext: opts.pageContext,
    intentClass: opts.intentClass,
    dealStage: opts.dealStage,
    isStalled: opts.isStalled,
    signalTypes: opts.signalTypes,
    tenantOverrides,
    interactionId: opts.interactionId ?? null,
    tokenBudget: opts.tokenBudget,
    userMessageText: opts.userMessageText ?? null,
    supabase: opts.supabase,
  })
}
