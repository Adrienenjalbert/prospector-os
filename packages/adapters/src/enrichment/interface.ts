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
  getJobPostings(domain: string): Promise<JobPosting[]>
}
