import { z } from 'zod'
import { parseUrn } from '@prospector/core'

import {
  SLICE_SLUGS,
  SLICES,
  getSlice,
  type SliceLoadCtx,
} from '../../context'
import type { ToolHandler } from '../../tool-loader'

/**
 * `hydrate_context` — on-demand slice loader. Mirrors the
 * `consult_sales_framework` pattern exactly: Zod enum, structured output,
 * citation collection via the existing extractor pattern.
 *
 * The agent calls this when it wants depth on one specific slice that
 * either wasn't selected by the per-turn packer (different intent than
 * the rep articulated) or when it needs to refresh after a follow-up
 * question shifts focus.
 *
 * Phase 2 surface — Phase 4 will add `args.fresh` to bypass cache and
 * call adapters directly, plus a per-tenant call quota.
 */

const slugEnum = z.enum(
  SLICE_SLUGS as unknown as readonly [string, ...string[]],
)

export const hydrateContextSchema = z.object({
  slice: slugEnum.describe('Slice slug to load. Each slice declares its own scope and budget.'),
  active_company_urn: z
    .string()
    .optional()
    .describe('Override the active company URN — useful when the rep asks about a different company than the active object.'),
  active_deal_urn: z
    .string()
    .optional()
    .describe('Override the active deal URN.'),
})

export type HydrateContextArgs = z.infer<typeof hydrateContextSchema>

interface HydrateContextResult {
  data: {
    slug: string
    title: string
    rendered: string
    rows_count: number
    tokens_estimate: number
    duration_ms: number
    source: 'db' | 'adapter' | 'cache'
    warnings: string[]
  } | null
  error?: string
  citations: Array<{
    claim_text: string
    source_type: string
    source_id?: string
    source_url?: string
  }>
}

export const hydrateContextHandler: ToolHandler = {
  slug: 'hydrate_context',
  schema: hydrateContextSchema,
  build: (toolCtx) => async (rawArgs) => {
    const args = rawArgs as HydrateContextArgs
    const slice = getSlice(args.slice)

    if (!slice) {
      return {
        data: null,
        error: `Unknown slice "${args.slice}". Available: ${SLICE_SLUGS.join(', ')}.`,
        citations: [],
      } satisfies HydrateContextResult
    }

    // Resolve override URNs to ids when provided. Falls back to whatever
    // is in the tool context's activeUrn so the agent can call the tool
    // with no args to re-hydrate the current scope.
    let activeCompanyId: string | null = null
    let activeDealId: string | null = null

    const dealOverride = args.active_deal_urn ? parseUrn(args.active_deal_urn) : null
    const companyOverride = args.active_company_urn
      ? parseUrn(args.active_company_urn)
      : null

    if (dealOverride && (dealOverride.type === 'deal' || dealOverride.type === 'opportunity')) {
      activeDealId = dealOverride.id
    } else if (companyOverride && companyOverride.type === 'company') {
      activeCompanyId = companyOverride.id
    } else if (toolCtx.activeUrn) {
      const parsed = parseUrn(toolCtx.activeUrn)
      if (parsed?.type === 'company') activeCompanyId = parsed.id
      if (parsed?.type === 'deal' || parsed?.type === 'opportunity') activeDealId = parsed.id
    }

    const sliceCtx: SliceLoadCtx = {
      tenantId: toolCtx.tenantId,
      repId: toolCtx.repId,
      userId: toolCtx.userId,
      role: (toolCtx.role || 'rep') as SliceLoadCtx['role'],
      activeUrn: toolCtx.activeUrn,
      activeObject: activeDealId ? 'deal' : activeCompanyId ? 'company' : 'none',
      activeCompanyId,
      activeDealId,
      pageContext: undefined,
      intentClass: 'general_query',
      crmType: null,
      supabase: toolCtx.supabase,
      deadlineMs: Date.now() + slice.soft_timeout_ms + 500,
    }

    let result
    try {
      result = await slice.load(sliceCtx)
    } catch (err) {
      return {
        data: null,
        error: `Slice ${args.slice} failed to load: ${err instanceof Error ? err.message : String(err)}`,
        citations: [],
      } satisfies HydrateContextResult
    }

    // Pass `tenantId` so slices that emit URNs via `urnInline()` produce
    // canonical `urn:rev:{tenantId}:{type}:{id}` strings. Without this the
    // helper falls back to an empty tenant segment, which breaks the
    // citation pill regex in `extractUrnsFromText` and orphans the
    // `context_slice_consumed` event payload the bandit reads from.
    const rendered = slice.formatForPrompt(result.rows, {
      tenantId: toolCtx.tenantId,
    })

    return {
      data: {
        slug: slice.slug,
        title: slice.title,
        rendered,
        rows_count: result.rows.length,
        tokens_estimate: Math.ceil(rendered.length / 4),
        duration_ms: result.provenance.duration_ms,
        source: result.provenance.source,
        warnings: result.warnings ?? [],
      },
      citations: result.citations,
    } satisfies HydrateContextResult
  },
}
