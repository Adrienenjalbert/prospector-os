import { describe, it, expect } from 'vitest'
import {
  TavilyNewsAdapter,
  BomboraAdapter,
  BuiltWithAdapter,
  ApolloJobChangeAdapter,
  LinkedInSalesNavAdapter,
} from '../index'

/**
 * Phase 7 adapter contract tests (Section 8).
 *
 * Each adapter exports a vendor slug, capabilities, costPerCall, and
 * the appropriate fetch* method. The reference impls hit real APIs
 * when keys are configured; the stubs return empty arrays. We test
 * the SHAPE here (contract), not vendor calls (those live in
 * integration tests).
 *
 * The contract guarantees the signals cron can compose adapters
 * uniformly when paid keys arrive. If a stub later swaps to a real
 * impl in one PR, this test catches any contract drift.
 */

describe('Phase 7 IntentDataAdapter contract', () => {
  it('TavilyNewsAdapter declares the required surface', () => {
    const a = new TavilyNewsAdapter(null)
    expect(a.vendor).toBe('tavily_news')
    expect(typeof a.costPerCall).toBe('number')
    expect(a.capabilities).toMatchObject({
      topics: expect.any(Boolean),
      pageVisits: expect.any(Boolean),
      firmographicsLookup: expect.any(Boolean),
    })
    expect(typeof a.fetchIntent).toBe('function')
  })

  it('TavilyNewsAdapter without API key returns empty (silent skip)', async () => {
    const a = new TavilyNewsAdapter(null)
    const out = await a.fetchIntent({
      tenantId: 't',
      domains: ['acme.com'],
      topicsOfInterest: [],
      sinceDays: 7,
    })
    expect(out).toEqual([])
  })

  it('BomboraAdapter stub returns empty', async () => {
    const a = new BomboraAdapter()
    expect(a.vendor).toBe('bombora')
    expect(a.capabilities.topics).toBe(true)
    const out = await a.fetchIntent({
      tenantId: 't',
      domains: ['x.com'],
      topicsOfInterest: ['analytics'],
      sinceDays: 7,
    })
    expect(out).toEqual([])
  })
})

describe('Phase 7 TechStackAdapter contract', () => {
  it('BuiltWithAdapter stub returns empty + declares both add/remove', async () => {
    const a = new BuiltWithAdapter()
    expect(a.vendor).toBe('builtwith')
    expect(a.capabilities.detectAdds).toBe(true)
    expect(a.capabilities.detectRemoves).toBe(true)
    const out = await a.fetchChanges({
      tenantId: 't',
      domains: ['acme.com'],
      watchedVendors: ['salesforce'],
      sinceDays: 30,
    })
    expect(out).toEqual([])
  })
})

describe('Phase 7 JobChangeAdapter contract', () => {
  it('ApolloJobChangeAdapter without key returns empty', async () => {
    const a = new ApolloJobChangeAdapter(null)
    expect(a.vendor).toBe('apollo_job_change')
    expect(a.capabilities.detectExternal).toBe(true)
    expect(a.capabilities.detectInternal).toBe(false)
    const out = await a.fetchChanges({
      tenantId: 't',
      contacts: [{ contact_id: 'c1', email: 'a@b.com', linkedin_url: null }],
      sinceDays: 7,
    })
    expect(out).toEqual([])
  })

  it('LinkedInSalesNavAdapter stub returns empty + claims both detection modes', async () => {
    const a = new LinkedInSalesNavAdapter()
    expect(a.vendor).toBe('linkedin_sales_nav')
    expect(a.capabilities.detectExternal).toBe(true)
    expect(a.capabilities.detectInternal).toBe(true)
    const out = await a.fetchChanges({
      tenantId: 't',
      contacts: [],
      sinceDays: 7,
    })
    expect(out).toEqual([])
  })
})
