import type {
  CompanyEnrichmentResult,
  ContactEnrichmentResult,
  ContactSearchFilters,
  JobPosting,
} from '@prospector/core'

export interface EnrichmentProvider {
  readonly name: string
  enrichCompany(domain: string): Promise<CompanyEnrichmentResult>
  searchContacts(domain: string, filters?: ContactSearchFilters): Promise<ContactEnrichmentResult[]>
  /**
   * Fetch open job postings for a company.
   *
   * `flexKeywords`: optional list of role-type keywords (e.g. "temp",
   * "contract", "shift", "locum") to flag postings as `is_temp_flex`. Pass
   * tenant-specific keywords from your signal config — the adapter ships
   * with **no defaults** so non-staffing tenants do not get false-positive
   * `temp_job_posting` signals.
   */
  getJobPostings(domain: string, flexKeywords?: string[]): Promise<JobPosting[]>
}
