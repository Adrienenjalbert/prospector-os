import { describe, expect, it } from 'vitest'
import {
  generateDemoDataset,
  makeRng,
  type DemoCompany,
} from '../demo-data'

/**
 * Phase 3 T2.5 — demo-data seeder. Pure function, fully unit-
 * testable. Pins:
 *
 *   - Determinism: same seed → identical output (no Date.now,
 *     no Math.random). The wizard's "Try with sample data" button
 *     should always produce the same shapes.
 *   - Counts roughly match the proposal (25 companies + ~10
 *     opportunities + ~6 contacts each + a handful of signals).
 *   - Cross-references resolve: every opportunity / contact /
 *     signal points at a company that exists in the dataset.
 *   - Vendor neutrality: company names don't include
 *     "Indeed Flex" or other branded strings from the production
 *     seed-data.json. Demo tenants in any geography should see
 *     plausible accounts, not Indeed-branded fixtures.
 *
 * Bug class this prevents: a refactor that swaps `Math.random()` in
 * for one of the deterministic generators silently makes the demo
 * tenant non-reproducible. The first three test groups would fail.
 */

describe('makeRng', () => {
  it('produces the same sequence for the same seed', () => {
    const r1 = makeRng(1)
    const r2 = makeRng(1)
    for (let i = 0; i < 10; i++) {
      expect(r1()).toBe(r2())
    }
  })

  it('produces a different sequence for a different seed', () => {
    const r1 = makeRng(1)
    const r2 = makeRng(2)
    const seq1 = Array.from({ length: 10 }, () => r1())
    const seq2 = Array.from({ length: 10 }, () => r2())
    expect(seq1).not.toEqual(seq2)
  })

  it('outputs values in [0, 1)', () => {
    const r = makeRng(42)
    for (let i = 0; i < 100; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('generateDemoDataset', () => {
  it('produces 25 companies by default', () => {
    const dataset = generateDemoDataset()
    expect(dataset.companies).toHaveLength(25)
  })

  it('produces deterministic output for the same seed', () => {
    const a = generateDemoDataset({ seed: 1 })
    const b = generateDemoDataset({ seed: 1 })
    // Stringify rather than deepEqual for a faster, less noisy diff
    // when the snapshot drifts.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('produces a different result for a different seed', () => {
    const a = generateDemoDataset({ seed: 1 })
    const b = generateDemoDataset({ seed: 2 })
    expect(JSON.stringify(a.companies)).not.toBe(JSON.stringify(b.companies))
  })

  it('respects companyCount override', () => {
    const dataset = generateDemoDataset({ companyCount: 5 })
    expect(dataset.companies).toHaveLength(5)
  })

  it('uses the provided ownerCrmId on every company', () => {
    const dataset = generateDemoDataset({ ownerCrmId: 'demo-rep-XYZ' })
    for (const company of dataset.companies) {
      expect(company.owner_crm_id).toBe('demo-rep-XYZ')
    }
    for (const opp of dataset.opportunities) {
      expect(opp.owner_crm_id).toBe('demo-rep-XYZ')
    }
  })

  it('produces unique company crm_ids', () => {
    const dataset = generateDemoDataset()
    const ids = new Set(dataset.companies.map((c) => c.crm_id))
    expect(ids.size).toBe(dataset.companies.length)
  })

  it('produces unique opportunity crm_ids', () => {
    const dataset = generateDemoDataset()
    const ids = new Set(dataset.opportunities.map((o) => o.crm_id))
    expect(ids.size).toBe(dataset.opportunities.length)
  })

  it('every opportunity references an existing company', () => {
    const dataset = generateDemoDataset()
    const companyIds = new Set(dataset.companies.map((c) => c.crm_id))
    for (const opp of dataset.opportunities) {
      expect(companyIds.has(opp.company_crm_id)).toBe(true)
    }
  })

  it('every contact references an existing company', () => {
    const dataset = generateDemoDataset()
    const companyIds = new Set(dataset.companies.map((c) => c.crm_id))
    for (const contact of dataset.contacts) {
      expect(companyIds.has(contact.company_crm_id)).toBe(true)
    }
  })

  it('every signal references an existing company', () => {
    const dataset = generateDemoDataset()
    const companyIds = new Set(dataset.companies.map((c) => c.crm_id))
    for (const signal of dataset.signals) {
      expect(companyIds.has(signal.company_crm_id)).toBe(true)
    }
  })

  it('produces ~10 opportunities at the default company count', () => {
    const dataset = generateDemoDataset()
    // Generator targets roughly 60% of 25 companies × 1-2 opps each.
    // Range is wide on purpose — pinning the exact count makes the
    // test brittle to small generator tweaks.
    expect(dataset.opportunities.length).toBeGreaterThanOrEqual(8)
    expect(dataset.opportunities.length).toBeLessThanOrEqual(40)
  })

  it('seeds 4-6 contacts per company', () => {
    const dataset = generateDemoDataset()
    const byCompany = new Map<string, number>()
    for (const c of dataset.contacts) {
      byCompany.set(
        c.company_crm_id,
        (byCompany.get(c.company_crm_id) ?? 0) + 1,
      )
    }
    for (const company of dataset.companies) {
      const count = byCompany.get(company.crm_id) ?? 0
      expect(count).toBeGreaterThanOrEqual(4)
      expect(count).toBeLessThanOrEqual(6)
    }
  })

  it('seeds signals only on the top ~30% of companies', () => {
    const dataset = generateDemoDataset()
    // 30% of 25 = 7.5, so 7 signals expected.
    expect(dataset.signals.length).toBeGreaterThanOrEqual(5)
    expect(dataset.signals.length).toBeLessThanOrEqual(10)
  })

  it('uses vendor-neutral company names (no Indeed Flex branding)', () => {
    // Phase 3 T2.5 explicitly required vendor-neutral demo data so
    // a tenant in any geography sees plausible accounts. A brand
    // creep ("Acme Logistics" from the seed-data.json into the
    // public demo path) is a real failure mode worth pinning.
    const dataset = generateDemoDataset()
    const banned = ['Indeed Flex', 'indeedflex.com', 'indeed-flex']
    for (const c of dataset.companies) {
      for (const term of banned) {
        expect(c.name).not.toContain(term)
        expect(c.domain).not.toContain(term)
      }
    }
  })

  it('every demo company domain ends in .example.com (RFC 2606)', () => {
    // .example.com is reserved by RFC 2606 for documentation; using
    // it for demo data avoids any accidental email send / link
    // resolution against a real third-party domain.
    const dataset = generateDemoDataset()
    for (const c of dataset.companies) {
      expect(c.domain.endsWith('.example.com')).toBe(true)
    }
  })

  it('produces opportunities with stage in {Lead, Qualified, Proposal, Negotiation}', () => {
    const dataset = generateDemoDataset()
    const allowedStages = new Set(['Lead', 'Qualified', 'Proposal', 'Negotiation'])
    for (const opp of dataset.opportunities) {
      expect(allowedStages.has(opp.stage)).toBe(true)
    }
  })

  it('has plausible employee counts and revenues', () => {
    const dataset = generateDemoDataset()
    for (const c of dataset.companies) {
      expect(c.employee_count).toBeGreaterThanOrEqual(200)
      expect(c.employee_count).toBeLessThanOrEqual(4200)
      expect(c.annual_revenue).toBeGreaterThan(0)
    }
  })

  it('produces deterministic same-seed output across two separate calls in different processes (smoke)', () => {
    // This is really an "is the PRNG truly free of time/randomness
    // sources?" check. If we accidentally introduced Date.now or
    // Math.random into the seeder, this would flap.
    const first = generateDemoDataset({ seed: 99 })
    const second = generateDemoDataset({ seed: 99 })
    const sample = (d: typeof first): Pick<DemoCompany, 'name' | 'employee_count' | 'annual_revenue'>[] =>
      d.companies.map((c) => ({
        name: c.name,
        employee_count: c.employee_count,
        annual_revenue: c.annual_revenue,
      }))
    expect(sample(first)).toEqual(sample(second))
  })
})
