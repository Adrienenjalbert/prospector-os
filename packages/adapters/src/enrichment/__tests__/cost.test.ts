import { describe, it, expect } from 'vitest'
import {
  ENRICHMENT_COSTS,
  totalSpend,
  addCost,
  canAfford,
  type EnrichmentOperation,
} from '../cost'

/**
 * Pin the per-operation cost map. Pre-this-change every Apollo call
 * was tracked at a flat `$0.50` regardless of operation, so a tenant
 * burning their entire budget on the cheapest API ($0.05 company
 * enrich) hit the cap 10x earlier than reality, and a tenant
 * silently calling phone-unlock ($1.00) used 50% of their budget per
 * call without anything noticing.
 *
 * These tests pin:
 *   1. The cost ordering (phone is the most expensive; jobs/enrich
 *      are cheapest) so a refactor that re-shuffles them gets caught.
 *   2. The pure helpers (`addCost`, `totalSpend`, `canAfford`) — those
 *      are the contract every Apollo caller uses to gate spend.
 */

describe('ENRICHMENT_COSTS — pricing contract', () => {
  it('orders operations from cheap to expensive correctly', () => {
    expect(ENRICHMENT_COSTS.company_enrich).toBeLessThan(
      ENRICHMENT_COSTS.contact_search,
    )
    expect(ENRICHMENT_COSTS.contact_search).toBeLessThan(
      ENRICHMENT_COSTS.person_match,
    )
    expect(ENRICHMENT_COSTS.person_match).toBeLessThan(
      ENRICHMENT_COSTS.phone_unlock,
    )
  })

  it('phone_unlock is at least 10x company_enrich (the gate-or-bust signal)', () => {
    expect(ENRICHMENT_COSTS.phone_unlock).toBeGreaterThanOrEqual(
      ENRICHMENT_COSTS.company_enrich * 10,
    )
  })
})

describe('totalSpend', () => {
  it('returns 0 for empty ledger', () => {
    expect(totalSpend({})).toBe(0)
  })

  it('sums every operation', () => {
    const ledger = {
      company_enrich: 0.5,
      contact_search: 1.0,
      phone_unlock: 5.0,
    }
    expect(totalSpend(ledger)).toBeCloseTo(6.5)
  })

  it('treats undefined as 0 (no NaN poisoning)', () => {
    const ledger: Partial<Record<EnrichmentOperation, number>> = {
      company_enrich: 1.0,
    }
    expect(totalSpend(ledger)).toBe(1.0)
  })
})

describe('addCost', () => {
  it('initialises a new bucket from empty ledger', () => {
    const next = addCost({}, 'company_enrich')
    expect(next.company_enrich).toBe(ENRICHMENT_COSTS.company_enrich)
  })

  it('accumulates into an existing bucket', () => {
    const next = addCost({ company_enrich: 0.1 }, 'company_enrich', 2)
    expect(next.company_enrich).toBeCloseTo(0.1 + ENRICHMENT_COSTS.company_enrich * 2)
  })

  it('does not mutate the input ledger (immutability contract)', () => {
    const before = { contact_search: 0.2 }
    const after = addCost(before, 'phone_unlock')
    expect(before).toEqual({ contact_search: 0.2 })
    expect(after.phone_unlock).toBe(ENRICHMENT_COSTS.phone_unlock)
  })

  it('handles multiple units in one call', () => {
    const next = addCost({}, 'contact_search', 5)
    expect(next.contact_search).toBeCloseTo(ENRICHMENT_COSTS.contact_search * 5)
  })
})

describe('canAfford — budget gate', () => {
  it('allows when budget has plenty of headroom', () => {
    const r = canAfford({}, 100, 'company_enrich')
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(100)
  })

  it('blocks with budget_zero when monthlyBudget=0', () => {
    const r = canAfford({}, 0, 'company_enrich')
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('budget_zero')
  })

  it('blocks with budget_zero when monthlyBudget is negative (defence)', () => {
    const r = canAfford({}, -5, 'company_enrich')
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('budget_zero')
  })

  it('blocks with over_budget when one more call would breach', () => {
    const ledger: Partial<Record<EnrichmentOperation, number>> = {
      company_enrich: 9.96,
    }
    // budget=10, used=9.96, next call costs 0.05 → 10.01 > 10 → block
    const r = canAfford(ledger, 10, 'company_enrich')
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('over_budget')
    expect(r.remaining).toBeCloseTo(0.04)
  })

  it('returns the call cost so the rep can be told what would have been spent', () => {
    const r = canAfford({}, 10, 'phone_unlock')
    expect(r.cost).toBe(ENRICHMENT_COSTS.phone_unlock)
  })

  it('blocks phone unlock when only $0.30 remains', () => {
    const ledger = { company_enrich: 99.7 } // budget=100, used=99.7, remain=0.3
    const r = canAfford(ledger, 100, 'phone_unlock')
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('over_budget')
  })

  it('still allows the cheaper company_enrich when phone unlock would fail', () => {
    const ledger = { company_enrich: 99.7 } // remain=0.3 > company_enrich=0.05
    const r = canAfford(ledger, 100, 'company_enrich')
    expect(r.allowed).toBe(true)
  })
})
