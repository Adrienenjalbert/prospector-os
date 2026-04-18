import type { SupabaseClient } from '@supabase/supabase-js'
import { emitAgentEvent, parseUrn } from '@prospector/core'
import type {
  ActiveObjectType,
  AgentRole,
  ContextSelectorInput,
  IntentClass,
  PackedContext,
  PackedSection,
  PendingCitation,
  ScoredSlice,
  SliceLoadCtx,
  SliceLoadResult,
} from './types'
import { SLICES } from './slices'
import { selectSlices, buildSelectorInput, stageBucketFromString } from './selector'
import { estimateTokens } from './slices/_helpers'
import {
  loadSlicePriors,
  priorKey,
  thompsonAdjustment,
  type SlicePriorsTable,
} from './bandit'

/**
 * Packer — turns a ContextSelectorInput into a PackedContext by:
 *
 *   1. Picking slices via the selector.
 *   2. Hydrating them in parallel with per-slice timeouts (one slow slice
 *      cannot starve the others).
 *   3. Tolerating slice failures (a failure logs + skips, never throws).
 *   4. Ordering sections by lost-in-the-middle convention:
 *        - Active-object slices first (the model anchors on these URNs).
 *        - Other slices in selector-score order (descending).
 *        - Meta slices last in the dynamic block; behaviour rules (which
 *          live in `_shared.commonBehaviourRules`) sit AFTER this packed
 *          output in the system prompt by convention, providing the
 *          "high-attention end" position empirically known to drive
 *          better citation discipline.
 *   5. Emitting `context_slice_loaded` per hydrated slice and
 *      `context_slice_failed` per skipped slice — feeds the bandit + the
 *      Phase-3 attribution workflow.
 *
 * The packer never throws — a failed turn at the context layer would
 * cascade into a failed user response. Instead the worst case is an empty
 * PackedContext with an empty `sections` array, which the prompt builders
 * handle gracefully.
 */

export interface PackContextOptions {
  // Identity
  tenantId: string
  repId: string
  userId: string
  role: AgentRole
  /** Tenant CRM type (for URN deep-link helpers). */
  crmType: string | null

  // Active object
  activeUrn: string | null
  pageContext?: { page: string; accountId?: string; dealId?: string }

  // Intent (already computed by the route)
  intentClass: IntentClass

  // Optional hints for the selector
  dealStage?: string | null
  isStalled?: boolean
  signalTypes?: string[]

  /** Tenant-level overrides resolved from business_profiles.role_definitions. */
  tenantOverrides?: ContextSelectorInput['tenant_overrides']

  // Telemetry context
  interactionId?: string | null

  // Token / latency budgets
  tokenBudget?: number
  latencyBudgetMs?: number

  supabase: SupabaseClient
}

/**
 * Run a load() with a hard timeout. When the timeout fires we resolve to a
 * synthetic `__timeout` failure rather than rejecting, so the packer can
 * surface it cleanly into the failed[] list.
 */
async function withSliceTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise.then((value) => ({ ok: true as const, value })),
      new Promise<{ ok: false; reason: string }>((resolve) => {
        timeoutHandle = setTimeout(
          () => resolve({ ok: false, reason: `slice timed out after ${timeoutMs}ms` }),
          timeoutMs,
        )
      }),
    ])
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

/**
 * Resolve the active object's id from URN + page context. We accept both
 * because Slack inbound and the chat sidebar pass page context, while the
 * action-panel passes URN.
 */
function resolveActive(opts: PackContextOptions): {
  activeObject: ActiveObjectType
  activeCompanyId: string | null
  activeDealId: string | null
} {
  const parsed = opts.activeUrn ? parseUrn(opts.activeUrn) : null
  if (parsed) {
    if (parsed.type === 'company') {
      return { activeObject: 'company', activeCompanyId: parsed.id, activeDealId: null }
    }
    if (parsed.type === 'deal' || parsed.type === 'opportunity') {
      return { activeObject: 'deal', activeCompanyId: null, activeDealId: parsed.id }
    }
    if (parsed.type === 'contact') {
      return { activeObject: 'contact', activeCompanyId: null, activeDealId: null }
    }
    if (parsed.type === 'signal') {
      return { activeObject: 'signal', activeCompanyId: null, activeDealId: null }
    }
  }
  if (opts.pageContext?.dealId) {
    return { activeObject: 'deal', activeCompanyId: null, activeDealId: opts.pageContext.dealId }
  }
  if (opts.pageContext?.accountId) {
    return { activeObject: 'company', activeCompanyId: opts.pageContext.accountId, activeDealId: null }
  }
  return { activeObject: 'none', activeCompanyId: null, activeDealId: null }
}

/**
 * Order packed sections lost-in-the-middle style:
 *   1. Active-object slices (first — high-attention top, the URN the
 *      agent will mostly cite anchors here).
 *   2. Pipeline + account + people + learning slices (middle — selector
 *      score order preserved within).
 *   3. Health + meta slices (end of dynamic block — readable summary +
 *      coverage warnings before behaviour rules).
 */
function orderSections(
  slugs: string[],
  packedBySlug: Map<string, PackedSection>,
  activeObject: ActiveObjectType,
): PackedSection[] {
  const ordered: PackedSection[] = []
  const remaining = new Set(slugs)

  // 1. Active-object slices first.
  if (activeObject !== 'none') {
    for (const slug of slugs) {
      const section = packedBySlug.get(slug)
      if (!section) continue
      const slice = SLICES[slug]
      if (slice?.triggers.objects?.includes(activeObject)) {
        ordered.push(section)
        remaining.delete(slug)
      }
    }
  }

  // 2. Pipeline / account / people / learning categories in score order.
  for (const slug of slugs) {
    if (!remaining.has(slug)) continue
    const section = packedBySlug.get(slug)
    if (!section) continue
    const slice = SLICES[slug]
    if (
      slice?.category === 'pipeline' ||
      slice?.category === 'account' ||
      slice?.category === 'people' ||
      slice?.category === 'learning'
    ) {
      ordered.push(section)
      remaining.delete(slug)
    }
  }

  // 3. Health + meta last.
  for (const slug of slugs) {
    if (!remaining.has(slug)) continue
    const section = packedBySlug.get(slug)
    if (!section) continue
    ordered.push(section)
    remaining.delete(slug)
  }

  return ordered
}

/**
 * Top-level packing function. Pure: no global state. Suitable to call from
 * the agent route or from a pre-call brief workflow without any harness
 * differences.
 */
export async function packContext(opts: PackContextOptions): Promise<PackedContext> {
  const startedAt = Date.now()
  const tokenBudget = opts.tokenBudget ?? 2000
  const latencyBudgetMs = opts.latencyBudgetMs ?? 5000
  const deadlineMs = startedAt + latencyBudgetMs

  const active = resolveActive(opts)

  // Load per-tenant slice priors in parallel with selector setup. Cheap
  // (<5ms typical) and tolerated to fail — bandit adjustment falls back
  // to 0 when the table is empty or the migration isn't applied.
  let priorsTable: SlicePriorsTable | null = null
  try {
    priorsTable = await loadSlicePriors(
      opts.supabase,
      opts.tenantId,
      opts.intentClass,
      opts.role,
    )
  } catch (err) {
    console.warn('[packer] slice priors load failed, heuristic only:', err)
  }

  const banditAdjustments = new Map<string, number>()
  if (priorsTable && priorsTable.size > 0) {
    for (const [, prior] of priorsTable) {
      const adj = thompsonAdjustment(prior)
      if (adj !== 0) {
        banditAdjustments.set(prior.slice_slug, adj)
      }
    }
  }

  const selectorInput = buildSelectorInput({
    role: opts.role,
    activeObject: active.activeObject,
    activeUrn: opts.activeUrn,
    intentClass: opts.intentClass,
    dealStage: opts.dealStage,
    isStalled: opts.isStalled,
    signalTypes: opts.signalTypes,
    tokenBudget,
    tenantOverrides: opts.tenantOverrides,
    banditPriors: {
      adjustment: (slug: string) => banditAdjustments.get(slug) ?? 0,
    },
  })

  const selection = selectSlices(selectorInput)

  // Build the per-slice load context once.
  const loadCtx: SliceLoadCtx = {
    tenantId: opts.tenantId,
    repId: opts.repId,
    userId: opts.userId,
    role: opts.role,
    activeUrn: opts.activeUrn,
    activeObject: active.activeObject,
    activeCompanyId: active.activeCompanyId,
    activeDealId: active.activeDealId,
    pageContext: opts.pageContext,
    intentClass: opts.intentClass,
    crmType: opts.crmType,
    supabase: opts.supabase,
    deadlineMs,
  }

  // Hydrate selected slices in parallel with per-slice timeouts.
  const results = await Promise.all(
    selection.slugs.map(async (slug) => {
      const slice = SLICES[slug]
      if (!slice) return { slug, kind: 'failed' as const, reason: 'slice not registered' }
      const hydration = await withSliceTimeout(slice.load(loadCtx), slice.soft_timeout_ms)
      if (!hydration.ok) {
        return { slug, kind: 'failed' as const, reason: hydration.reason }
      }
      return { slug, kind: 'ok' as const, result: hydration.value as SliceLoadResult<unknown> }
    }),
  )

  // Build sections + collect citations.
  const packedBySlug = new Map<string, PackedSection>()
  const failed: { slug: string; reason: string }[] = []
  const allCitations: PendingCitation[] = []
  const allWarnings: { slug: string; warning: string }[] = []

  for (const r of results) {
    const slice = SLICES[r.slug]
    if (!slice) continue
    if (r.kind === 'failed') {
      failed.push({ slug: r.slug, reason: r.reason })
      continue
    }
    const markdown = slice.formatForPrompt(r.result.rows)
    const tokens = estimateTokens(markdown)
    packedBySlug.set(r.slug, {
      slug: r.slug,
      title: slice.title,
      markdown,
      provenance: r.result.provenance,
      tokens,
      row_count: r.result.rows.length,
    })
    allCitations.push(...r.result.citations)
    if (r.result.warnings) {
      for (const w of r.result.warnings) allWarnings.push({ slug: r.slug, warning: w })
    }
  }

  const sections = orderSections(selection.slugs, packedBySlug, active.activeObject)
  const tokens_used = sections.reduce((sum, s) => sum + s.tokens, 0)

  // Always-on coverage notes from slice warnings — gives the agent the
  // honest "I notice X is empty" surface (UX#9 honest-error states).
  // Acts as the de facto data-coverage-warnings slice; promotion to a
  // formal ContextSlice would just move complexity without adding value
  // because the warning data is already collected per-slice during load.
  if (allWarnings.length > 0 || failed.length > 0) {
    const warningLines = allWarnings.map((w) => `- [${w.slug}] ${w.warning}`)
    const failedLines = failed.map((f) => `- [${f.slug}] FAILED — ${f.reason}`)
    const coverageMd = `### Coverage notes (honesty surface)\nThe agent should mention any of these in its response if relevant — never invent around a known gap.\n${[...warningLines, ...failedLines].join('\n')}`
    const coverageTokens = estimateTokens(coverageMd)
    sections.push({
      slug: '_coverage-warnings',
      title: 'Coverage notes',
      markdown: coverageMd,
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: 0,
      },
      tokens: coverageTokens,
      row_count: allWarnings.length + failed.length,
    })
  }

  // Telemetry — fire-and-forget per slice. Errors swallowed by emitAgentEvent.
  void emitTelemetry(opts, selection.scored, packedBySlug, failed)

  return {
    preamble: '', // packer doesn't render the preamble; preamble.ts owns it.
    sections,
    citations: allCitations,
    failed,
    hydrated: Array.from(packedBySlug.keys()),
    tokens_used,
    scored: selection.scored,
    legacy: null, // facade.ts populates this when the caller wants legacy AgentContext.
  }
}

async function emitTelemetry(
  opts: PackContextOptions,
  scored: ScoredSlice[],
  packed: Map<string, PackedSection>,
  failed: { slug: string; reason: string }[],
): Promise<void> {
  const scoredBySlug = new Map(scored.map((s) => [s.slug, s]))

  for (const [slug, section] of packed.entries()) {
    await emitAgentEvent(opts.supabase, {
      tenant_id: opts.tenantId,
      interaction_id: opts.interactionId ?? null,
      user_id: opts.userId,
      role: opts.role,
      event_type: 'context_slice_loaded',
      payload: {
        slug,
        intent_class: opts.intentClass,
        rows: section.row_count,
        tokens: section.tokens,
        duration_ms: section.provenance.duration_ms,
        source: section.provenance.source,
        score: scoredBySlug.get(slug)?.score ?? null,
        score_reasons: scoredBySlug.get(slug)?.reasons ?? [],
      },
    })
  }

  for (const f of failed) {
    await emitAgentEvent(opts.supabase, {
      tenant_id: opts.tenantId,
      interaction_id: opts.interactionId ?? null,
      user_id: opts.userId,
      role: opts.role,
      event_type: 'context_slice_failed',
      payload: {
        slug: f.slug,
        reason: f.reason,
        intent_class: opts.intentClass,
      },
    })
  }
}

/**
 * Convenience: render PackedContext.sections into one markdown string for
 * splicing into a system prompt. Sections are joined with a blank line so
 * the model sees them as discrete units.
 */
export function renderPackedSections(packed: PackedContext): string {
  if (packed.sections.length === 0) return ''
  return packed.sections.map((s) => s.markdown).join('\n\n')
}

/**
 * Parse a body of assistant text for `urn:rev:...` references and return
 * the unique URN strings it mentions.
 *
 * The regex is intentionally permissive: matches the URN structure
 * (`urn:rev:{tenantId}:{type}:{id}`) but tolerates trailing punctuation,
 * surrounding backticks/parens, and case variations on `rev`. Used by
 * the route's onFinish to emit `context_slice_consumed` events — without
 * which the bandit can only learn "which slices were loaded" not "which
 * slices the agent actually leaned on".
 */
export function extractUrnsFromText(text: string): string[] {
  if (!text) return []
  const urns = new Set<string>()
  const re = /urn:rev:[a-z]+:[A-Za-z0-9_-]+/gi
  for (const match of text.matchAll(re)) {
    urns.add(match[0])
  }
  return Array.from(urns)
}

/**
 * Given the assistant text and a PackedContext, return per-slice
 * "consumption" stats: which slices the response actually referenced via
 * URN tokens, and which URNs from each slice landed in the response.
 *
 * Emits one `context_slice_consumed` event per slice that contributed at
 * least one URN. Non-cited slices stay silent — the bandit treats those
 * as neutral, not negative (the agent may have used the slice's framing
 * without quoting a row URN).
 */
export interface ConsumedSlice {
  slug: string
  urns_referenced: string[]
}

export function consumedSlicesFromResponse(
  packed: PackedContext,
  assistantText: string,
): ConsumedSlice[] {
  const referencedUrns = new Set(extractUrnsFromText(assistantText))
  if (referencedUrns.size === 0) return []

  // Build a map: slug -> set of URNs that slice produced. We re-derive
  // this from the per-section citations the packer collected, falling
  // back to scanning the section markdown for inline URN tokens (the
  // citations array doesn't always carry URNs verbatim — for slices that
  // emit just `source_id`, the URN lives in the formatted markdown).
  const sliceToUrns = new Map<string, Set<string>>()
  for (const section of packed.sections) {
    if (section.slug.startsWith('_')) continue // skip the meta coverage section
    const urnsInSection = new Set(extractUrnsFromText(section.markdown))
    if (urnsInSection.size > 0) sliceToUrns.set(section.slug, urnsInSection)
  }

  const consumed: ConsumedSlice[] = []
  for (const [slug, urnsInSlice] of sliceToUrns.entries()) {
    const overlap: string[] = []
    for (const urn of urnsInSlice) {
      if (referencedUrns.has(urn)) overlap.push(urn)
    }
    if (overlap.length > 0) consumed.push({ slug, urns_referenced: overlap })
  }
  return consumed
}

/**
 * Re-export so callers don't have to import from selector.ts separately.
 */
export { stageBucketFromString }
