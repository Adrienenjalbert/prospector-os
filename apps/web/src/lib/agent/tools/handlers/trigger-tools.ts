import { z } from 'zod'
import {
  urn,
  TRIGGER_PATTERN_LABELS,
  type TriggerPattern,
} from '@prospector/core'
import type { ToolHandler } from '../../tool-loader'

/**
 * Trigger + Bridge tool bundle (Phase 7, Section 5).
 *
 * Four agent-callable tools that surface the new composite trigger
 * + relationship-graph layer to the rep mid-conversation:
 *
 *   - find_warm_intros          : "How can I get into Acme?"
 *                                 → top-3 inbound bridges_to with
 *                                 bridging contacts + recommended
 *                                 draft tool.
 *   - find_active_buyers        : "Who should I prioritise this week?"
 *                                 → open triggers ordered by
 *                                 trigger_score desc.
 *   - summarise_trigger         : "Why is this account hot?" →
 *                                 rationale + component URNs +
 *                                 suggested 3-step play.
 *   - compose_trigger_explanation
 *                              : Pre-call brief generation — all
 *                                 open triggers for a company,
 *                                 ranked, with bridge composition.
 *
 * Tier-2 doctrine compliance: typed Zod schemas, `{ data, citations }`
 * outputs, errors returned not thrown, tenant-scoped queries.
 */

// ===========================================================================
// find_warm_intros
// ===========================================================================

export const findWarmIntrosSchema = z.object({
  company_id: z
    .string()
    .uuid()
    .describe('UUID of the target company. Must exist in the tenant ontology.'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('Cap on returned bridges. Default 3.'),
})

export type FindWarmIntrosArgs = z.infer<typeof findWarmIntrosSchema>

interface BridgeRow {
  edge_id: string
  source_company_id: string
  source_company_name: string | null
  bridging_contacts: Array<{
    contact_id: string
    name: string | null
  }>
  weight: number
  miner: string
}

export const findWarmIntrosHandler: ToolHandler = {
  slug: 'find_warm_intros',
  schema: findWarmIntrosSchema,
  build: (ctx) => async (args) => {
    const { company_id, max_results = 3 } = args as FindWarmIntrosArgs

    const { data: edges, error } = await ctx.supabase
      .from('memory_edges')
      .select('id, src_id, src_kind, weight, evidence')
      .eq('tenant_id', ctx.tenantId)
      .eq('edge_kind', 'bridges_to')
      .eq('dst_kind', 'company')
      .eq('dst_id', company_id)
      .order('weight', { ascending: false })
      .limit(max_results * 2) // fetch extra so we can drop self-bridges

    if (error) {
      return { error: `find_warm_intros: ${error.message}` }
    }
    const inboundEdges = (edges ?? []).filter(
      (e) => e.src_kind === 'company' && e.src_id !== company_id,
    )
    if (inboundEdges.length === 0) {
      return {
        data: { bridges: [], message: 'No warm-intro bridges detected for this company.' },
        citations: [],
      }
    }

    // Hydrate source company names + bridging contact names.
    const sourceCompanyIds = [...new Set(inboundEdges.map((e) => e.src_id as string))]
    const { data: companies } = await ctx.supabase
      .from('companies')
      .select('id, name')
      .eq('tenant_id', ctx.tenantId)
      .in('id', sourceCompanyIds)
    const companyById = new Map(
      (companies ?? []).map((c) => [c.id as string, c.name as string]),
    )

    // Bridging contacts come from the edge.evidence field
    // (mine-reverse-alumni populates `bridging_contact_id`;
    // mine-coworker-triangles populates `bridging_contacts: [a, b]`).
    const allContactIds: string[] = []
    for (const e of inboundEdges) {
      const ev = (e.evidence ?? {}) as {
        bridging_contact_id?: string
        bridging_contacts?: string[]
      }
      if (ev.bridging_contact_id) allContactIds.push(ev.bridging_contact_id)
      if (Array.isArray(ev.bridging_contacts)) allContactIds.push(...ev.bridging_contacts)
    }
    const uniqueContactIds = [...new Set(allContactIds)]
    const { data: contacts } = uniqueContactIds.length
      ? await ctx.supabase
          .from('contacts')
          .select('id, first_name, last_name')
          .eq('tenant_id', ctx.tenantId)
          .in('id', uniqueContactIds)
      : { data: [] }
    const contactById = new Map(
      (contacts ?? []).map((c) => [
        c.id as string,
        `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || (c.id as string),
      ]),
    )

    const bridges: BridgeRow[] = inboundEdges.slice(0, max_results).map((e) => {
      const ev = (e.evidence ?? {}) as {
        bridging_contact_id?: string
        bridging_contacts?: string[]
        miner?: string
      }
      const contactIds: string[] = []
      if (ev.bridging_contact_id) contactIds.push(ev.bridging_contact_id)
      if (Array.isArray(ev.bridging_contacts)) contactIds.push(...ev.bridging_contacts)
      return {
        edge_id: e.id as string,
        source_company_id: e.src_id as string,
        source_company_name: companyById.get(e.src_id as string) ?? null,
        bridging_contacts: contactIds.map((cid) => ({
          contact_id: cid,
          name: contactById.get(cid) ?? null,
        })),
        weight: Number(e.weight),
        miner: ev.miner ?? 'unknown',
      }
    })

    return {
      data: {
        bridges,
        recommended_tool: 'draft_alumni_intro',
        target_company_urn: urn.company(ctx.tenantId, company_id),
      },
      citations: bridges.map((b) => ({
        claim_text: b.source_company_name
          ? `Warm path via ${b.source_company_name}`
          : 'Warm bridge',
        source_type: 'company',
        source_id: b.source_company_id,
      })),
    }
  },
}

// ===========================================================================
// find_active_buyers
// ===========================================================================

export const findActiveBuyersSchema = z.object({
  pattern: z
    .string()
    .optional()
    .describe(
      "Optional trigger pattern slug to filter on (e.g. 'funding_plus_leadership_window').",
    ),
  min_score: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Minimum trigger_score to return. Default 0.5.'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Cap on returned triggers. Default 5.'),
})

export type FindActiveBuyersArgs = z.infer<typeof findActiveBuyersSchema>

export const findActiveBuyersHandler: ToolHandler = {
  slug: 'find_active_buyers',
  schema: findActiveBuyersSchema,
  build: (ctx) => async (args) => {
    const { pattern, min_score = 0.5, max_results = 5 } = args as FindActiveBuyersArgs

    let q = ctx.supabase
      .from('triggers')
      .select(
        'id, pattern, company_id, opportunity_id, trigger_score, rationale, recommended_action, recommended_tool, detected_at',
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'open')
      .gte('trigger_score', min_score)
      .order('trigger_score', { ascending: false })
      .limit(max_results)

    if (pattern) q = q.eq('pattern', pattern)

    const { data: rows, error } = await q
    if (error) return { error: `find_active_buyers: ${error.message}` }

    const triggers = (rows ?? []) as Array<{
      id: string
      pattern: TriggerPattern
      company_id: string | null
      trigger_score: number
      rationale: string
      recommended_action: string | null
      recommended_tool: string | null
      detected_at: string
    }>

    if (triggers.length === 0) {
      return {
        data: {
          triggers: [],
          message: pattern
            ? `No open triggers with pattern '${pattern}' (score >= ${min_score}).`
            : `No open triggers (score >= ${min_score}).`,
        },
        citations: [],
      }
    }

    // Hydrate company names for the triggers.
    const companyIds = [
      ...new Set(triggers.map((t) => t.company_id).filter(Boolean) as string[]),
    ]
    const { data: companies } = companyIds.length
      ? await ctx.supabase
          .from('companies')
          .select('id, name')
          .eq('tenant_id', ctx.tenantId)
          .in('id', companyIds)
      : { data: [] }
    const companyById = new Map(
      (companies ?? []).map((c) => [c.id as string, c.name as string]),
    )

    return {
      data: {
        triggers: triggers.map((t) => ({
          trigger_id: t.id,
          urn: urn.trigger(ctx.tenantId, t.id),
          pattern: t.pattern,
          pattern_label: TRIGGER_PATTERN_LABELS[t.pattern] ?? t.pattern,
          company_id: t.company_id,
          company_name: t.company_id ? companyById.get(t.company_id) ?? null : null,
          trigger_score: t.trigger_score,
          rationale: t.rationale,
          recommended_action: t.recommended_action,
          recommended_tool: t.recommended_tool,
          detected_at: t.detected_at,
        })),
      },
      citations: triggers
        .filter((t) => t.company_id)
        .map((t) => ({
          claim_text: companyById.get(t.company_id!) ?? t.rationale.slice(0, 80),
          source_type: 'company',
          source_id: t.company_id!,
        })),
    }
  },
}

// ===========================================================================
// summarise_trigger
// ===========================================================================

export const summariseTriggerSchema = z.object({
  trigger_id: z.string().uuid().describe('UUID of the trigger to summarise.'),
})

export type SummariseTriggerArgs = z.infer<typeof summariseTriggerSchema>

export const summariseTriggerHandler: ToolHandler = {
  slug: 'summarise_trigger',
  schema: summariseTriggerSchema,
  build: (ctx) => async (args) => {
    const { trigger_id } = args as SummariseTriggerArgs

    const { data: trigger, error } = await ctx.supabase
      .from('triggers')
      .select(
        'id, pattern, company_id, components, trigger_score, rationale, recommended_action, recommended_tool, status, detected_at, expires_at',
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('id', trigger_id)
      .maybeSingle()
    if (error || !trigger) return { error: 'trigger_not_found' }

    const components = (trigger.components ?? {}) as {
      signals?: string[]
      bridges?: string[]
      contacts?: string[]
      companies?: string[]
    }

    // Hydrate signal titles for the rationale.
    const signalIds = components.signals ?? []
    const { data: signals } = signalIds.length
      ? await ctx.supabase
          .from('signals')
          .select('id, signal_type, title, weighted_score')
          .eq('tenant_id', ctx.tenantId)
          .in('id', signalIds)
      : { data: [] }

    const citations: Array<{ claim_text: string; source_type: string; source_id: string }> = []
    if (trigger.company_id) {
      citations.push({
        claim_text: trigger.rationale.slice(0, 100),
        source_type: 'company',
        source_id: trigger.company_id as string,
      })
    }
    for (const s of signals ?? []) {
      citations.push({
        claim_text: (s.title as string) ?? (s.signal_type as string),
        source_type: 'signal',
        source_id: s.id as string,
      })
    }

    return {
      data: {
        trigger_id: trigger.id,
        urn: urn.trigger(ctx.tenantId, trigger.id as string),
        pattern: trigger.pattern,
        pattern_label:
          TRIGGER_PATTERN_LABELS[trigger.pattern as TriggerPattern] ?? (trigger.pattern as string),
        rationale: trigger.rationale,
        trigger_score: trigger.trigger_score,
        status: trigger.status,
        recommended_action: trigger.recommended_action,
        recommended_tool: trigger.recommended_tool,
        components: {
          signals: signals ?? [],
          bridge_count: components.bridges?.length ?? 0,
          contact_count: components.contacts?.length ?? 0,
        },
        detected_at: trigger.detected_at,
        expires_at: trigger.expires_at,
      },
      citations,
    }
  },
}

// ===========================================================================
// compose_trigger_explanation
// ===========================================================================

export const composeTriggerExplanationSchema = z.object({
  company_id: z.string().uuid().describe('UUID of the company to compose triggers for.'),
})

export type ComposeTriggerExplanationArgs = z.infer<typeof composeTriggerExplanationSchema>

export const composeTriggerExplanationHandler: ToolHandler = {
  slug: 'compose_trigger_explanation',
  schema: composeTriggerExplanationSchema,
  build: (ctx) => async (args) => {
    const { company_id } = args as ComposeTriggerExplanationArgs

    const { data: triggers, error } = await ctx.supabase
      .from('triggers')
      .select('id, pattern, trigger_score, rationale, recommended_action, recommended_tool, status, detected_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('company_id', company_id)
      .in('status', ['open', 'acted'])
      .order('trigger_score', { ascending: false })
      .limit(10)
    if (error) return { error: `compose_trigger_explanation: ${error.message}` }

    const rows = (triggers ?? []) as Array<{
      id: string
      pattern: TriggerPattern
      trigger_score: number
      rationale: string
      recommended_action: string | null
      recommended_tool: string | null
      status: string
      detected_at: string
    }>

    if (rows.length === 0) {
      return {
        data: {
          company_id,
          triggers: [],
          message: 'No open or recently-acted triggers for this company.',
        },
        citations: [],
      }
    }

    return {
      data: {
        company_id,
        company_urn: urn.company(ctx.tenantId, company_id),
        triggers: rows.map((t) => ({
          trigger_id: t.id,
          urn: urn.trigger(ctx.tenantId, t.id),
          pattern: t.pattern,
          pattern_label: TRIGGER_PATTERN_LABELS[t.pattern] ?? t.pattern,
          score: t.trigger_score,
          rationale: t.rationale,
          recommended_action: t.recommended_action,
          recommended_tool: t.recommended_tool,
          status: t.status,
          detected_at: t.detected_at,
        })),
        // Headline: the strongest open trigger gets surfaced as the
        // pre-call brief's "why now" line.
        headline: rows[0].rationale,
      },
      citations: [
        {
          claim_text: 'Account neighbourhood',
          source_type: 'company',
          source_id: company_id,
        },
        ...rows.slice(0, 3).map((t) => ({
          claim_text: t.rationale.slice(0, 80),
          source_type: 'trigger',
          source_id: t.id,
        })),
      ],
    }
  },
}
