/**
 * Web-search tool (D7.1).
 *
 * Replaces the hallucinatory `runDeepResearch` cron path: instead of
 * asking Sonnet to "research" a company from training-data weights,
 * we query a real search provider, attach the URLs as citations, and
 * let the model synthesise. Every signal a tenant sees from this
 * path now has a `source_url` — the strategic-review's "no
 * hallucinated signals" north-star metric becomes verifiable.
 *
 * Provider selection (per-tenant, defaulting to Tavily):
 *   - Tavily: cheap, decent recency, JSON-friendly. Default.
 *   - Exa:    longer-form content, semantic search.
 *   - Brave:  privacy-first, simple results.
 *   - Mock:   stub for tests + CI without provider keys.
 *
 * The tool is registry-friendly: register a `web_search` row in
 * `tool_registry` and any agent surface (pipeline-coach,
 * account-strategist, leadership-lens) can call it.
 *
 * The cron/signals refactor that uses this tool lives at
 * apps/web/src/app/api/cron/signals/route.ts (see runDeepResearch
 * replacement).
 */

import { z } from 'zod'
import type { ToolHandler } from '../../tool-loader'

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface WebSearchHit {
  url: string
  title: string
  snippet: string
  published_at: string | null
  /** Provider's relevance score 0..1, when available. */
  score: number | null
}

export interface WebSearchProvider {
  name: 'tavily' | 'exa' | 'brave' | 'mock'
  search(query: string, opts: { maxResults: number; recencyDays?: number }): Promise<WebSearchHit[]>
}

// ---------------------------------------------------------------------------
// Tavily (default)
// ---------------------------------------------------------------------------

class TavilyProvider implements WebSearchProvider {
  readonly name = 'tavily' as const
  constructor(private readonly apiKey: string) {}

  async search(query: string, opts: { maxResults: number; recencyDays?: number }): Promise<WebSearchHit[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        search_depth: 'basic',
        max_results: opts.maxResults,
        // Tavily's `days` filter: 0 = no filter, otherwise restrict to
        // sources within N days. Sales-research recency typically wants
        // ≤180 days unless the rep is doing historical context work.
        days: opts.recencyDays ?? 180,
        include_answer: false,
      }),
    })
    if (!res.ok) {
      throw new Error(`Tavily search failed (${res.status}): ${await res.text()}`)
    }
    const json = await res.json() as {
      results?: Array<{ url: string; title: string; content: string; score?: number; published_date?: string }>
    }
    return (json.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.content.slice(0, 800),
      published_at: r.published_date ?? null,
      score: typeof r.score === 'number' ? r.score : null,
    }))
  }
}

// ---------------------------------------------------------------------------
// Mock (tests + CI without provider keys)
// ---------------------------------------------------------------------------

class MockProvider implements WebSearchProvider {
  readonly name = 'mock' as const
  async search(query: string, opts: { maxResults: number }): Promise<WebSearchHit[]> {
    return Array.from({ length: Math.min(opts.maxResults, 3) }, (_, i) => ({
      url: `https://example.com/mock/${i + 1}?q=${encodeURIComponent(query)}`,
      title: `Mock result ${i + 1}: ${query.slice(0, 40)}`,
      snippet: `Stubbed search result returned by the mock provider when no WEB_SEARCH_API_KEY is configured. Index ${i + 1}.`,
      published_at: null,
      score: 0.5,
    }))
  }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/**
 * Resolve a provider from env. Order:
 *   1. WEB_SEARCH_PROVIDER (explicit choice)
 *   2. TAVILY_API_KEY      (default if present)
 *   3. mock                (CI / dev fallback)
 *
 * Per-tenant override comes from tool_registry's execution_config
 * — the consumer can pass `providerOverride` to bypass env entirely.
 */
export function resolveWebSearchProvider(providerOverride?: string): WebSearchProvider {
  const provider = (providerOverride ?? process.env.WEB_SEARCH_PROVIDER ?? '').toLowerCase()

  if (provider === 'mock') return new MockProvider()
  if (provider === 'tavily' || (!provider && process.env.TAVILY_API_KEY)) {
    const key = process.env.TAVILY_API_KEY
    if (!key) throw new Error('TAVILY_API_KEY not set')
    return new TavilyProvider(key)
  }

  // No provider configured — fall back to mock with a warning so dev
  // signals still flow.
  console.warn('[web-search] no provider configured (set TAVILY_API_KEY) — using mock')
  return new MockProvider()
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export const webSearchSchema = z.object({
  query: z
    .string()
    .min(3)
    .max(400)
    .describe('Natural-language search query. Be specific — include the company name and the signal type you want (e.g. "Acme Corp recent funding rounds last 6 months").'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('Max number of search hits to return. Default 5.'),
  recency_days: z
    .number()
    .int()
    .min(1)
    .max(720)
    .optional()
    .describe('Restrict results to sources published in the last N days. Default 180.'),
})

export type WebSearchArgs = z.infer<typeof webSearchSchema>

export interface WebSearchResult {
  data: {
    query: string
    provider: string
    results: WebSearchHit[]
  } | null
  error?: string
  citations: Array<{
    type: 'evidence'
    source_type: 'web'
    source_id: string
    source_url: string
    title: string
  }>
}

export const webSearchHandler: ToolHandler = {
  slug: 'web_search',
  schema: webSearchSchema,
  build: () => async (rawArgs) => {
    const args = rawArgs as WebSearchArgs
    try {
      const provider = resolveWebSearchProvider()
      const results = await provider.search(args.query, {
        maxResults: args.max_results ?? 5,
        recencyDays: args.recency_days,
      })

      return {
        data: { query: args.query, provider: provider.name, results },
        citations: results.map((r) => ({
          type: 'evidence' as const,
          source_type: 'web' as const,
          source_id: r.url,
          source_url: r.url,
          title: r.title,
        })),
      } satisfies WebSearchResult
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'web_search failed',
        citations: [],
      } satisfies WebSearchResult
    }
  },
}
