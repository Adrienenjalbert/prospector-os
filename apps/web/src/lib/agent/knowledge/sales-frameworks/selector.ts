import type { AgentContext } from '@prospector/core'
import type { FrameworkDoc } from './types'
import { FRAMEWORKS } from './frameworks'

/**
 * The selector decides which 2-3 frameworks the agent should default to
 * *this turn*. It is pure: no IO, no state, trivially unit-testable.
 *
 * Design intent:
 * - The selector only *ranks*. It never vetoes. The agent can still call
 *   `consult_sales_framework` on any slug the user explicitly asks about
 *   (e.g. "pull the MEDDPICC scoring questions for me"). The selector's
 *   job is to avoid the agent picking blind when the user asks an open-
 *   ended question.
 * - We keep the scoring heuristics legible (plain boolean predicates +
 *   additive scores) so the learning layer can later replace them with a
 *   per-tenant bandit without touching the call sites.
 */

export interface SelectorInput {
  /** Active ontology object the user is viewing, if any. */
  activeObject?: 'company' | 'deal' | 'signal' | 'contact' | null
  /** Current deal stage (from `opportunities.stage`) when a deal is active. */
  dealStage?: string | null
  /** True when the deal is flagged stalled by the benchmark comparison. */
  isStalled?: boolean | null
  /** Signal types currently active on the relevant object. */
  signalTypes?: string[]
  /**
   * User's role slug. Maps onto `business_profiles.role_definitions.slug`.
   * Unknown roles are treated as "rep".
   */
  role?: string | null
}

/**
 * Normalise a `dealStage` string to a coarse bucket. CRMs disagree on names
 * ('Discovery' vs 'Qualification' vs 'SQL' etc.), so we match on substring.
 *
 * Ordered checks — first match wins, so put the more specific patterns
 * first.
 */
function stageBucket(
  stage: string | null | undefined,
): 'discovery' | 'qualification' | 'proposal' | 'negotiation' | 'closing' | 'other' {
  if (!stage) return 'other'
  const s = stage.toLowerCase()
  if (/(closed[-_ ]?won|signed|commit)/.test(s)) return 'closing'
  if (/(negot|red[-_ ]?line|legal|procure)/.test(s)) return 'negotiation'
  if (/(propos|quote|offer|contract)/.test(s)) return 'proposal'
  if (/(qualif|sql|mql|eval|demo)/.test(s)) return 'qualification'
  if (/(discov|intro|new|exploration|prospect)/.test(s)) return 'discovery'
  return 'other'
}

function hasSignal(types: string[] | undefined, patterns: string[]): boolean {
  if (!types?.length) return false
  return types.some((t) =>
    patterns.some((p) => t.toLowerCase().includes(p.toLowerCase())),
  )
}

type Scored = { slug: string; score: number }

/**
 * Score every framework against the context. Returns ordered slugs by
 * descending score. The top 3 are spliced into the always-on playbook
 * preamble.
 *
 * Heuristics are additive — a framework can accumulate points from role,
 * object, stage, stalled flag, and signal types independently.
 */
export function scoreFrameworks(input: SelectorInput): Scored[] {
  const bucket = stageBucket(input.dealStage)
  const signals = input.signalTypes ?? []
  const role = (input.role ?? 'rep').toLowerCase()

  const scored: Scored[] = FRAMEWORKS.map((f) => ({
    slug: f.slug,
    score: scoreOne(f, input, bucket, signals, role),
  }))

  return scored.sort((a, b) => b.score - a.score)
}

function scoreOne(
  f: FrameworkDoc,
  input: SelectorInput,
  bucket: ReturnType<typeof stageBucket>,
  signals: string[],
  role: string,
): number {
  let score = 0

  // --- Stage bucket matches (strong signal). ---
  if (bucket === 'discovery' && f.stages.some((s) => s === 'discovery' || s === 'problem_validation')) {
    score += 3
  }
  if (bucket === 'qualification' && f.stages.includes('qualification')) {
    score += 3
  }
  if (bucket === 'proposal' && f.stages.includes('proposal')) {
    score += 3
  }
  if (bucket === 'negotiation' && f.stages.includes('negotiation')) {
    score += 3
  }
  if (bucket === 'closing' && f.stages.includes('closing')) {
    score += 3
  }

  // --- Stalled-deal lift (JOLT, objection-handling, sandler, pain-funnel). ---
  if (input.isStalled) {
    if (['jolt', 'objection-handling', 'sandler', 'pain-funnel'].includes(f.slug)) {
      score += 4
    }
    if (f.best_for.includes('stalled_deal') || f.best_for.includes('indecision')) {
      score += 2
    }
  }

  // --- Active-object affinity. ---
  if (input.activeObject === 'deal' && f.objects.includes('deal')) score += 1
  if (input.activeObject === 'company' && f.objects.includes('company')) score += 1
  if (input.activeObject === 'contact' && f.objects.includes('contact')) score += 1

  // --- Signal-driven picks. ---
  if (hasSignal(signals, ['churn', 'at_risk', 'escalation', 'detractor'])) {
    if (['pain-funnel', 'jolt', 'rain', 'objection-handling'].includes(f.slug)) {
      score += 3
    }
  }
  if (hasSignal(signals, ['contract_renewal', 'funding', 'leadership_change', 'rfp'])) {
    if (['neat-selling', 'meddpicc', 'value-selling'].includes(f.slug)) {
      score += 2
    }
  }
  if (hasSignal(signals, ['intent', 'visit', 'download', 'pricing_page'])) {
    if (['spin', 'snap', 'three-why'].includes(f.slug)) score += 2
  }

  // --- Role nudges. ---
  if (role === 'leader' || role === 'admin') {
    if (['challenger', 'value-selling', 'command-of-message', 'meddpicc'].includes(f.slug)) {
      score += 2
    }
  }
  if (role === 'csm') {
    if (['rain', 'pain-funnel', 'value-selling', 'three-why'].includes(f.slug)) {
      score += 2
    }
  }
  if (role === 'nae') {
    if (['snap', 'spin', 'three-why', 'challenger'].includes(f.slug)) {
      score += 2
    }
  }

  // --- Default fallback (cold, no active object, no signals): universal 3. ---
  if (
    !input.activeObject &&
    bucket === 'other' &&
    signals.length === 0 &&
    !input.isStalled
  ) {
    if (['spin', 'three-why', 'challenger'].includes(f.slug)) score += 1
  }

  return score
}

/**
 * Return the top N framework slugs for the given context. N defaults to 3,
 * which matches the playbook preamble's "pick 2-3" directive. Never returns
 * fewer than 3 — if scoring is entirely flat, we fall back to the
 * universal default triad (SPIN / three-why / Challenger).
 */
export function selectFrameworks(input: SelectorInput, topN = 3): string[] {
  const scored = scoreFrameworks(input)
  const top = scored.slice(0, topN).map((s) => s.slug)

  // Guarantee a non-empty default — an agent prompt with no suggestions is
  // worse than one with sensible defaults.
  if (top.length < topN) {
    const fallback = ['spin', 'three-why', 'challenger'].filter(
      (s) => !top.includes(s),
    )
    return [...top, ...fallback].slice(0, topN)
  }
  return top
}

/**
 * Ergonomic wrapper that builds a SelectorInput from the runtime
 * AgentContext. We pull deal/stall info from `current_deal` when it's set,
 * otherwise from `stalled_deals` / `priority_accounts` heuristically so
 * the agent still gets useful picks on dashboard-level questions.
 */
export function selectForAgentContext(
  ctx: AgentContext | null,
  opts: { role?: string | null; activeUrn?: string | null } = {},
): string[] {
  const activeObject = inferActiveObjectFromUrn(opts.activeUrn) ?? undefined
  const dealStage = ctx?.current_deal?.stage ?? null
  const isStalled =
    ctx?.current_deal?.is_stalled ??
    (ctx?.stalled_deals && ctx.stalled_deals.length > 0 ? true : undefined)
  const signalTypes = (ctx?.recent_signals ?? []).map((s) => s.signal_type)

  return selectFrameworks({
    activeObject,
    dealStage,
    isStalled,
    signalTypes,
    role: opts.role ?? null,
  })
}

function inferActiveObjectFromUrn(
  urn?: string | null,
): 'company' | 'deal' | 'signal' | 'contact' | null {
  if (!urn) return null
  if (urn.includes(':deal:') || urn.includes(':opportunity:')) return 'deal'
  if (urn.includes(':company:')) return 'company'
  if (urn.includes(':contact:')) return 'contact'
  if (urn.includes(':signal:')) return 'signal'
  return null
}
