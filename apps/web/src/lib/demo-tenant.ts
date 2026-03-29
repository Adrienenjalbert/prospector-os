/**
 * Demo tenants should not be forced through onboarding when they have zero companies.
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
