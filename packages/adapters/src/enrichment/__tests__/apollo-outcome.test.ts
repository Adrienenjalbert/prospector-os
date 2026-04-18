import { describe, it, expect, afterEach, vi } from 'vitest'
import { ApolloAdapter } from '../apollo'

/**
 * Pin the tagged-outcome contract on `enrichCompanyOutcome`. Pre-this-
 * change every non-200 Apollo response collapsed into a thrown `Error`,
 * so the cron couldn't tell:
 *   - 429 (rate-limited; back off, don't burn another credit)
 *   - 200 with no `organization` (no_match; mark + skip future cycles)
 *   - 5xx (transient; retry next cycle)
 *   - 404 (no_match in some plan tiers)
 *
 * These tests use vi.spyOn(globalThis, 'fetch') to assert the
 * adapter's classification is correct without hitting real Apollo.
 */

const FAKE_KEY = 'test-key'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

describe('ApolloAdapter.enrichCompanyOutcome', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns enriched on 200 with org data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        organization: {
          name: 'Acme',
          industry: 'Software',
          estimated_num_employees: 500,
          annual_revenue: 50_000_000,
          founded_year: 2010,
          city: 'Austin',
          country: 'USA',
          technologies: ['React'],
        },
      }),
    )
    const adapter = new ApolloAdapter(FAKE_KEY)
    const r = await adapter.enrichCompanyOutcome('acme.com')
    expect(r.status).toBe('enriched')
    if (r.status === 'enriched') {
      expect(r.data.name).toBe('Acme')
      expect(r.data.employee_count).toBe(500)
    }
  })

  it('returns no_match on 200 with no organization (Apollo plan-tier behaviour)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}))
    const adapter = new ApolloAdapter(FAKE_KEY)
    const r = await adapter.enrichCompanyOutcome('unknown.com')
    expect(r.status).toBe('no_match')
    if (r.status === 'no_match') expect(r.domain).toBe('unknown.com')
  })

  it('returns no_match on 404 (some plans 404 instead of 200-empty)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404 }),
    )
    const adapter = new ApolloAdapter(FAKE_KEY)
    const r = await adapter.enrichCompanyOutcome('unknown.com')
    expect(r.status).toBe('no_match')
  })

  it('returns retryable error on 429 (rate-limited) with reason naming retry-after', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate-limited', {
        status: 429,
        headers: { 'Retry-After': '120' },
      }),
    )
    const adapter = new ApolloAdapter(FAKE_KEY)
    const r = await adapter.enrichCompanyOutcome('acme.com')
    expect(r.status).toBe('error')
    if (r.status === 'error') {
      expect(r.retryable).toBe(true)
      expect(r.reason).toContain('rate_limited')
      expect(r.reason).toContain('120s')
    }
  })

  it('returns retryable error on 5xx (transient)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('server crashed', { status: 503 }),
    )
    const adapter = new ApolloAdapter(FAKE_KEY)
    const r = await adapter.enrichCompanyOutcome('acme.com')
    expect(r.status).toBe('error')
    if (r.status === 'error') expect(r.retryable).toBe(true)
  })

  it('returns non-retryable error on 401 (auth issue — fixing it once is the right answer)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('unauthorized', { status: 401 }),
    )
    const adapter = new ApolloAdapter(FAKE_KEY)
    const r = await adapter.enrichCompanyOutcome('acme.com')
    expect(r.status).toBe('error')
    if (r.status === 'error') expect(r.retryable).toBe(false)
  })

  it('returns retryable error on network failure (fetch rejects)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'))
    const adapter = new ApolloAdapter(FAKE_KEY)
    const r = await adapter.enrichCompanyOutcome('acme.com')
    expect(r.status).toBe('error')
    if (r.status === 'error') {
      expect(r.retryable).toBe(true)
      expect(r.reason).toContain('network')
    }
  })
})

describe('ApolloAdapter.searchContacts — phone gating', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const peopleResponse = {
    people: [
      {
        id: 'p1',
        first_name: 'Sarah',
        last_name: 'Chen',
        email: 'sarah@acme.com',
        title: 'VP Sales',
        seniority: 'vp',
        departments: ['sales'],
        phone_numbers: [{ raw_number: '+1-415-555-0100' }],
        linkedin_url: 'https://linkedin.com/in/sarah',
        photo_url: null,
        twitter_url: null,
        city: 'SF',
        country: 'USA',
        employment_history: [],
        education: [],
      },
    ],
  }

  it('omits phone by default — protects the most expensive Apollo data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(peopleResponse))
    const adapter = new ApolloAdapter(FAKE_KEY)
    const contacts = await adapter.searchContacts('acme.com')
    expect(contacts).toHaveLength(1)
    expect(contacts[0].phone).toBeNull()
    expect(contacts[0].email).toBe('sarah@acme.com')
  })

  it('returns phone when revealPhones: true is explicitly opted into', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(peopleResponse))
    const adapter = new ApolloAdapter(FAKE_KEY)
    const contacts = await adapter.searchContacts('acme.com', {
      revealPhones: true,
    })
    expect(contacts[0].phone).toBe('+1-415-555-0100')
  })

  it('still omits phone when revealPhones is explicitly false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(peopleResponse))
    const adapter = new ApolloAdapter(FAKE_KEY)
    const contacts = await adapter.searchContacts('acme.com', {
      revealPhones: false,
    })
    expect(contacts[0].phone).toBeNull()
  })
})
