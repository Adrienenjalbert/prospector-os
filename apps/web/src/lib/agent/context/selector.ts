import type {
  ContextSelectorInput,
  ContextSlice,
  IntentClass,
  ScoredSlice,
  SelectorResult,
  StageBucket,
  TenantContextOverrides,
} from './types'
import { SLICES, STRATEGY_BUNDLES } from './slices'

/**
 * Selector — pure scoring + budgeted greedy selection.
 *
 * Three responsibilities:
 *   1. Score every slice against the input (intent, role, object, stage,
 *      stalled flag, signals, tenant overrides).
 *   2. Apply tenant overrides (deny/allow/pinned) deterministically.
 *   3. Greedy fill until token budget exhausted, with two invariants:
 *        - Active-object slices that score positively are force-included
 *          (the agent will mostly cite this URN).
 *        - Pinned slices are always included even if budget is tight.
 *
 * Heuristics are additive and legible — Phase 3's bandit replaces the
 * weights without changing the call sites.
 */

// ---------------------------------------------------------------------------
// Stage normalisation
// ---------------------------------------------------------------------------

/**
 * Map raw CRM stage string to a coarse bucket. CRMs disagree wildly on
 * naming so we substring-match on common patterns. First match wins; put
 * the more specific patterns first.
 */
export function stageBucketFromString(
  stage: string | null | undefined,
): StageBucket {
  if (!stage) return 'other'
  const s = stage.toLowerCase()
  if (/(closed[-_ ]?won|signed|commit)/.test(s)) return 'closing'
  if (/(negot|red[-_ ]?line|legal|procure)/.test(s)) return 'negotiation'
  if (/(propos|quote|offer|contract)/.test(s)) return 'proposal'
  if (/(qualif|sql|mql|eval|demo)/.test(s)) return 'qualification'
  if (/(discov|intro|new|exploration|prospect)/.test(s)) return 'discovery'
  return 'other'
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score one slice against the input. Returns score and a reasons[] array
 * for telemetry / admin debugging — useful when a tenant asks "why didn't
 * the agent load slice X today?".
 */
function scoreOne(
  slice: ContextSlice<unknown>,
  input: ContextSelectorInput,
): ScoredSlice {
  const reasons: string[] = []
  let score = 0
  const t = slice.triggers

  // Always-on slices get a strong baseline so they survive budget trimming.
  if (t.always) {
    score += 10
    reasons.push('always:+10')
  }

  if (t.intents?.includes(input.intentClass)) {
    score += 4
    reasons.push(`intent=${input.intentClass}:+4`)
  }

  if (t.roles?.includes(input.role)) {
    score += 3
    reasons.push(`role=${input.role}:+3`)
  }

  if (t.objects?.includes(input.activeObject)) {
    score += 5
    reasons.push(`object=${input.activeObject}:+5`)
  }

  if (t.stages?.includes(input.dealStage)) {
    score += 2
    reasons.push(`stage=${input.dealStage}:+2`)
  }

  if (t.whenStalled && input.isStalled) {
    score += 3
    reasons.push('stalled:+3')
  }

  // Signal-type substring match — capped to +4 to avoid runaway when a
  // company has many signals of the same matching family.
  if (t.signalTypes?.length && input.signalTypes.length > 0) {
    const matches = input.signalTypes.filter((sig) =>
      t.signalTypes!.some((needle) => sig.toLowerCase().includes(needle.toLowerCase())),
    )
    if (matches.length > 0) {
      const bump = Math.min(matches.length * 2, 4)
      score += bump
      reasons.push(`signals[${matches.length}]:+${bump}`)
    }
  }

  // Tenant overrides — applied after the natural score.
  const o = input.tenant_overrides
  if (o) {
    if (o.deny?.includes(slice.slug)) {
      // Hard deny: surface as -Infinity so deterministic sort puts it last.
      reasons.push('tenant-deny:-INF')
      return { slug: slice.slug, score: Number.NEGATIVE_INFINITY, reasons }
    }
    if (o.pinned?.includes(slice.slug)) {
      score += 20
      reasons.push('tenant-pinned:+20')
    }
    if (o.allow?.includes(slice.slug)) {
      score += 1
      reasons.push('tenant-allow:+1')
    }
  }

  return { slug: slice.slug, score, reasons }
}

export function scoreSlices(input: ContextSelectorInput): ScoredSlice[] {
  return Object.values(SLICES)
    .map((slice) => scoreOne(slice, input))
    .sort((a, b) => b.score - a.score)
}

// ---------------------------------------------------------------------------
// Selection (budgeted greedy + invariants)
// ---------------------------------------------------------------------------

/**
 * Pick the slices for this turn. Honours:
 *   - Active-object affinity: any slice with a matching `objects` trigger
 *     and positive score is force-included.
 *   - Pinned slices: always included.
 *   - Budget cap: greedy-fill remaining slots by score, summing each
 *     slice's `token_budget`.
 *   - Score floor: drops anything ≤ 0 (no positive evidence to load it).
 */
export function selectSlices(input: ContextSelectorInput): SelectorResult {
  const scored = scoreSlices(input)
  const budget = input.tenant_overrides?.token_budget ?? input.token_budget
  const pinned = new Set(input.tenant_overrides?.pinned ?? [])

  const chosen: string[] = []
  let used = 0

  // Pass 1: force-include pinned + active-object matches.
  for (const s of scored) {
    if (s.score === Number.NEGATIVE_INFINITY) continue
    const slice = SLICES[s.slug]
    if (!slice) continue
    const isPinned = pinned.has(s.slug)
    const isActiveObjectMatch =
      input.activeObject !== 'none' && slice.triggers.objects?.includes(input.activeObject)
    if ((isPinned || isActiveObjectMatch) && s.score > 0) {
      chosen.push(s.slug)
      used += slice.token_budget
    }
  }

  // Pass 2: greedy fill by score until budget exhausted.
  for (const s of scored) {
    if (s.score <= 0) continue
    if (chosen.includes(s.slug)) continue
    const slice = SLICES[s.slug]
    if (!slice) continue
    if (used + slice.token_budget > budget) continue
    chosen.push(s.slug)
    used += slice.token_budget
  }

  return { slugs: chosen, budget_used: used, scored }
}

// ---------------------------------------------------------------------------
// Tenant-override resolution from business_profiles.role_definitions
// ---------------------------------------------------------------------------

interface RoleDefinitionLike {
  slug?: string
  context_strategy?: string
  /** Phase 2 extensions; tolerated when present, ignored when absent. */
  context_slices_allow?: string[]
  context_slices_deny?: string[]
  context_slices_pinned?: string[]
  context_token_budget?: number
}

/**
 * Resolve tenant overrides for the given role from the JSONB
 * `role_definitions` array on `business_profiles`.
 *
 * This is the single function that finally honours the
 * `business_profiles.role_definitions[].context_strategy` field that
 * has been seeded since day one but never read at runtime.
 */
export function resolveTenantOverrides(
  roleDefinitions: unknown,
  role: string,
): TenantContextOverrides | undefined {
  if (!Array.isArray(roleDefinitions)) return undefined
  const def = roleDefinitions.find(
    (r): r is RoleDefinitionLike =>
      typeof r === 'object' && r !== null && (r as RoleDefinitionLike).slug === role,
  )
  if (!def) return undefined

  const strategy = isStrategy(def.context_strategy) ? def.context_strategy : undefined
  const fromStrategy = strategy ? STRATEGY_BUNDLES[strategy] : undefined

  // Combine: explicit allow takes precedence; otherwise the strategy bundle
  // becomes the soft allow-list (gentle nudge, not a strict whitelist).
  const allow = def.context_slices_allow ?? fromStrategy

  return {
    strategy,
    allow,
    deny: def.context_slices_deny,
    pinned: def.context_slices_pinned,
    token_budget: typeof def.context_token_budget === 'number'
      ? def.context_token_budget
      : undefined,
  }
}

function isStrategy(
  v: unknown,
): v is 'rep_centric' | 'account_centric' | 'portfolio_centric' | 'team_centric' {
  return (
    v === 'rep_centric' ||
    v === 'account_centric' ||
    v === 'portfolio_centric' ||
    v === 'team_centric'
  )
}

// ---------------------------------------------------------------------------
// Convenience constructors
// ---------------------------------------------------------------------------

/**
 * Default selector input when called with sensible fall-backs. Keeps the
 * agent route's call site short.
 */
export function buildSelectorInput(opts: {
  role: ContextSelectorInput['role']
  activeObject: ContextSelectorInput['activeObject']
  activeUrn: string | null
  intentClass: IntentClass
  dealStage?: string | null
  isStalled?: boolean
  signalTypes?: string[]
  tokenBudget?: number
  tenantOverrides?: TenantContextOverrides
}): ContextSelectorInput {
  return {
    role: opts.role,
    activeObject: opts.activeObject,
    activeUrn: opts.activeUrn,
    dealStage: stageBucketFromString(opts.dealStage),
    isStalled: opts.isStalled ?? false,
    signalTypes: opts.signalTypes ?? [],
    intentClass: opts.intentClass,
    token_budget: opts.tokenBudget ?? 2000,
    tenant_overrides: opts.tenantOverrides,
  }
}
