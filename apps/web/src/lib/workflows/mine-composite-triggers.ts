import type { SupabaseClient } from '@supabase/supabase-js'
import { generateObject } from 'ai'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import {
  emitAgentEvent,
  urn,
  DEFAULT_TRIGGER_LIFESPAN_DAYS,
  type ProposeTriggerInput,
  type TriggerComponents,
  type TriggerPattern,
} from '@prospector/core'
import { getModel } from '@/lib/agent/model-registry'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * mine-composite-triggers — Phase 7 (Section 2.2). The architectural
 * pivot.
 *
 * Composes signals + bridges + enrichment into typed, first-class
 * trigger rows. Each trigger is a single "act now" event with cited
 * components — the smaller decision the rep should land on. Replaces
 * the heuristic urgency_components scoring path.
 *
 * Pattern matchers are pure SQL (deterministic, debuggable). Sonnet
 * is called ONCE per match to write the rationale string. Total
 * cost: ~10-30 triggers/tenant/night × ~300 tokens = ~9k tokens/
 * tenant/night.
 *
 * Idempotency: each trigger carries a natural_key in components
 * JSONB. The unique partial index on
 * (tenant_id, pattern, components->>'natural_key') dedupes re-runs.
 *
 * 7 patterns implemented (one matcher each):
 *
 *   - funding_plus_leadership_window
 *   - warm_path_at_active_buyer
 *   - hot_lookalike_in_market
 *   - multi_bridge_to_target
 *   - job_change_at_existing_account
 *   - tradeshow_cluster        (stub — needs tradeshow_attendance signals which arrive via adapter)
 *   - tech_stack_competitor_swap (stub — needs tech_stack_change signals via BuiltWith adapter)
 */

const RATIONALE_MAX_TOKENS = 220
const PATTERN_WINDOW_DAYS = 90
const MULTI_BRIDGE_THRESHOLD = 3

const RationaleSchema = z.object({
  rationale: z
    .string()
    .min(20)
    .max(220)
    .describe('One-line, ≤200 chars, agent-facing explanation citing the component URNs'),
  recommended_action: z.string().min(8).max(200).optional(),
  recommended_tool: z.string().min(2).max(60).optional(),
  trigger_score: z
    .number()
    .min(0)
    .max(1)
    .describe('Composite confidence 0..1 — higher when components are fresh + multiple'),
})

interface TriggerCandidate {
  pattern: TriggerPattern
  company_id: string | null
  opportunity_id?: string | null
  components: TriggerComponents
  // Hint to Sonnet for the rationale; the LLM is bounded to write
  // about THIS evidence only (no invention). Keys must be cited
  // verbatim in the rationale string.
  evidenceForLlm: Array<{ kind: string; ref: string; detail: string }>
}

export async function enqueueMineCompositeTriggers(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'mine_composite_triggers',
    idempotencyKey: `mct:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runMineCompositeTriggers(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'match_patterns',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const candidates: TriggerCandidate[] = []
        const patternStats: Record<string, number> = {}

        const matchers: Array<[
          TriggerPattern,
          () => Promise<TriggerCandidate[]>,
        ]> = [
          [
            'funding_plus_leadership_window',
            () => matchFundingPlusLeadership(ctx.supabase, ctx.tenantId!),
          ],
          [
            'warm_path_at_active_buyer',
            () => matchWarmPathAtActiveBuyer(ctx.supabase, ctx.tenantId!),
          ],
          [
            'hot_lookalike_in_market',
            () => matchHotLookalike(ctx.supabase, ctx.tenantId!),
          ],
          [
            'multi_bridge_to_target',
            () => matchMultiBridge(ctx.supabase, ctx.tenantId!),
          ],
          [
            'job_change_at_existing_account',
            () => matchJobChangeAtExistingAccount(ctx.supabase, ctx.tenantId!),
          ],
          // tradeshow_cluster + tech_stack_competitor_swap require
          // their respective adapters to be writing signals first.
          // Their matchers are scaffolded but return [] until the
          // signal stream is live. Each ships in Phase 7 alongside
          // its enabling adapter (Section 4.2).
          [
            'tradeshow_cluster',
            () => matchTradeshowCluster(ctx.supabase, ctx.tenantId!),
          ],
          [
            'tech_stack_competitor_swap',
            () => matchTechStackCompetitorSwap(ctx.supabase, ctx.tenantId!),
          ],
        ]

        for (const [patternName, matcher] of matchers) {
          try {
            const found = await matcher()
            patternStats[patternName] = found.length
            candidates.push(...found)
          } catch (err) {
            console.warn(`[mine-composite-triggers] ${patternName} matcher failed:`, err)
            patternStats[patternName] = 0
          }
        }
        return { candidates, patternStats }
      },
    },
    {
      name: 'narrate_and_write',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { candidates } = ctx.stepState.match_patterns as {
          candidates: TriggerCandidate[]
        }

        if (candidates.length === 0) {
          return { written: 0, skipped: 0 }
        }

        let written = 0
        let skippedExisting = 0
        let skippedLlm = 0

        for (const candidate of candidates) {
          // Idempotency check: skip if a trigger with this natural
          // key already exists. The unique partial index would catch
          // it on insert, but checking first saves the LLM call.
          const naturalKey = candidate.components.natural_key
          if (naturalKey) {
            const { data: existing } = await ctx.supabase
              .from('triggers')
              .select('id')
              .eq('tenant_id', ctx.tenantId)
              .eq('pattern', candidate.pattern)
              .eq('components->>natural_key', naturalKey)
              .limit(1)
            if (existing && existing.length > 0) {
              skippedExisting += 1
              continue
            }
          }

          // Sonnet rationale — the only LLM call in this workflow.
          let llmOut: z.infer<typeof RationaleSchema> | null = null
          try {
            const evidenceBlock = candidate.evidenceForLlm
              .map(
                (e, i) =>
                  `${i + 1}. ${e.kind} \`${e.ref}\` — ${e.detail.slice(0, 200)}`,
              )
              .join('\n')

            const result = await generateObject({
              model: getModel('anthropic/claude-sonnet-4'),
              schema: RationaleSchema,
              prompt: `You are explaining a sales-AI buying trigger to a rep.

# PATTERN
${candidate.pattern}

# EVIDENCE (cite each ref verbatim in your rationale)
${evidenceBlock}

# WRITE
- rationale: ≤200 chars, plain prose, MUST quote at least 2 of the evidence refs verbatim. No invention.
- recommended_action: ≤150 chars, what should the rep do FIRST.
- recommended_tool: a short slug for an agent tool to call (draft_alumni_intro, find_warm_intros, draft_outreach, schedule_meeting). Pick the most fitting; omit if unclear.
- trigger_score: 0..1 — higher when evidence is multiple AND fresh. Cap at 0.95 unless every component is < 7 days old.`,
              maxTokens: RATIONALE_MAX_TOKENS,
            })
            llmOut = result.object
          } catch (err) {
            console.warn('[mine-composite-triggers] llm rationale failed:', err)
            skippedLlm += 1
            continue
          }

          // Default lifespan from the type module; specific patterns
          // can override (tradeshow_cluster sets to event_date).
          const lifespanDays = DEFAULT_TRIGGER_LIFESPAN_DAYS[candidate.pattern]
          const expiresAt = lifespanDays
            ? new Date(Date.now() + lifespanDays * 24 * 60 * 60 * 1000).toISOString()
            : null

          const insertRow: ProposeTriggerInput & {
            tenant_id: string
            status: 'open'
            detected_at: string
          } = {
            tenant_id: ctx.tenantId,
            company_id: candidate.company_id,
            opportunity_id: candidate.opportunity_id ?? null,
            pattern: candidate.pattern,
            components: candidate.components,
            trigger_score: llmOut.trigger_score,
            rationale: llmOut.rationale,
            recommended_action: llmOut.recommended_action ?? null,
            recommended_tool: llmOut.recommended_tool ?? null,
            expires_at: expiresAt,
            status: 'open',
            detected_at: new Date().toISOString(),
          }

          const { data: inserted, error: insertErr } = await ctx.supabase
            .from('triggers')
            .insert(insertRow)
            .select('id')
            .single()
          if (insertErr || !inserted) {
            // Most common cause: unique-key collision (re-run picked
            // up a trigger that landed in a previous tick). Treat as
            // skipped, not failed.
            skippedExisting += 1
            continue
          }

          written += 1
          await emitAgentEvent(ctx.supabase, {
            tenant_id: ctx.tenantId,
            event_type: 'trigger_detected',
            subject_urn: urn.trigger(ctx.tenantId, inserted.id as string),
            payload: {
              trigger_id: inserted.id,
              pattern: candidate.pattern,
              score: llmOut.trigger_score,
              components: candidate.components,
            },
          })
        }

        return {
          written,
          skipped_existing: skippedExisting,
          skipped_llm: skippedLlm,
          considered: candidates.length,
        }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

// ---------------------------------------------------------------------------
// Pattern matchers — pure SQL, deterministic, no LLM.
// ---------------------------------------------------------------------------

/**
 * Pattern: funding signal + leadership_change signal at the same
 * company within 90 days of each other. Both signals must be < 90d old.
 */
async function matchFundingPlusLeadership(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TriggerCandidate[]> {
  const since = new Date(
    Date.now() - PATTERN_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const { data: signals } = await supabase
    .from('signals')
    .select('id, company_id, signal_type, title, detected_at')
    .eq('tenant_id', tenantId)
    .in('signal_type', ['funding', 'leadership_change'])
    .gte('detected_at', since)
    .limit(2000)

  // Group per company; emit one candidate per (company, fundingId)
  // pair when leadership_change exists within 90d window.
  const byCompany = new Map<
    string,
    { funding: typeof signals; leadership: typeof signals }
  >()
  for (const s of signals ?? []) {
    if (!s.company_id) continue
    const slot = byCompany.get(s.company_id) ?? { funding: [], leadership: [] }
    if (s.signal_type === 'funding') slot.funding!.push(s)
    else slot.leadership!.push(s)
    byCompany.set(s.company_id, slot)
  }

  const candidates: TriggerCandidate[] = []
  for (const [companyId, group] of byCompany) {
    if (!group.funding?.length || !group.leadership?.length) continue
    for (const f of group.funding) {
      for (const l of group.leadership) {
        const daysApart =
          Math.abs(
            new Date(f.detected_at as string).getTime() -
              new Date(l.detected_at as string).getTime(),
          ) /
          (24 * 60 * 60 * 1000)
        if (daysApart > PATTERN_WINDOW_DAYS) continue
        const naturalKey = stableNaturalKey(['funding_plus_leadership', companyId, f.id, l.id])
        candidates.push({
          pattern: 'funding_plus_leadership_window',
          company_id: companyId,
          components: {
            signals: [f.id as string, l.id as string],
            companies: [companyId],
            natural_key: naturalKey,
            days_apart: Math.round(daysApart),
          },
          evidenceForLlm: [
            {
              kind: 'funding_signal',
              ref: urn.signal(tenantId, f.id as string),
              detail: (f.title as string) ?? 'funding event',
            },
            {
              kind: 'leadership_change_signal',
              ref: urn.signal(tenantId, l.id as string),
              detail: (l.title as string) ?? 'leadership change',
            },
          ],
        })
      }
    }
  }
  return candidates
}

/**
 * Pattern: company has at least one inbound bridges_to edge AND any
 * intent-y signal (intent_topic, hiring_surge, funding, expansion)
 * in last 30 days.
 */
async function matchWarmPathAtActiveBuyer(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TriggerCandidate[]> {
  // Recent intent signals.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: hotSignals } = await supabase
    .from('signals')
    .select('id, company_id, signal_type, title, detected_at')
    .eq('tenant_id', tenantId)
    .in('signal_type', ['intent_topic', 'hiring_surge', 'funding', 'expansion', 'press_event'])
    .gte('detected_at', since)
    .limit(500)
  if (!hotSignals || hotSignals.length === 0) return []

  const hotCompanyIds = [
    ...new Set(hotSignals.map((s) => s.company_id).filter(Boolean) as string[]),
  ]
  if (hotCompanyIds.length === 0) return []

  // Inbound bridges_to edges to those companies.
  const { data: bridges } = await supabase
    .from('memory_edges')
    .select('id, src_id, dst_id, evidence')
    .eq('tenant_id', tenantId)
    .eq('edge_kind', 'bridges_to')
    .eq('dst_kind', 'company')
    .in('dst_id', hotCompanyIds)
    .limit(2000)
  if (!bridges || bridges.length === 0) return []

  // Group bridges by dst_id.
  const bridgesByCompany = new Map<string, typeof bridges>()
  for (const b of bridges) {
    const arr = bridgesByCompany.get(b.dst_id as string) ?? []
    arr.push(b)
    bridgesByCompany.set(b.dst_id as string, arr)
  }

  const candidates: TriggerCandidate[] = []
  // Also bucket signals by company for lookup.
  const signalsByCompany = new Map<string, typeof hotSignals>()
  for (const s of hotSignals) {
    if (!s.company_id) continue
    const arr = signalsByCompany.get(s.company_id) ?? []
    arr.push(s)
    signalsByCompany.set(s.company_id, arr)
  }

  for (const [companyId, companyBridges] of bridgesByCompany) {
    const companySignals = signalsByCompany.get(companyId) ?? []
    if (companySignals.length === 0) continue
    // One candidate per (company, freshest-signal). One per company is
    // usually enough; bridges aggregate into the rationale.
    const freshSignal = companySignals.sort((a, b) =>
      (b.detected_at as string).localeCompare(a.detected_at as string),
    )[0]
    const naturalKey = stableNaturalKey([
      'warm_path',
      companyId,
      freshSignal.id as string,
    ])
    candidates.push({
      pattern: 'warm_path_at_active_buyer',
      company_id: companyId,
      components: {
        signals: [freshSignal.id as string],
        bridges: companyBridges.slice(0, 3).map((b) => b.id as string),
        companies: [companyId],
        natural_key: naturalKey,
        bridge_count: companyBridges.length,
      },
      evidenceForLlm: [
        {
          kind: 'intent_signal',
          ref: urn.signal(tenantId, freshSignal.id as string),
          detail: (freshSignal.title as string) ?? freshSignal.signal_type,
        },
        {
          kind: 'inbound_bridges',
          ref: `${companyBridges.length} bridge${companyBridges.length === 1 ? '' : 's'}`,
          detail: `Warm-intro paths via ${companyBridges.length} mutual connection${companyBridges.length === 1 ? '' : 's'} from this tenant's network`,
        },
      ],
    })
  }
  return candidates
}

/**
 * Pattern: company has competitor_mention signal in last 21d AND
 * tech_stack overlap >= 60% with at least one closed-won deal.
 *
 * v1 simplification: we use icp_score as a fast proxy for "looks
 * like our wins" (which icp-scorer.ts already factors tech_stack
 * into). When the dedicated tech_stack overlap matcher ships in
 * Phase 7.5 we'll tighten this.
 */
async function matchHotLookalike(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TriggerCandidate[]> {
  const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString()
  const { data: competitorSignals } = await supabase
    .from('signals')
    .select('id, company_id, signal_type, title, detected_at')
    .eq('tenant_id', tenantId)
    .eq('signal_type', 'competitor_mention')
    .gte('detected_at', since)
    .limit(200)
  if (!competitorSignals || competitorSignals.length === 0) return []

  const companyIds = [
    ...new Set(competitorSignals.map((s) => s.company_id).filter(Boolean) as string[]),
  ]
  if (companyIds.length === 0) return []

  // High-ICP-score companies = our closest analogs. icp_score >= 70
  // is a tight cutoff; lookalike triggers are precision-biased.
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, icp_score')
    .eq('tenant_id', tenantId)
    .in('id', companyIds)
    .gte('icp_score', 70)
    .limit(200)
  if (!companies || companies.length === 0) return []

  const candidates: TriggerCandidate[] = []
  for (const co of companies) {
    const sig = competitorSignals.find((s) => s.company_id === co.id)
    if (!sig) continue
    const naturalKey = stableNaturalKey(['hot_lookalike', co.id as string, sig.id as string])
    candidates.push({
      pattern: 'hot_lookalike_in_market',
      company_id: co.id as string,
      components: {
        signals: [sig.id as string],
        companies: [co.id as string],
        natural_key: naturalKey,
        icp_score: Number(co.icp_score),
      },
      evidenceForLlm: [
        {
          kind: 'competitor_mention',
          ref: urn.signal(tenantId, sig.id as string),
          detail: (sig.title as string) ?? 'competitor mentioned',
        },
        {
          kind: 'icp_match',
          ref: urn.company(tenantId, co.id as string),
          detail: `${co.name} — ICP score ${co.icp_score}`,
        },
      ],
    })
  }
  return candidates
}

/**
 * Pattern: 3+ inbound bridges_to edges converging on one company.
 */
async function matchMultiBridge(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TriggerCandidate[]> {
  const { data: bridges } = await supabase
    .from('memory_edges')
    .select('id, src_id, dst_id')
    .eq('tenant_id', tenantId)
    .eq('edge_kind', 'bridges_to')
    .eq('dst_kind', 'company')
    .limit(5000)
  if (!bridges || bridges.length === 0) return []

  const byCompany = new Map<string, string[]>()
  for (const b of bridges) {
    const arr = byCompany.get(b.dst_id as string) ?? []
    arr.push(b.id as string)
    byCompany.set(b.dst_id as string, arr)
  }

  const candidates: TriggerCandidate[] = []
  for (const [companyId, edgeIds] of byCompany) {
    if (edgeIds.length < MULTI_BRIDGE_THRESHOLD) continue
    const naturalKey = stableNaturalKey([
      'multi_bridge',
      companyId,
      String(edgeIds.length),
      // include the first edge id so re-runs that gain a 4th bridge
      // mint a new trigger. The previous 3-bridge trigger expires
      // naturally.
      edgeIds.sort()[0],
    ])
    candidates.push({
      pattern: 'multi_bridge_to_target',
      company_id: companyId,
      components: {
        bridges: edgeIds.slice(0, 10),
        companies: [companyId],
        natural_key: naturalKey,
        bridge_count: edgeIds.length,
      },
      evidenceForLlm: [
        {
          kind: 'multi_bridge',
          ref: urn.company(tenantId, companyId),
          detail: `${edgeIds.length} inbound warm-intro paths converging on this account`,
        },
      ],
    })
  }
  return candidates
}

/**
 * Pattern: job_change signal (with internal_mover marker in
 * description, written by mine-internal-movers) at a tracked
 * company.
 */
async function matchJobChangeAtExistingAccount(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TriggerCandidate[]> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data: signals } = await supabase
    .from('signals')
    .select('id, company_id, title, description, detected_at')
    .eq('tenant_id', tenantId)
    .eq('signal_type', 'job_change')
    .gte('detected_at', since)
    .limit(200)
  if (!signals || signals.length === 0) return []

  const candidates: TriggerCandidate[] = []
  for (const s of signals) {
    if (!s.company_id) continue
    // Filter to internal movers (mine-internal-movers tags the
    // description). Reverse-alumni signals (refresh-contacts) tag
    // their description differently.
    const desc = (s.description as string | null) ?? ''
    if (!desc.includes('internal_mover_contact:')) continue

    const naturalKey = stableNaturalKey([
      'job_change_internal',
      s.company_id as string,
      s.id as string,
    ])
    candidates.push({
      pattern: 'job_change_at_existing_account',
      company_id: s.company_id as string,
      components: {
        signals: [s.id as string],
        companies: [s.company_id as string],
        natural_key: naturalKey,
      },
      evidenceForLlm: [
        {
          kind: 'job_change_signal',
          ref: urn.signal(tenantId, s.id as string),
          detail: (s.title as string) ?? 'internal job change',
        },
      ],
    })
  }
  return candidates
}

/**
 * Tradeshow cluster — needs `tradeshow_attendance` signals which
 * arrive via the IntentDataAdapter once a vendor (Tavily News for
 * public conference rosters) is wired. Until then this matcher
 * returns no rows; the surface is ready when the data is.
 */
async function matchTradeshowCluster(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TriggerCandidate[]> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: signals } = await supabase
    .from('signals')
    .select('id, company_id, title, description, detected_at, source_url')
    .eq('tenant_id', tenantId)
    .eq('signal_type', 'tradeshow_attendance')
    .gte('detected_at', since)
    .limit(500)
  if (!signals || signals.length === 0) return []

  // Group by event identifier embedded in description (`event:slug`).
  // The TavilyNewsAdapter (Section 4.2) is responsible for tagging
  // event slugs; until the adapter writes them, this matcher returns
  // empty.
  const byEvent = new Map<string, typeof signals>()
  for (const s of signals) {
    const desc = (s.description as string | null) ?? ''
    const match = desc.match(/event:([a-z0-9-]+)/i)
    if (!match) continue
    const arr = byEvent.get(match[1]) ?? []
    arr.push(s)
    byEvent.set(match[1], arr)
  }

  const candidates: TriggerCandidate[] = []
  for (const [eventSlug, attendees] of byEvent) {
    if (attendees.length < 3) continue // need a CLUSTER, not one attendee
    const companyIds = [
      ...new Set(attendees.map((a) => a.company_id).filter(Boolean) as string[]),
    ]
    const naturalKey = stableNaturalKey(['tradeshow', eventSlug, String(companyIds.length)])
    candidates.push({
      pattern: 'tradeshow_cluster',
      company_id: companyIds[0] ?? null, // anchor on first; full list in components
      components: {
        signals: attendees.map((a) => a.id as string),
        companies: companyIds,
        natural_key: naturalKey,
        event_slug: eventSlug,
        attendee_count: companyIds.length,
      },
      evidenceForLlm: [
        {
          kind: 'tradeshow_cluster',
          ref: `event:${eventSlug}`,
          detail: `${companyIds.length} accounts in your book attending ${eventSlug}`,
        },
      ],
    })
  }
  return candidates
}

/**
 * Tech stack swap — needs `tech_stack_change` signals which arrive
 * via BuiltWithAdapter (Section 4.3 stub). Until then returns empty.
 */
async function matchTechStackCompetitorSwap(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TriggerCandidate[]> {
  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
  const { data: signals } = await supabase
    .from('signals')
    .select('id, company_id, title, description, detected_at')
    .eq('tenant_id', tenantId)
    .eq('signal_type', 'tech_stack_change')
    .gte('detected_at', since)
    .limit(200)
  if (!signals || signals.length === 0) return []

  // Filter to swap events. Convention: BuiltWithAdapter tags swap
  // descriptions with `swap:competitor=<vendor>`.
  const candidates: TriggerCandidate[] = []
  for (const s of signals) {
    if (!s.company_id) continue
    const desc = (s.description as string | null) ?? ''
    if (!desc.includes('swap:competitor=')) continue
    const naturalKey = stableNaturalKey([
      'tech_stack_swap',
      s.company_id as string,
      s.id as string,
    ])
    candidates.push({
      pattern: 'tech_stack_competitor_swap',
      company_id: s.company_id as string,
      components: {
        signals: [s.id as string],
        companies: [s.company_id as string],
        natural_key: naturalKey,
      },
      evidenceForLlm: [
        {
          kind: 'tech_stack_change',
          ref: urn.signal(tenantId, s.id as string),
          detail: (s.title as string) ?? 'competitor swap',
        },
      ],
    })
  }
  return candidates
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * sha256 of the sorted parts joined. Stable across re-orderings so
 * the natural-key dedup works regardless of the matcher's input
 * iteration order.
 */
function stableNaturalKey(parts: string[]): string {
  const sorted = [...parts].sort().join('|')
  return createHash('sha256').update(sorted).digest('hex').slice(0, 32)
}
