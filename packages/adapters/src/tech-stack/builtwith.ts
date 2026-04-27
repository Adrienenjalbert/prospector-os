import type {
  FetchTechStackChangesOpts,
  TechStackAdapter,
  TechStackChangeRow,
} from './interface'

/**
 * BuiltWithAdapter — Phase 7 (Section 4.3) STUB.
 *
 * BuiltWith maintains a tech-stack history per domain — when a
 * company adds Salesforce, removes HubSpot, switches CDPs, etc.
 * Real impl would call BuiltWith's "Lists API" with the tenant's
 * domain set + watchedVendors filter, diff against the previous
 * snapshot, emit one tech_stack_change signal per delta.
 *
 * Stub returns empty until BUILTWITH_API_KEY is configured AND a
 * customer pilots with their seat. The composite-trigger pattern
 * `tech_stack_competitor_swap` waits for this adapter; the matcher
 * scaffolding is already live in mineCompositeTriggers.
 */
export class BuiltWithAdapter implements TechStackAdapter {
  vendor = 'builtwith'
  capabilities = {
    detectAdds: true,
    detectRemoves: true,
    confidenceScored: false, // BuiltWith reports binary present/absent
  }
  costPerCall = 0.02

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_apiKey?: string | null) {}

  async fetchChanges(opts: FetchTechStackChangesOpts): Promise<TechStackChangeRow[]> {
    void opts
    if (!process.env.BUILTWITH_API_KEY) {
      return []
    }
    // TODO Phase 7.5+: implement the real BuiltWith Lists API call.
    // Convention for the description field that mineCompositeTriggers's
    // matchTechStackCompetitorSwap pattern looks for:
    //   "swap:competitor=<old_vendor> add:tech=<new_vendor>"
    console.warn('[builtwith] adapter not yet implemented — returning empty')
    return []
  }
}
