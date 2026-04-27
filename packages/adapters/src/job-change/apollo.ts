import { ApolloAdapter } from '../enrichment/apollo'
import type {
  FetchJobChangesOpts,
  JobChangeAdapter,
  JobChangeRow,
} from './interface'

/**
 * ApolloJobChangeAdapter — Phase 7 (Section 4.2) reference impl.
 *
 * Wraps the existing Apollo `enrichPerson` (used today by
 * champion-alumni-detector + refresh-contacts) in the
 * JobChangeAdapter interface so the signals cron can compose
 * adapters uniformly.
 *
 * Note: refresh-contacts already calls enrichPerson directly. This
 * adapter exists for the signals cron's adapter-pattern fan-out so
 * a tenant can swap to LinkedInSalesNavAdapter or another vendor
 * without changing the cron. When both Apollo and LinkedIn SN are
 * configured, the cron prefers SN (more accurate, more expensive)
 * and falls back to Apollo.
 *
 * Detects EXTERNAL moves only — internal role-change detection
 * requires a stable prior-title baseline that Apollo doesn't
 * directly expose; mine-internal-movers handles internal moves via
 * the title diff after refresh-contacts updates.
 */
export class ApolloJobChangeAdapter implements JobChangeAdapter {
  vendor = 'apollo_job_change'
  capabilities = {
    detectExternal: true,
    detectInternal: false,
    confidenceScored: false,
  }
  costPerCall = 0.01

  private apollo: ApolloAdapter | null

  constructor(apiKey?: string | null) {
    const key = apiKey ?? process.env.APOLLO_API_KEY ?? null
    this.apollo = key ? new ApolloAdapter(key) : null
  }

  async fetchChanges(opts: FetchJobChangesOpts): Promise<JobChangeRow[]> {
    if (!this.apollo) {
      console.warn('[apollo-job-change] APOLLO_API_KEY not set — adapter returning empty')
      return []
    }

    const out: JobChangeRow[] = []
    const limit = opts.limit ?? opts.contacts.length
    const candidates = opts.contacts.slice(0, limit)
    const now = new Date().toISOString()

    for (const contact of candidates) {
      if (!contact.email) continue
      try {
        const enriched = await this.apollo.enrichPerson(contact.email)
        const newDomain = enriched?.current_organization?.domain ?? null
        const newName = enriched?.current_organization?.name ?? null
        const newTitle = enriched?.title ?? null
        if (!newDomain && !newName) continue

        // We only emit a row when domain looks suspicious from the
        // CALLER's perspective. The signals cron passes us the
        // contact's CURRENT company_domain via the wrapping context
        // (Section 4.2 wires this up); the adapter itself can't
        // know it. So we emit ALL refreshed contacts and let the
        // caller filter — keeps the adapter simple and stateless.
        out.push({
          contact_id: contact.contact_id,
          signal_type: 'job_change',
          external_move: !!newDomain,
          new_domain: newDomain,
          new_title: newTitle,
          title: `Apollo refresh detected new role for contact ${contact.contact_id.slice(0, 8)}`,
          description: `New employer domain: ${newDomain ?? '(none)'}; new title: ${newTitle ?? '(none)'}.`,
          source: 'apollo_job_change',
          relevance_score: 0.85,
          weighted_score: 75,
          urgency: 'this_week',
          detected_at: now,
          raw: { name: newName, title: newTitle },
        })
      } catch (err) {
        console.warn(`[apollo-job-change] enrichPerson failed for ${contact.email}:`, err)
      }
    }
    return out
  }
}
