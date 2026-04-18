import type {
  CompanyEnrichmentResult,
  ContactEnrichmentResult,
  ContactSearchFilters,
  JobPosting,
  ApolloOrganizationResponse,
  ApolloPersonResponse,
  PersonEnrichmentResult,
} from '@prospector/core'
import type { EnrichmentProvider } from './interface'
import { normalizeIndustry } from './normalizers/industry-map'

/** Pull a hostname out of a website URL — best-effort, returns null on parse fail. */
function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null
  try {
    const url = website.startsWith('http') ? website : `https://${website}`
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null
  }
}

const APOLLO_BASE = 'https://api.apollo.io/api/v1'
const RATE_LIMIT_MS = 600 // ~100 requests/minute

const SENIORITY_MAP: Record<string, string> = {
  c_suite: 'c_level',
  owner: 'c_level',
  founder: 'c_level',
  partner: 'c_level',
  vp: 'vp',
  director: 'director',
  senior: 'manager',
  manager: 'manager',
  entry: 'individual',
  training: 'individual',
  intern: 'individual',
}

function normalizeSeniority(raw: string | null | undefined): string | null {
  if (!raw) return null
  return SENIORITY_MAP[raw.toLowerCase()] ?? raw.toLowerCase()
}

export class ApolloAdapter implements EnrichmentProvider {
  readonly name = 'apollo'
  private apiKey: string
  private lastRequestAt = 0

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async enrichCompany(domain: string): Promise<CompanyEnrichmentResult> {
    await this.throttle()

    const res = await fetch(`${APOLLO_BASE}/organizations/enrich`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ domain }),
    })

    if (!res.ok) {
      throw new Error(`Apollo enrich failed: ${res.status}`)
    }

    const data = await res.json()
    const org: ApolloOrganizationResponse = data.organization

    if (!org) {
      return {
        name: domain,
        domain,
        industry: null,
        industry_group: null,
        employee_count: null,
        employee_range: null,
        annual_revenue: null,
        revenue_range: null,
        founded_year: null,
        hq_city: null,
        hq_country: null,
        locations: [],
        tech_stack: [],
        description: null,
        raw_data: data,
      }
    }

    const normalized = normalizeIndustry(org.industry)

    return {
      name: org.name,
      domain,
      industry: normalized.industry,
      industry_group: normalized.group,
      employee_count: org.estimated_num_employees ?? null,
      employee_range: categorizeEmployees(org.estimated_num_employees),
      annual_revenue: org.annual_revenue ?? null,
      revenue_range: categorizeRevenue(org.annual_revenue),
      founded_year: org.founded_year ?? null,
      hq_city: org.city ?? null,
      hq_country: org.country ?? null,
      locations: org.city
        ? [{ city: org.city, country: org.country, is_hq: true }]
        : [],
      tech_stack: org.technologies ?? [],
      description: null,
      raw_data: data,
    }
  }

  async searchContacts(
    domain: string,
    filters?: ContactSearchFilters
  ): Promise<ContactEnrichmentResult[]> {
    await this.throttle()

    const body: Record<string, unknown> = {
      q_organization_domains: domain,
      page: 1,
      per_page: filters?.limit ?? 25,
    }

    if (filters?.seniority?.length) {
      body.person_seniorities = filters.seniority
    }
    if (filters?.department?.length) {
      body.person_departments = filters.department
    }
    if (filters?.titles?.length) {
      body.person_titles = filters.titles
    }

    const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(`Apollo contact search failed: ${res.status}`)
    }

    const data = await res.json()
    const people: ApolloPersonResponse[] = data.people ?? []

    return people.map((p) => ({
      email: p.email ?? null,
      first_name: p.first_name,
      last_name: p.last_name,
      title: p.title ?? null,
      seniority: normalizeSeniority(p.seniority),
      department: p.departments?.[0] ?? null,
      phone: p.phone_numbers?.[0]?.raw_number ?? null,
      linkedin_url: p.linkedin_url ?? null,
      apollo_id: p.id ?? null,
      photo_url: p.photo_url ?? null,
      twitter_url: p.twitter_url ?? null,
      city: p.city ?? null,
      country: p.country ?? null,
      alma_mater: p.education?.[0]?.school_name ?? null,
      previous_companies: (p.employment_history ?? [])
        .map((e) => e.organization_name)
        .filter(Boolean)
        .slice(0, 5),
    }))
  }

  async getJobPostings(
    domain: string,
    flexKeywords: string[] = [],
  ): Promise<JobPosting[]> {
    await this.throttle()

    const res = await fetch(`${APOLLO_BASE}/organizations/jobs`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ domain }),
    })

    if (!res.ok) return []

    const data = await res.json()
    const jobs: Record<string, unknown>[] = data.jobs ?? []

    // No vertical-specific defaults — staffing tenants pass keywords like
    // ['temp', 'contract', 'shift'] from their signal config; tenants in
    // other verticals pass an empty list and get is_temp_flex=false.
    const lowered = flexKeywords.map((kw) => kw.toLowerCase())

    return jobs.map((j) => {
      const title = (j.title as string) ?? ''
      const titleLower = title.toLowerCase()
      const matchedKeywords = lowered.filter((kw) => titleLower.includes(kw))

      return {
        title,
        location: (j.location as string) ?? null,
        posted_at: (j.posted_at as string) ?? null,
        url: (j.url as string) ?? null,
        is_temp_flex: matchedKeywords.length > 0,
        keywords: matchedKeywords,
      }
    })
  }

  /**
   * Single-contact refresh by email — used by the Champion Alumni
   * Tracker to detect when a previously-known champion has moved to a
   * new company. Apollo's `/people/match` endpoint returns the
   * person's *current* organization (name + domain) along with
   * employment history, which is exactly what the detector needs to
   * compare against last-known employer.
   *
   * Returns null when Apollo can't match the email — common for
   * personal addresses or stale contacts. The detector treats null as
   * "no signal", not an error.
   */
  async enrichPerson(email: string): Promise<PersonEnrichmentResult | null> {
    if (!email) return null
    await this.throttle()

    const res = await fetch(`${APOLLO_BASE}/people/match`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ email, reveal_personal_emails: false }),
    })
    if (!res.ok) {
      // 404 / 422 means no match — silent, the detector will skip.
      if (res.status === 404 || res.status === 422) return null
      throw new Error(`Apollo enrichPerson failed: ${res.status}`)
    }
    const data = await res.json()
    const p = data.person as ApolloPersonResponse | undefined
    if (!p) return null

    const org = (p as unknown as { organization?: { name?: string; primary_domain?: string; website_url?: string } }).organization

    return {
      email: p.email ?? null,
      first_name: p.first_name,
      last_name: p.last_name,
      title: p.title ?? null,
      seniority: normalizeSeniority(p.seniority),
      department: p.departments?.[0] ?? null,
      phone: p.phone_numbers?.[0]?.raw_number ?? null,
      linkedin_url: p.linkedin_url ?? null,
      apollo_id: p.id ?? null,
      photo_url: p.photo_url ?? null,
      twitter_url: p.twitter_url ?? null,
      city: p.city ?? null,
      country: p.country ?? null,
      alma_mater: p.education?.[0]?.school_name ?? null,
      previous_companies: (p.employment_history ?? [])
        .map((e) => e.organization_name)
        .filter(Boolean)
        .slice(0, 5),
      current_organization: org
        ? {
            name: org.name ?? null,
            domain: org.primary_domain ?? extractDomain(org.website_url ?? null),
          }
        : null,
    }
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey,
    }
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed))
    }
    this.lastRequestAt = Date.now()
  }
}

function categorizeEmployees(count: number | undefined): string | null {
  if (!count) return null
  if (count < 50) return '1-49'
  if (count < 100) return '50-99'
  if (count < 250) return '100-249'
  if (count < 500) return '250-499'
  if (count < 1000) return '500-999'
  if (count < 5000) return '1000-4999'
  if (count < 10000) return '5000-9999'
  return '10000+'
}

function categorizeRevenue(rev: number | undefined): string | null {
  if (!rev) return null
  if (rev < 1_000_000) return '<$1M'
  if (rev < 25_000_000) return '$1M-$25M'
  if (rev < 100_000_000) return '$25M-$100M'
  if (rev < 250_000_000) return '$100M-$250M'
  return '$250M+'
}
