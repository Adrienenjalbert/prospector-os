import type {
  FetchJobChangesOpts,
  JobChangeAdapter,
  JobChangeRow,
} from './interface'

/**
 * LinkedInSalesNavAdapter — Phase 7 (Section 4.3) STUB.
 *
 * LinkedIn Sales Navigator's "Job Change" feed (proxied via
 * PhantomBuster, Apify, or a customer-supplied scraper) is the most
 * accurate job-change source available — fresher than Apollo (often
 * within hours of LinkedIn profile update) and lower false-positive
 * rate.
 *
 * The integration shape:
 *   - Customer brings PhantomBuster API key
 *   - Per-tenant Sales Navigator search saved as a Phantom
 *   - Phantom polls the search nightly and writes to a per-tenant
 *     CSV / JSON drop
 *   - This adapter reads the drop, dedupes against prior runs,
 *     emits job_change signals
 *
 * Stub returns empty until LINKEDIN_SN_PHANTOMBUSTER_KEY +
 * per-tenant Phantom config arrive. The adapter shape is locked so
 * no other code changes when the impl lands.
 */
export class LinkedInSalesNavAdapter implements JobChangeAdapter {
  vendor = 'linkedin_sales_nav'
  capabilities = {
    detectExternal: true,
    detectInternal: true, // LinkedIn surfaces internal moves too
    confidenceScored: false,
  }
  costPerCall = 0.03

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_apiKey?: string | null) {}

  async fetchChanges(opts: FetchJobChangesOpts): Promise<JobChangeRow[]> {
    void opts
    if (!process.env.LINKEDIN_SN_PHANTOMBUSTER_KEY) {
      return []
    }
    // TODO Phase 7.5+: implement the real PhantomBuster polling +
    // CSV/JSON drop ingestion. Schema mapping:
    //   - PhantomBuster's "currentJobTitle" delta → new_title
    //   - "currentCompanyName" delta + "currentCompanyDomain" → new_domain
    //   - "lastUpdateDate" → detected_at
    //   - external_move = (oldCompany !== newCompany)
    console.warn('[linkedin-sn] adapter not yet implemented — returning empty')
    return []
  }
}
