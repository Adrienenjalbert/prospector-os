import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Per-user rate limiter for expensive routes (chat agent, on-demand
 * enrichment, workflow re-runs). Uses `agent_events` as the count
 * source so it works without a separate Redis or KV — the same table
 * the bandit and ROI pipelines already write to handles the read.
 *
 * Why a DB-backed limiter rather than in-memory or Redis?
 *
 *   - In-memory state (`Map<userId, count>`) doesn't survive serverless
 *     cold-starts or horizontal scale — every Vercel function instance
 *     has its own counter, so the actual limit is `N × instances`.
 *     The agent route is the most expensive endpoint we have; an
 *     in-memory limit is essentially no limit.
 *   - Redis would work but is another dependency, another vendor, and
 *     would need its own region pinning per tenant.
 *   - `agent_events` is already the global event log every agent turn
 *     writes to; an indexed `count(*) WHERE event_type='interaction_started'
 *     AND user_id=X AND occurred_at > now()-1m` is sub-10ms with the
 *     existing index on `(tenant_id, occurred_at DESC)`.
 *
 * Default cap: 10 requests / minute / user. Enough for a normal chat
 * conversation; will trip a script that hammers the route.
 */

export interface RateLimitCheck {
  allowed: boolean
  used: number
  limit: number
  reason?: 'over_limit'
  /** Seconds until the user can retry. Surfaced as `Retry-After`. */
  retryAfterSec: number
}

const WINDOW_MS = 60_000

export interface RateLimitOptions {
  /** Requests per window (default 60s). Default 10. */
  limit?: number
  /** Window length in ms. Default 60_000. */
  windowMs?: number
  /** Event type to count. Default `'interaction_started'`. */
  eventType?: string
}

export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  opts: RateLimitOptions = {},
): Promise<RateLimitCheck> {
  const limit = opts.limit ?? 10
  const windowMs = opts.windowMs ?? WINDOW_MS
  const eventType = opts.eventType ?? 'interaction_started'

  const since = new Date(Date.now() - windowMs).toISOString()

  const { count } = await supabase
    .from('agent_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', eventType)
    .gte('occurred_at', since)

  const used = count ?? 0
  if (used >= limit) {
    return {
      allowed: false,
      used,
      limit,
      reason: 'over_limit',
      retryAfterSec: Math.ceil(windowMs / 1000),
    }
  }
  return {
    allowed: true,
    used,
    limit,
    retryAfterSec: 0,
  }
}

/**
 * Build the standard 429 response body + headers for a denied check.
 * The `Retry-After` header is what HTTP clients (and our chat hook)
 * key off — without it, a hammering script just retries instantly.
 */
export function rateLimitResponse(check: RateLimitCheck): Response {
  return new Response(
    JSON.stringify({
      error: 'Rate limit exceeded',
      limit: check.limit,
      used: check.used,
      retry_after_sec: check.retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(check.retryAfterSec),
        'X-RateLimit-Limit': String(check.limit),
        'X-RateLimit-Remaining': String(Math.max(0, check.limit - check.used)),
      },
    },
  )
}
