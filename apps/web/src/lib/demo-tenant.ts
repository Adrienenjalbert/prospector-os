/**
 * Demo tenants should not be forced through onboarding when they have zero companies.
 *
 * Two complementary checks live here:
 *
 *   - `isDemoTenantSlug(slug)` — slug-based legacy check.
 *     Used by /inbox to skip the onboarding redirect for tenants
 *     whose slug matches a known demo convention (`demo`,
 *     `sandbox`, or anything in NEXT_PUBLIC_DEMO_TENANT_SLUGS).
 *     Does NOT depend on database state — useful for the
 *     unauthenticated / pre-DB-load path.
 *
 *   - `isDemoTenantConfig(business_config)` — explicit-flag check
 *     introduced in Phase 3 T2.5. Returns true when the tenant
 *     was created via the wizard's "Try with sample data" path,
 *     which stamps `business_config.is_demo: true`. Used by:
 *     - /admin/roi to surface a "DEMO" banner so demo numbers
 *       are never confused with real ones.
 *     - Future cross-tenant analytics (when they exist) to
 *       exclude demo tenants from aggregate ARR rollups —
 *       enforces the audit's "no demo data in analytics" rule
 *       at the helper layer.
 *
 * Both checks can be true for the same tenant (a demo-named tenant
 * that also got the explicit flag) — neither supersedes the other.
 */
export function isDemoTenantSlug(slug: string | null | undefined): boolean {
  if (!slug) return false
  const fromEnv =
    process.env.NEXT_PUBLIC_DEMO_TENANT_SLUGS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  const defaults = ['demo', 'sandbox']
  return defaults.includes(slug) || fromEnv.includes(slug)
}

/**
 * Returns true when the tenant's `business_config.is_demo === true`.
 * Pure check on the JSON blob — no I/O. Tolerates `null`,
 * `undefined`, and arbitrary shapes returned by Supabase typing
 * (the column is JSONB).
 */
export function isDemoTenantConfig(
  businessConfig: unknown,
): boolean {
  if (businessConfig == null || typeof businessConfig !== 'object') {
    return false
  }
  const value = (businessConfig as Record<string, unknown>).is_demo
  return value === true
}
