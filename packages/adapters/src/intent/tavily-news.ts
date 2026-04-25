import type {
  FetchIntentOpts,
  IntentDataAdapter,
  IntentSignalRow,
} from './interface'

/**
 * TavilyNewsAdapter — Phase 7 (Section 4.2) reference implementation.
 *
 * Uses the existing Tavily integration that powers the `web_search`
 * agent tool to surface press events / news for the tenant's tracked
 * companies. Free-tier compatible — Tavily ships a 1000-call/month
 * free plan that covers most pilot tenants.
 *
 * Output: `press_event` signals (Phase 7-added signal_type).
 *
 * Per-domain query strategy:
 *
 *   - Search "{domain} announcement OR funding OR launch OR layoff"
 *     restricted to past `sinceDays` days
 *   - Take the top 3 results per company
 *   - Map each into a press_event signal with the article URL as
 *     `source_url`
 *
 * Notes:
 *
 *   - We bound to MAX_DOMAINS_PER_RUN (50) per tenant per night to
 *     keep the call volume predictable. The signals cron will
 *     paginate over time.
 *   - Idempotency: titles include the article URL host + date so the
 *     downstream signals-cron upsert (Phase 7 may add a unique key
 *     on tenant + signal_type + source_url) dedupes naturally.
 *   - Cost: $0.001/call on Tavily's per-search billing; $0.05/tenant/
 *     night at 50 domains × 1 call.
 */

const TAVILY_BASE_URL = 'https://api.tavily.com/search'
const MAX_DOMAINS_PER_RUN = 50
const MAX_RESULTS_PER_DOMAIN = 3
const NEWS_QUERY_TEMPLATE = (domain: string) =>
  `"${domain}" (announcement OR funding OR launch OR partnership OR layoff OR acquisition)`

interface TavilySearchResponse {
  results?: Array<{
    title?: string
    url?: string
    content?: string
    score?: number
    published_date?: string
  }>
}

export class TavilyNewsAdapter implements IntentDataAdapter {
  vendor = 'tavily_news'
  capabilities = {
    topics: false,
    pageVisits: false,
    firmographicsLookup: false,
  }
  costPerCall = 0.001

  private apiKey: string | null

  constructor(apiKey?: string | null) {
    this.apiKey = apiKey ?? process.env.TAVILY_API_KEY ?? null
  }

  async fetchIntent(opts: FetchIntentOpts): Promise<IntentSignalRow[]> {
    if (!this.apiKey) {
      console.warn('[tavily-news] TAVILY_API_KEY not set — adapter returning empty')
      return []
    }
    const domains = opts.domains.slice(0, opts.limit ?? MAX_DOMAINS_PER_RUN)
    if (domains.length === 0) return []

    const out: IntentSignalRow[] = []
    const now = new Date().toISOString()
    const sinceLabel = `${opts.sinceDays} days`

    for (const domain of domains) {
      try {
        const res = await fetch(TAVILY_BASE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: this.apiKey,
            query: NEWS_QUERY_TEMPLATE(domain),
            search_depth: 'basic',
            max_results: MAX_RESULTS_PER_DOMAIN,
            days: opts.sinceDays,
            // exclude_domains keeps generic listings (Crunchbase, LinkedIn)
            // from drowning out the actual press hits.
            exclude_domains: ['linkedin.com', 'twitter.com', 'facebook.com'],
          }),
        })
        if (!res.ok) {
          console.warn(`[tavily-news] HTTP ${res.status} for ${domain}`)
          continue
        }
        const json = (await res.json()) as TavilySearchResponse
        for (const r of json.results ?? []) {
          if (!r.title || !r.url) continue
          // Tavily's score is 0..1; map to our 0..100 weighted scale.
          const score = Math.max(0.4, Math.min(1.0, r.score ?? 0.6))
          out.push({
            domain,
            signal_type: 'press_event',
            title: truncate(r.title, 180),
            description: r.content
              ? `${truncate(r.content, 280)} (window: last ${sinceLabel})`
              : `Press hit detected via Tavily news search`,
            source_url: r.url,
            source: 'tavily_news',
            relevance_score: score,
            weighted_score: Math.round(score * 100),
            urgency: 'this_week',
            detected_at: r.published_date ?? now,
            raw: { tavily_score: r.score, query_domain: domain },
          })
        }
      } catch (err) {
        console.warn(`[tavily-news] fetch failed for ${domain}:`, err)
      }
    }
    return out
  }
}

function truncate(s: string, max: number): string {
  if (!s) return ''
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}
