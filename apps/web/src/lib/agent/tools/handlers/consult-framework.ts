import { z } from 'zod'

import {
  FRAMEWORK_SECTIONS,
  FRAMEWORK_SLUGS,
  buildFrameworkCitation,
  extractSection,
  listFrameworks,
  loadFramework,
  type FrameworkSection,
} from '../../knowledge/sales-frameworks'
import type { ToolHandler } from '../../tool-loader'

/**
 * `consult_sales_framework` — the deep-reference tool the agent calls when
 * it wants the verbatim playbook for one of the 16 frameworks (or just one
 * of its sections).
 *
 * Why a dedicated tool rather than dumping everything into the system
 * prompt?
 *   1. Token economy — 16 framework files is ~25k tokens; we keep them out
 *      of the hot path and only pay for the one the agent actually needs.
 *   2. Telemetry — `tool_called` events with `slug = consult_sales_framework`
 *      give us per-tenant attribution of which frameworks the agent reaches
 *      for, which the nightly attribution workflow can correlate with
 *      stage progression.
 *   3. Citation surface — the tool returns a structured citation that the
 *      citation extractor turns into a "Source: SPIN Selling, Rackham 1988"
 *      pill in the UI, satisfying cite-or-shut-up at the source.
 */

const slugEnum = z.enum(
  FRAMEWORK_SLUGS as unknown as readonly [string, ...string[]],
)
const focusEnum = z.enum(
  FRAMEWORK_SECTIONS as unknown as readonly [string, ...string[]],
)

export const consultFrameworkSchema = z.object({
  slug: slugEnum.describe(
    'The framework slug to consult. Must be one of the registered frameworks.',
  ),
  focus: focusEnum
    .optional()
    .describe(
      'Optional section to return only — e.g. "scaffold" for the verbatim moves, "pitfalls" for the gotchas. Omit to return the full body.',
    ),
  query: z
    .string()
    .min(3)
    .optional()
    .describe(
      'Optional natural-language query. When provided, the tool returns the TOP 2 framework chunks (~500 tokens) most semantically similar to the query, instead of the full framework body (~5k tokens). Use this when you only need targeted guidance — saves significant tokens. Falls back to full body when the embedding RPC is unavailable.',
    ),
})

export type ConsultFrameworkArgs = z.infer<typeof consultFrameworkSchema>

export interface ConsultFrameworkResult {
  data: {
    slug: string
    title: string
    focus: string | null
    /** The markdown content (full body or just the requested section). */
    content: string
    /** Compact metadata so the agent can reason about applicability. */
    metadata: {
      stages: string[]
      objects: string[]
      best_for: string[]
      conversion_levers: string[]
      attribution_tag: string
    }
    /**
     * The slugs of related frameworks the agent might consult next, to
     * encourage layering (e.g. SPIN + Pain Funnel for deep discovery).
     */
    related: string[]
  } | null
  error?: string
  citations: Array<{
    type: 'knowledge'
    source_type: 'framework'
    framework_slug: string
    title: string
    source: string
    url?: string
  }>
}

/**
 * The handler is role-neutral — every sales surface (Pipeline Coach,
 * Account Strategist, Leadership Lens) benefits from access to the
 * framework library. Role gating is therefore handled at the
 * tool_registry row, not here.
 *
 * Typed as `ToolHandler` (no generic parameter) so it's assignable to the
 * registry's default-generic signature. The strong arg type stays in
 * `ConsultFrameworkArgs` for callers that want it.
 */
export const consultFrameworkHandler: ToolHandler = {
  slug: 'consult_sales_framework',
  schema: consultFrameworkSchema,
  build: (ctx) => async (rawArgs) => {
    const args = rawArgs as ConsultFrameworkArgs
    const slug = args.slug
    const focus = args.focus as FrameworkSection | undefined
    const query = args.query
    const doc = loadFramework(slug)

    if (!doc) {
      return {
        data: null,
        error: `Unknown framework "${slug}". Available: ${FRAMEWORK_SLUGS.join(', ')}.`,
        citations: [],
      } satisfies ConsultFrameworkResult
    }

    let content: string

    // C5.2: chunk retrieval. When a query is provided AND the
    // embedding pipeline is available, fetch top-2 chunks (~500 toks)
    // instead of the full body (~5k toks). Soft-fail to the legacy
    // path on any error so the tool stays useful even before the
    // embeddings cron has run.
    let usedRagChunks = false
    if (query) {
      try {
        const { embedQuery } = await import('@/lib/agent/context/embed-query')
        const queryEmbedding = await embedQuery(query)
        const { data: chunks, error } = await ctx.supabase.rpc('match_framework_chunks', {
          query_embedding: queryEmbedding,
          match_threshold: 0.5,
          match_count: 2,
          filter_framework_slug: slug,
        })
        if (!error && chunks && chunks.length > 0) {
          content = chunks
            .map(
              (c: { section: string; content: string; similarity: number }) =>
                `### ${c.section} _(similarity: ${(c.similarity * 100).toFixed(0)}%)_\n\n${c.content}`,
            )
            .join('\n\n---\n\n')
          usedRagChunks = true
        } else {
          content = focus ? extractSection(doc, focus) : doc.content
        }
      } catch (err) {
        console.warn('[consult-framework] RAG fallback to full body:', err)
        content = focus ? extractSection(doc, focus) : doc.content
      }
    } else {
      content = focus ? extractSection(doc, focus) : doc.content
    }

    const related = recommendRelated(doc.slug)

    return {
      data: {
        slug: doc.slug,
        title: doc.title,
        focus: usedRagChunks ? 'rag-chunks' : focus ?? null,
        content: content || doc.content,
        metadata: {
          stages: doc.stages,
          objects: doc.objects,
          best_for: doc.best_for,
          conversion_levers: doc.conversion_levers,
          attribution_tag: `[framework: ${doc.slug.toUpperCase()}]`,
        },
        related,
      },
      citations: [buildFrameworkCitation(doc)],
    } satisfies ConsultFrameworkResult
  },
}

/**
 * Static, hand-curated "frameworks that pair well" map. Cheaper than
 * computing similarity on the fly and lets us encode the editorial
 * judgement that, say, SPIN pairs naturally with the Pain Funnel and
 * Solution Selling rather than with SNAP.
 */
const RELATED_MAP: Record<string, string[]> = {
  spin: ['pain-funnel', 'solution-selling', 'gap-selling'],
  meddpicc: ['neat-selling', 'value-selling', 'three-why'],
  challenger: ['command-of-message', 'value-selling', 'gap-selling'],
  sandler: ['pain-funnel', 'objection-handling', 'three-why'],
  'bant-anum': ['neat-selling', 'meddpicc', 'three-why'],
  'value-selling': ['command-of-message', 'meddpicc', 'gap-selling'],
  'gap-selling': ['solution-selling', 'value-selling', 'spin'],
  'solution-selling': ['spin', 'gap-selling', 'rain'],
  'neat-selling': ['meddpicc', 'three-why', 'bant-anum'],
  'command-of-message': ['value-selling', 'challenger', 'meddpicc'],
  'pain-funnel': ['sandler', 'spin', 'objection-handling'],
  jolt: ['objection-handling', 'sandler', 'value-selling'],
  rain: ['spin', 'solution-selling', 'pain-funnel'],
  snap: ['challenger', 'three-why', 'spin'],
  'three-why': ['meddpicc', 'neat-selling', 'jolt'],
  'objection-handling': ['jolt', 'sandler', 'pain-funnel'],
}

function recommendRelated(slug: string): string[] {
  return RELATED_MAP[slug] ?? []
}

/**
 * Convenience export for the agent route or admin UIs that want a
 * lightweight directory of available frameworks.
 */
export function listAvailableFrameworks() {
  return listFrameworks()
}
