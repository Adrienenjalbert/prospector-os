import { describe, it, expect } from 'vitest'
import { fmtMoney } from '../slices/_helpers'

/**
 * The previous default of a hardcoded `£` symbol made every US tenant's
 * USD opportunity render as `£200k` in the agent's prompt. The model
 * would then echo that back to the rep, eroding trust.
 *
 * `fmtMoney(value, currency?)` now accepts an ISO 4217 code and routes
 * through `Intl.NumberFormat` for the right symbol per locale. These
 * tests pin the contract so a refactor that re-introduces a symbol
 * default gets caught.
 */

describe('fmtMoney', () => {
  it('returns "—" for null / undefined / NaN', () => {
    expect(fmtMoney(null)).toBe('—')
    expect(fmtMoney(undefined)).toBe('—')
    expect(fmtMoney(Number.NaN)).toBe('—')
  })

  it('renders USD with $ symbol via Intl when currency=USD', () => {
    const out = fmtMoney(50_000, 'USD')
    expect(out).toContain('$')
    expect(out).toMatch(/50/)
    expect(out).not.toContain('£')
  })

  it('renders GBP with £ symbol when currency=GBP', () => {
    const out = fmtMoney(50_000, 'GBP')
    expect(out).toContain('£')
    expect(out).not.toContain('$')
  })

  it('renders EUR with € symbol when currency=EUR', () => {
    const out = fmtMoney(75_000, 'EUR')
    expect(out).toContain('€')
  })

  it('default (no currency arg) is USD-shaped, NOT £', () => {
    const out = fmtMoney(50_000)
    expect(out).toContain('$')
    expect(out).not.toContain('£')
  })

  it('compact form for >= 1M (Intl path)', () => {
    const out = fmtMoney(2_500_000, 'USD')
    // Intl compact notation outputs "$2.5M" for en-US
    expect(out).toMatch(/2\.5\s*M/i)
  })

  it('preserves legacy symbol path for callers that pass "£"', () => {
    // Used by older slice call sites (length !== 3 → symbol path)
    const out = fmtMoney(2_500_000, '£')
    expect(out.startsWith('£')).toBe(true)
    expect(out).toContain('2.5M')
  })

  it('handles currency=null by defaulting to USD', () => {
    const out = fmtMoney(50_000, null)
    expect(out).toContain('$')
  })

  it('falls back gracefully on unknown ISO code (no throw)', () => {
    // Intl throws on truly invalid currency codes; we should not.
    expect(() => fmtMoney(50_000, 'XYZ')).not.toThrow()
  })
})
