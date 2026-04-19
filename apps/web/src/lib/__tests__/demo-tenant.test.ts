import { describe, expect, it } from 'vitest'
import { isDemoTenantConfig, isDemoTenantSlug } from '../demo-tenant'

/**
 * Phase 3 T2.5 — pin the demo-tenant predicates.
 *
 * The slug-based check (`isDemoTenantSlug`) is legacy: used by
 * `/inbox` to skip the onboarding redirect for tenants whose slug
 * matches a known demo convention. We test it here to lock the
 * behaviour in case future refactors touch it.
 *
 * The config-based check (`isDemoTenantConfig`) is new in T2.5:
 * used by `/admin/roi` to surface a "Demo tenant" banner so demo
 * numbers never get confused with real ones, and by future cross-
 * tenant analytics to exclude demo tenants from aggregate ARR
 * roll-ups (the "no demo data in analytics" rule).
 */

describe('isDemoTenantSlug', () => {
  it('returns true for the default demo slugs', () => {
    expect(isDemoTenantSlug('demo')).toBe(true)
    expect(isDemoTenantSlug('sandbox')).toBe(true)
  })

  it('returns false for null / undefined / empty', () => {
    expect(isDemoTenantSlug(null)).toBe(false)
    expect(isDemoTenantSlug(undefined)).toBe(false)
    expect(isDemoTenantSlug('')).toBe(false)
  })

  it('returns false for unknown slugs', () => {
    expect(isDemoTenantSlug('acme-corp')).toBe(false)
    expect(isDemoTenantSlug('my-real-tenant')).toBe(false)
  })

  // Env-based slugs are integration-flavoured (process.env), out of
  // scope here — covered by the inbox page integration in practice.
})

describe('isDemoTenantConfig', () => {
  it('returns false for null / undefined / non-objects', () => {
    expect(isDemoTenantConfig(null)).toBe(false)
    expect(isDemoTenantConfig(undefined)).toBe(false)
    expect(isDemoTenantConfig('demo')).toBe(false)
    expect(isDemoTenantConfig(42)).toBe(false)
    expect(isDemoTenantConfig(true)).toBe(false)
  })

  it('returns false when is_demo is missing', () => {
    expect(isDemoTenantConfig({})).toBe(false)
    expect(isDemoTenantConfig({ description: 'real tenant' })).toBe(false)
  })

  it('returns false when is_demo is anything other than literal `true`', () => {
    // Strict identity to keep the predicate honest. The proposal
    // says "tenant row stamped is_demo: true"; truthy strings or
    // numbers shouldn't slip through and accidentally suppress
    // real-tenant analytics.
    expect(isDemoTenantConfig({ is_demo: 'true' })).toBe(false)
    expect(isDemoTenantConfig({ is_demo: 1 })).toBe(false)
    expect(isDemoTenantConfig({ is_demo: false })).toBe(false)
    expect(isDemoTenantConfig({ is_demo: null })).toBe(false)
  })

  it('returns true when is_demo === true', () => {
    expect(isDemoTenantConfig({ is_demo: true })).toBe(true)
    expect(
      isDemoTenantConfig({
        is_demo: true,
        description: 'demo tenant',
        demo_seeded_at: '2026-04-18T12:00:00Z',
      }),
    ).toBe(true)
  })
})
