import type { SupabaseClient } from '@supabase/supabase-js'
import { emitAgentEvents, parseUrn, type AgentEventInput, type UrnObjectType } from '@prospector/core'
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
import { loadRetrievalCtr, ctrAdjustment } from './retrieval-ctr'
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
  /**
   * Optional secondary intent classes for compound queries. See
   * `ContextSelectorInput.secondaryIntents` for semantics.
   */
  secondaryIntents?: IntentClass[]

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

  /**
   * Most-recent user message, when known. Threaded into SliceLoadCtx
   * so RAG slices (C5.2) can embed the query for similarity
   * retrieval. Optional.
   */
  userMessageText?: string | null

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
 *
 * Async because deal-first navigation (URN = `:deal:`) used to leave
 * `activeCompanyId` null — every slice that requires `activeCompanyId`
 * (transcript-summaries, key-contact-notes, champion-map) silently no-op'd
 * with "needs an active company id" warnings. The rep on a deal page got
 * a thinner pack than the rep on the company page, even though the deal
 * row owns a `company_id`. We now follow the FK once during resolution
 * and cache the answer for the rest of the turn.
 *
 * The lookup is tenant-scoped — even if `parsed.id` came from a hostile
 * URN, the join to `opportunities` returns null when the deal belongs to
 * a different tenant, so the slice load gracefully degrades.
 */
interface ResolvedActive {
  activeObject: ActiveObjectType
  activeCompanyId: string | null
  activeDealId: string | null
  /** Deal value in native currency units, null when no deal or not set. */
  dealValue: number | null
  /** Days until expected_close_date; negative = overdue; null = no deal/date. */
  daysToClose: number | null
}

async function resolveActive(opts: PackContextOptions): Promise<ResolvedActive> {
  const parsed = opts.activeUrn ? parseUrn(opts.activeUrn) : null

  /** Follow deal FK, also fetching value + close date for budget + urgency. */
  async function resolveDeal(dealId: string): Promise<ResolvedActive> {
    const { data } = await opts.supabase
      .from('opportunities')
      .select('company_id, amount, expected_close_date')
      .eq('id', dealId)
      .eq('tenant_id', opts.tenantId)
      .maybeSingle()
    const daysToClose = data?.expected_close_date
      ? Math.round(
          (new Date(data.expected_close_date as string).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24),
        )
      : null
    return {
      activeObject: 'deal',
      activeCompanyId: (data?.company_id as string | null) ?? null,
      activeDealId: dealId,
      dealValue: typeof data?.amount === 'number' ? data.amount : null,
      daysToClose,
    }
  }

  if (parsed) {
    if (parsed.type === 'company') {
      return { activeObject: 'company', activeCompanyId: parsed.id, activeDealId: null, dealValue: null, daysToClose: null }
    }
    if (parsed.type === 'deal' || parsed.type === 'opportunity') {
      return resolveDeal(parsed.id)
    }
    if (parsed.type === 'contact') {
      return { activeObject: 'contact', activeCompanyId: null, activeDealId: null, dealValue: null, daysToClose: null }
    }
    if (parsed.type === 'signal') {
      return { activeObject: 'signal', activeCompanyId: null, activeDealId: null, dealValue: null, daysToClose: null }
    }
  }
  if (opts.pageContext?.dealId) {
    return resolveDeal(opts.pageContext.dealId)
  }
  if (opts.pageContext?.accountId) {
    return { activeObject: 'company', activeCompanyId: opts.pageContext.accountId, activeDealId: null, dealValue: null, daysToClose: null }
  }
  return { activeObject: 'none', activeCompanyId: null, activeDealId: null, dealValue: null, daysToClose: null }
}

/**
 * Compute an adaptive token budget based on deal value.
 *
 * The 2000-token default is designed for a generic rep dashboard — it
 * fits within the ~480-token (brief comm_style) prompt slot limit.
 * But a €1 M enterprise deal warrants much richer context: transcript
 * bodies, competitive intel, champion alumni, relationship decay, etc.
 * Budgeting proportionally means the agent gets enough data to form
 * an opinion without wasting context window on noise for SMB queries.
 *
 * Brackets are conservative — the packer enforces a hard post-format
 * trim so going over the selector's declared budgets just drops the
 * lowest-priority slices.
 */
export function budgetFromDealValue(
  value: number | null,
  explicitOverride?: number | null,
): number {
  if (explicitOverride != null) return explicitOverride
  if (!value || value <= 0) return 3000        // no deal / unknown → balanced default
  if (value >= 500_000) return 7000            // strategic: full pack
  if (value >= 100_000) return 5000            // large / enterprise
  if (value >= 25_000) return 3500             // mid-market
  return 2500                                  // SMB
}

/**
 * Composite urgency score 0-10. Two additive signals:
 *
 *   1. Close-date proximity — the closer the deal's expected_close_date,
 *      the higher the score. Overdue deals score max.
 *   2. Quarter-end proximity — last three weeks of any fiscal quarter
 *      add +1/+2/+3 to create a quarter-end crunch effect.
 *
 * Score > 5 activates `whenUrgent` slice triggers in the selector.
 */
export function computeUrgency(
  daysToClose: number | null,
  now: Date = new Date(),
): number {
  let score = 0

  // Close-date pressure
  if (daysToClose !== null) {
    if (daysToClose <= 0) score += 5           // overdue
    else if (daysToClose <= 7) score += 5
    else if (daysToClose <= 14) score += 4
    else if (daysToClose <= 30) score += 3
    else if (daysToClose <= 60) score += 2
    else if (daysToClose <= 90) score += 1
  }

  // Quarter-end pressure (month 2, 5, 8, 11 = March, June, Sep, Dec)
  const month = now.getMonth()
  if (month % 3 === 2) {
    const lastDayOfMonth = new Date(now.getFullYear(), month + 1, 0).getDate()
    const daysLeftInMonth = lastDayOfMonth - now.getDate()
    if (daysLeftInMonth <= 7) score += 3
    else if (daysLeftInMonth <= 14) score += 2
    else if (daysLeftInMonth <= 21) score += 1
  }

  return Math.min(score, 10)
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
  const latencyBudgetMs = opts.latencyBudgetMs ?? 5000
  const deadlineMs = startedAt + latencyBudgetMs

  const active = await resolveActive(opts)

  // Adaptive budget: scales with deal value so strategic deals get richer
  // context without wasting tokens on SMB queries.
  const tokenBudget = budgetFromDealValue(active.dealValue, opts.tokenBudget ?? null)

  // Urgency: composite close-date + quarter-end score fed to slice selector.
  const urgencyScore = computeUrgency(active.daysToClose)

  // Load per-tenant slice priors AND citation-CTR table in parallel
  // with selector setup. Both are cheap (<5ms typical) and tolerated
  // to fail — bandit + CTR adjustments fall back to 0 when their
  // tables are empty.
  const [priorsTable, ctrTable] = await Promise.all([
    loadSlicePriors(
      opts.supabase,
      opts.tenantId,
      opts.intentClass,
      opts.role,
    ).catch((err) => {
      console.warn('[packer] slice priors load failed, heuristic only:', err)
      return null as SlicePriorsTable | null
    }),
    loadRetrievalCtr(opts.supabase, opts.tenantId),
  ])

  // Combine bandit (Thompson sampling) and CTR (citation-click) into
  // a single per-slug adjustment passed to the selector. C5.3:
  // citation clicks finally feed back into ranking — the
  // `retrieval_priors` write-only-tombstone is now a real signal.
  const sliceAdjustments = new Map<string, number>()
  if (priorsTable && priorsTable.size > 0) {
    for (const [, prior] of priorsTable) {
      const banditAdj = thompsonAdjustment(prior)
      if (banditAdj !== 0) {
        sliceAdjustments.set(prior.slice_slug, banditAdj)
      }
    }
  }
  for (const slug of Object.keys(SLICES)) {
    const ctrAdj = ctrAdjustment(ctrTable, slug)
    if (ctrAdj !== 0) {
      const cur = sliceAdjustments.get(slug) ?? 0
      sliceAdjustments.set(slug, cur + ctrAdj)
    }
  }

  const selectorInput = buildSelectorInput({
    role: opts.role,
    activeObject: active.activeObject,
    activeUrn: opts.activeUrn,
    intentClass: opts.intentClass,
    secondaryIntents: opts.secondaryIntents,
    dealStage: opts.dealStage,
    isStalled: opts.isStalled,
    signalTypes: opts.signalTypes,
    urgencyScore,
    tokenBudget,
    tenantOverrides: opts.tenantOverrides,
    banditPriors: {
      // Combined Thompson-bandit + retrieval-CTR adjustment (C5.3).
      // The selector treats both as a single nudge — caller doesn't
      // need to know which signal contributed. The bandit's per-slice
      // sample-count visibility on /admin/adaptation still surfaces
      // the bandit half cleanly.
      adjustment: (slug: string) => sliceAdjustments.get(slug) ?? 0,
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
    // C5.2 — RAG slices use this for similarity retrieval. Optional;
    // workflows / evals may pack without a user message and the RAG
    // slices degrade gracefully to empty.
    userMessageText: opts.userMessageText ?? null,
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
    // Pass tenantId so slices can emit canonical URNs
    // (urn:rev:{tenantId}:{type}:{id}). Slices that don't emit URNs
    // ignore the second argument.
    const markdown = slice.formatForPrompt(r.result.rows, { tenantId: opts.tenantId })
    const tokens = estimateTokens(markdown)
    packedBySlug.set(r.slug, {
      slug: r.slug,
      title: slice.title,
      markdown,
      provenance: r.result.provenance,
      tokens,
      row_count: r.result.rows.length,
      // Phase 6 (1.2) — propagate injected ids so the route's onFinish
      // can reconcile against URNs in the assistant text and so the
      // packer's emitTelemetry below can fire memory_injected /
      // wiki_page_injected events without each slice re-doing the work.
      injectedMemoryIds: r.result.injectedMemoryIds,
      injectedPageIds: r.result.injectedPageIds,
    })
    allCitations.push(...r.result.citations)
    if (r.result.warnings) {
      for (const w of r.result.warnings) allWarnings.push({ slug: r.slug, warning: w })
    }
  }

  const sections = orderSections(selection.slugs, packedBySlug, active.activeObject)

  // Real budget enforcement. The selector picks slices by *declared*
  // `slice.token_budget`, but `formatForPrompt` can return more — a slice
  // declaring 400 tokens that emits 5 transcript bodies at 240 chars each
  // realises ~6× the budget. Pre-this-change, `tokens_used` could blow
  // 50% past the global cap, pushing the behaviour-rules block (which
  // sits AFTER `sections` in the system prompt) further from the
  // high-attention end. The model then drops citation discipline,
  // formats sloppily, ignores the next-step contract.
  //
  // Strategy:
  //   1. If we're under budget, do nothing.
  //   2. Otherwise drop sections from the END (lowest priority by
  //      lost-in-the-middle ordering — meta/health categories) until
  //      we're under cap. Active-object slices and high-score slices
  //      live at the front and survive.
  //   3. Always keep at least one section so the agent has SOMETHING
  //      to ground in.
  //
  // The dropped sections still appear in `failed[]` (with reason
  // `over_budget_after_format`) so the bandit can punish chronic
  // over-realisers and the next turn picks differently.
  let tokens_used = sections.reduce((sum, s) => sum + s.tokens, 0)
  while (tokens_used > tokenBudget && sections.length > 1) {
    const dropped = sections.pop()
    if (!dropped) break
    failed.push({
      slug: dropped.slug,
      reason: `over_budget_after_format: dropped to keep tokens_used <= ${tokenBudget}`,
    })
    tokens_used -= dropped.tokens
  }

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
  void emitTelemetry(opts, selection.scored, packedBySlug, failed, {
    urgencyScore,
    dealValue: active.dealValue,
    tokenBudget,
  })

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
  packMeta?: { urgencyScore: number; dealValue: number | null; tokenBudget: number },
): Promise<void> {
  // Pre-this-change this fired N sequential `emitAgentEvent` inserts
  // (one round-trip per slice per turn). 12 slices × ~30ms = ~360ms of
  // wall-clock cost on every chat turn, all of it after the response was
  // already streaming. Multiply by 100 reps × 100 tenants × 100 turns/day
  // and the `agent_events` table grew with maximum write contention.
  //
  // We now batch every event into a single `emitAgentEvents` call —
  // one INSERT per turn, ~30ms total. The `void` at the call site keeps
  // the fire-and-forget contract: telemetry never blocks the response.
  const scoredBySlug = new Map(scored.map((s) => [s.slug, s]))

  const events: AgentEventInput[] = []

  for (const [slug, section] of packed.entries()) {
    events.push({
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
        urgency_score: packMeta?.urgencyScore ?? 0,
        deal_value: packMeta?.dealValue ?? null,
        token_budget: packMeta?.tokenBudget ?? null,
      },
    })

    // Phase 6 (1.2) — emit one memory_injected per atom id this slice
    // brought into the prompt, and one wiki_page_injected per page id.
    // These feed the per-row Beta posterior on tenant_memories and
    // wiki_pages (the route's onFinish updates them once per turn).
    // Without this event the bandit has no impression count and the
    // posterior never moves off the uniform Beta(1,1) prior.
    for (const memoryId of section.injectedMemoryIds ?? []) {
      events.push({
        tenant_id: opts.tenantId,
        interaction_id: opts.interactionId ?? null,
        user_id: opts.userId,
        role: opts.role,
        event_type: 'memory_injected',
        // The contract from validate-events.ts requires { memory_id, kind }.
        // We don't know the kind here without re-querying — pass the
        // slice slug as a proxy; the consolidate workflow can still
        // join back to tenant_memories.kind by id.
        payload: {
          memory_id: memoryId,
          kind: 'unknown', // resolved post-hoc via tenant_memories join
          slice_slug: slug,
          intent_class: opts.intentClass,
        },
      })
    }
    for (const pageId of section.injectedPageIds ?? []) {
      events.push({
        tenant_id: opts.tenantId,
        interaction_id: opts.interactionId ?? null,
        user_id: opts.userId,
        role: opts.role,
        event_type: 'wiki_page_injected',
        payload: {
          page_id: pageId,
          kind: 'unknown', // resolved post-hoc via wiki_pages join
          slice_slug: slug,
          intent_class: opts.intentClass,
        },
      })
    }
  }

  for (const f of failed) {
    events.push({
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

  // Single batch insert. `emitAgentEvents` swallows errors internally so
  // a transient `agent_events` write failure can't surface as a turn
  // failure here.
  if (events.length > 0) {
    await emitAgentEvents(opts.supabase, events)
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
  // Canonical URN is `urn:rev:{tenantId}:{type}:{id}` where tenantId is
  // a UUID (digits + hyphens) and id can be a UUID or a CRM id.
  // The previous regex `urn:rev:[a-z]+:[A-Za-z0-9_-]+` only allowed
  // letters in the next segment after `urn:rev:`, so it could match
  // shorthand (`urn:rev:type:id`) but never canonical URNs whose
  // tenant segment starts with a digit. That's why the bandit's
  // `context_slice_consumed` event stream looked empty for any tenant
  // with a UUID id starting with a digit (i.e. all of them).
  //
  // The new pattern matches both forms:
  //   - canonical: urn:rev:<tenantId>:<type>:<id>
  //   - shorthand: urn:rev:<type>:<id>  (legacy; still emitted by some
  //     places we haven't migrated yet — kept matched so we don't lose
  //     telemetry during the rollout)
  // A URN segment is `[A-Za-z0-9_-]+` (alphanumeric + hyphen + underscore).
  // We allow 3 OR 4 segments after `urn:rev:` so both shapes parse.
  const re = /urn:rev(?::[A-Za-z0-9_-]+){2,4}/gi
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
 * Phase 6 (1.2) — extract the set of `urn:rev:{tenant}:memory:{id}` and
 * `urn:rev:{tenant}:wiki_page:{id}` ids that the assistant text actually
 * cited. Used by the route's onFinish to:
 *   1. Emit `memory_cited` / `wiki_page_cited` events per id, and
 *   2. Update the per-row Beta posterior on tenant_memories /
 *      wiki_pages (prior_alpha += 1 per cited id, prior_beta += 1 per
 *      injected id).
 *
 * Returns the SET of unique ids per type. Same id repeated in the
 * response counts once — what the bandit cares about is "did the
 * memory/page get USED at all in this turn", not citation density.
 */
export interface CitedMemoryIds {
  memoryIds: string[]
  wikiPageIds: string[]
}

export function citedMemoryIdsFromResponse(
  assistantText: string,
  tenantId: string,
): CitedMemoryIds {
  const memoryIds = new Set<string>()
  const wikiPageIds = new Set<string>()
  for (const u of extractUrnsFromText(assistantText)) {
    const parsed = parseUrn(u)
    if (!parsed) continue
    // Tenant scoping — never count an URN from a different tenant.
    // Cross-tenant URNs in chat output would already be a data leak,
    // but cheap to defend in depth here.
    if (parsed.tenantId !== tenantId) continue
    const type: UrnObjectType = parsed.type
    if (type === 'memory') memoryIds.add(parsed.id)
    else if (type === 'wiki_page') wikiPageIds.add(parsed.id)
  }
  return {
    memoryIds: Array.from(memoryIds),
    wikiPageIds: Array.from(wikiPageIds),
  }
}

/**
 * Pull the union of injected ids across every section in a PackedContext.
 * Used by the agent route's onFinish to drive the impression side of
 * the Beta update (prior_beta += 1 per id) and to emit per-id
 * memory_cited events that include the kind from the slice section.
 */
export function injectedMemoryIdsFromPacked(packed: PackedContext): {
  memoryIds: string[]
  wikiPageIds: string[]
} {
  const memoryIds = new Set<string>()
  const wikiPageIds = new Set<string>()
  for (const section of packed.sections) {
    for (const id of section.injectedMemoryIds ?? []) memoryIds.add(id)
    for (const id of section.injectedPageIds ?? []) wikiPageIds.add(id)
  }
  return {
    memoryIds: Array.from(memoryIds),
    wikiPageIds: Array.from(wikiPageIds),
  }
}

/**
 * Re-export so callers don't have to import from selector.ts separately.
 */
export { stageBucketFromString }
