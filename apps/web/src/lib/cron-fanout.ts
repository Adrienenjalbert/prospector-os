/**
 * Bounded-concurrency fleet fan-out for cron routes.
 *
 * Pre-this-helper, the production cron routes (`/api/cron/sync`,
 * `/api/cron/score`, `/api/cron/signals`, `/api/cron/enrich`)
 * processed tenants strictly sequentially:
 *
 *     for (const tenant of tenants) {
 *       await syncOne(tenant)   // one slow tenant blocks all the rest
 *     }
 *
 * `/api/cron/learning` already uses the bounded-chunk pattern (see
 * the inline rationale there) — this helper extracts it so the same
 * shape can be applied everywhere with a single import.
 *
 * Why bounded concurrency rather than `Promise.all` over the full list?
 *
 *   - Postgres has a finite connection pool (Supabase free tier is
 *     ~60). Fanning out 1000 tenants in parallel would saturate it.
 *   - External APIs (HubSpot, Apollo, OpenAI) all have per-second
 *     rate ceilings that crater past `~10` concurrent calls per key.
 *   - The cron's wall-clock budget on Vercel is bounded; chunking
 *     keeps memory steady and lets the previous chunk's connections
 *     close before the next chunk grabs new ones.
 *
 * Failures from one tenant never block the others. The helper uses
 * `Promise.allSettled` per chunk and aggregates per-tenant outcomes
 * so the caller can return `partial` status when SOME but not ALL
 * tenants succeeded.
 */

export interface FanoutResult<T> {
  ok: number
  failed: number
  records: number
  errors: Array<{ tenantId: string; error: string }>
  values: T[]
}

export interface FanoutOptions {
  /**
   * Tenants per chunk. Default 10 — comfortable for most workloads
   * and keeps every per-tenant operation well within Postgres' pool.
   * For light enqueue-only crons you can raise to 25.
   */
  chunkSize?: number
  /**
   * Optional log-prefix (`[cron/sync]`) for the per-tenant failure
   * console.warn lines. Strongly recommended — silent fan-out
   * failures are the hardest cron bugs to debug.
   */
  logPrefix?: string
}

/**
 * Run `fn` for every tenant in `tenants`, in chunks of `chunkSize`,
 * collecting successes + failures + per-tenant return values.
 *
 * `fn` may return any value the caller wants aggregated (e.g. a row
 * count); the value is captured in `values` for fulfilled tenants
 * and `records` is set to the sum of numeric returns when present.
 *
 *     const result = await forEachTenantChunked(tenants, async (t) => {
 *       return await syncOneTenant(t.id)  // returns row count
 *     }, { logPrefix: '[cron/sync]' })
 *
 *     console.log(`Synced ${result.records} rows across ${result.ok}/${result.ok + result.failed} tenants`)
 */
export async function forEachTenantChunked<T>(
  tenants: ReadonlyArray<{ id: string }>,
  fn: (tenant: { id: string }) => Promise<T>,
  opts: FanoutOptions = {},
): Promise<FanoutResult<T>> {
  const chunkSize = opts.chunkSize ?? 10
  const prefix = opts.logPrefix ?? '[cron-fanout]'

  const out: FanoutResult<T> = {
    ok: 0,
    failed: 0,
    records: 0,
    errors: [],
    values: [],
  }

  for (let i = 0; i < tenants.length; i += chunkSize) {
    const slice = tenants.slice(i, i + chunkSize)
    const settled = await Promise.allSettled(slice.map((t) => fn(t)))

    for (let j = 0; j < settled.length; j++) {
      const result = settled[j]
      const tenant = slice[j]
      if (result.status === 'fulfilled') {
        out.ok++
        out.values.push(result.value)
        if (typeof result.value === 'number') {
          out.records += result.value
        }
      } else {
        out.failed++
        const message =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
        out.errors.push({ tenantId: tenant.id, error: message })
        // Always log so silent fan-out failure isn't possible.
        console.warn(
          `${prefix} tenant=${tenant.id} fan-out failure: ${message}`,
        )
      }
    }
  }

  return out
}

/**
 * Convenience for callers that just want `success | partial | error`
 * without re-implementing the same `if (failed > 0)` ladder. Returns
 * the matching `cron_runs.status` literal.
 */
export function statusFor(result: FanoutResult<unknown>): 'success' | 'partial' | 'error' {
  if (result.ok > 0 && result.failed === 0) return 'success'
  if (result.ok === 0 && result.failed > 0) return 'error'
  return 'partial'
}
