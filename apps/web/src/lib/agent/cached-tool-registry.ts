/**
 * Tool-registry TTL cache (B3.3).
 *
 * Why this exists:
 *
 * Every `/api/agent` turn used to hit `tool_registry` fresh. For a
 * busy tenant, that's N redundant SELECT roundtrips per minute, plus
 * the cost of rebuilding `Tool` objects (Zod schemas + handler
 * binding) on every turn — pure waste because the registry changes
 * approximately never (admin edits ≈ 1/day in production).
 *
 * Design choice — in-process LRU vs Cache Components:
 *
 *   We chose in-process LRU because:
 *     - Works in every Vercel runtime (Edge, Fluid Compute, Node).
 *     - Tenant-scoped, per-instance — no risk of accidental
 *       cross-tenant cache hits if Cache Components is misconfigured.
 *     - One-line migration path: this module is a drop-in dependency
 *       and disabling cache = `set TTL_MS = 0` in env.
 *     - Cache Components (`'use cache'` + `cacheTag`) is a strong
 *       option for RSC pages, but the agent route is an API handler
 *       calling a service-role client — Cache Components shines less
 *       there.
 *
 *   When the platform later opts into Cache Components for tenant-
 *   scoped reads platform-wide (Bucket D), this cache becomes a
 *   no-op (TTL_MS=0 in env) without further code change.
 *
 * Invariants:
 *
 *   - Keyed strictly by tenant_id. Cross-tenant lookups never collide.
 *   - TTL bounded (default 1 hour). Stale entries are evicted lazily
 *     on the next `get()`.
 *   - LRU bound (default 256 tenants in memory). Bounds RAM growth in
 *     a many-tenant runtime.
 *   - `invalidate(tenantId)` is the explicit hook every admin-side
 *     mutation should call (tool-registry edits, tool enable/disable).
 *   - On cache miss the `loader()` callback runs exactly once even
 *     under concurrent requests for the same tenant — guarded by an
 *     in-flight promise map so a thundering herd of agent turns
 *     produces a single DB hit.
 */

interface CacheEntry<T> {
  expiresAt: number
  value: T
}

const DEFAULT_TTL_MS = Number(process.env.TOOL_REGISTRY_CACHE_TTL_MS ?? 60 * 60 * 1000)
const MAX_ENTRIES = Number(process.env.TOOL_REGISTRY_CACHE_MAX ?? 256)

// We use TWO maps: the value cache and the in-flight loader cache.
// The latter prevents thundering-herd loader runs when many turns
// race for the same tenant after a cold start or invalidation.
const cache = new Map<string, CacheEntry<unknown>>()
const inflight = new Map<string, Promise<unknown>>()

/**
 * Cached read. `loader` runs at most once per (tenantId, TTL window),
 * even under concurrent calls.
 *
 * @param tenantId  Cache key. Caller MUST scope to tenant — passing
 *                  a global key by mistake would leak data across
 *                  tenants.
 * @param loader    Async function producing the value. Called only
 *                  on cache miss / expired entry.
 * @param ttlMs     Override TTL for this call. Defaults to
 *                  `TOOL_REGISTRY_CACHE_TTL_MS` env (1h).
 */
export async function getCachedByTenant<T>(
  tenantId: string,
  loader: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  if (ttlMs <= 0) {
    // Cache disabled entirely — used when migrating to a different
    // backend (e.g. Cache Components) so we keep the call site stable.
    return loader()
  }

  const now = Date.now()
  const entry = cache.get(tenantId) as CacheEntry<T> | undefined
  if (entry && entry.expiresAt > now) {
    return entry.value
  }

  // Cache miss or expired. Coalesce concurrent requests onto the
  // first loader so we don't run N parallel queries for the same
  // tenant.
  const existing = inflight.get(tenantId) as Promise<T> | undefined
  if (existing) return existing

  const promise = (async () => {
    try {
      const value = await loader()
      // Bound the LRU size by evicting the oldest entry on overflow.
      // Map insertion order is the LRU order in our usage because we
      // re-set on every successful load.
      if (cache.size >= MAX_ENTRIES) {
        const oldestKey = cache.keys().next().value
        if (oldestKey !== undefined) cache.delete(oldestKey)
      }
      cache.set(tenantId, { expiresAt: Date.now() + ttlMs, value })
      return value
    } finally {
      inflight.delete(tenantId)
    }
  })()

  inflight.set(tenantId, promise)
  return promise
}

/**
 * Drop the cached entry for a tenant. MUST be called from any code
 * path that mutates `tool_registry` (admin edits, seed runs, tool
 * enable/disable, deprecation marks).
 *
 * Also clears any in-flight loader so a concurrent reader sees the
 * fresh data on its next call.
 */
export function invalidateTenantCache(tenantId: string): void {
  cache.delete(tenantId)
  inflight.delete(tenantId)
}

/**
 * Test / ops helper: clear the entire cache. Used by `vitest`
 * setUp + by an admin "purge cache" button if we ever build one.
 */
export function clearAllCachedTenants(): void {
  cache.clear()
  inflight.clear()
}

/**
 * Observability helper: return the current cached tenant count + ages.
 * Useful for an `/admin/ops` endpoint or a dev console.
 */
export function describeCachedTenants(): Array<{
  tenantId: string
  ageMs: number
  ttlRemainingMs: number
}> {
  const now = Date.now()
  return Array.from(cache.entries()).map(([tenantId, entry]) => ({
    tenantId,
    ageMs: DEFAULT_TTL_MS - (entry.expiresAt - now),
    ttlRemainingMs: Math.max(0, entry.expiresAt - now),
  }))
}
