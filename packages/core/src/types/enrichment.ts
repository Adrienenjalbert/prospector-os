import type { CompanyLocation } from './ontology'

export interface EnrichmentProvider {
  name: string
  enrichCompany(domain: string): Promise<CompanyEnrichmentResult>
  searchContacts(
    domain: string,
    filters?: ContactSearchFilters
  ): Promise<ContactEnrichmentResult[]>
  /**
   * Fetch open job postings for a company.
   *
   * `flexKeywords`: optional list of role-type keywords (e.g. "temp",
   * "contract", "shift", "locum"). The adapter ships with no defaults so
   * non-staffing tenants do not get false-positive `is_temp_flex`
   * postings. Keywords typically come from the per-tenant signal config.
   */
  getJobPostings(
    domain: string,
    flexKeywords?: string[]
  ): Promise<JobPosting[]>
}

export interface CompanyEnrichmentResult {
  name: string
  domain: string
  industry: string | null
  industry_group: string | null
  employee_count: number | null
  employee_range: string | null
  annual_revenue: number | null
  revenue_range: string | null
  founded_year: number | null
  hq_city: string | null
  hq_country: string | null
  locations: CompanyLocation[]
  tech_stack: string[]
  description: string | null
  raw_data: Record<string, unknown>
}

export interface ContactEnrichmentResult {
  email: string | null
  first_name: string
  last_name: string
  title: string | null
  seniority: string | null
  department: string | null
  phone: string | null
  linkedin_url: string | null
  apollo_id: string | null
  photo_url: string | null
  twitter_url: string | null
  city: string | null
  country: string | null
  alma_mater: string | null
  previous_companies: string[]
}

export interface ContactSearchFilters {
  seniority?: string[]
  department?: string[]
  titles?: string[]
  limit?: number
  /**
   * Opt into Apollo phone-number reveal on the contact search result.
   * Phones are Apollo's most expensive data (~$1/contact) and the
   * cheaper $0.10 search call returns them by default — that drift
   * from the cost map breaks budget enforcement. Default `false`:
   * callers that need a phone make a follow-up `enrichPerson(email)`
   * call which hits the dedicated `phone_unlock` cost bucket and
   * obeys the tenant's tier-based phone-unlock policy.
   *
   * Set `true` only when:
   *   - The active company is `priority_tier === 'HOT'`, AND
   *   - The contact role is decision_maker / economic_buyer, AND
   *   - The tenant has `enrichment_spend_by_op.phone_unlock` budget left.
   */
  revealPhones?: boolean
}

/**
 * Result shape for enrichPerson(email) — single-contact refresh that
 * preserves the *current* employer (organization name + domain) so the
 * Champion Alumni detector can spot job changes between runs. Reuses
 * the ContactEnrichmentResult fields and adds current_organization.
 */
export interface PersonEnrichmentResult extends ContactEnrichmentResult {
  current_organization: {
    name: string | null
    domain: string | null
  } | null
}

export interface JobPosting {
  title: string
  location: string | null
  posted_at: string | null
  url: string | null
  is_temp_flex: boolean
  keywords: string[]
}

export interface EnrichmentJob {
  id: string
  tenant_id: string
  company_id: string
  provider: string
  job_type: 'company' | 'contacts' | 'signals' | 'jobs'
  status: EnrichmentJobStatus
  priority: number
  attempts: number
  max_attempts: number
  result: Record<string, unknown> | null
  error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export type EnrichmentJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface EnrichmentBudgetStatus {
  tenant_id: string
  monthly_budget: number
  current_spend: number
  remaining: number
  percentage_used: number
  is_over_budget: boolean
  is_near_limit: boolean
}

export interface ApolloOrganizationResponse {
  id: string
  name: string
  website_url: string
  industry: string
  estimated_num_employees: number
  annual_revenue: number
  founded_year: number
  city: string
  country: string
  technologies: string[]
  departments: { name: string; count: number }[]
  raw: Record<string, unknown>
}

export interface ApolloPersonResponse {
  id: string
  first_name: string
  last_name: string
  email: string
  title: string
  seniority: string
  departments: string[]
  phone_numbers: { raw_number: string }[]
  linkedin_url: string
  photo_url: string | null
  twitter_url: string | null
  city: string | null
  country: string | null
  employment_history: { organization_name: string }[]
  education: { degree: string; school_name: string }[]
}
