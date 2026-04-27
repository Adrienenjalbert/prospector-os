import type {
  FetchIntentOpts,
  IntentDataAdapter,
  IntentSignalRow,
} from './interface'

/**
 * BomboraAdapter — Phase 7 (Section 4.3) STUB.
 *
 * Bombora is the leading B2B intent-data vendor: anonymized topic-
 * level signals across the open web ("Acme has been researching
 * 'data observability' for 21 days"). The full integration is a
 * paid vendor lift (Bombora Surge API + per-tenant company list
 * sync); this stub ships the interface so the rest of Phase 7 can
 * compose against it without taking on the vendor commitment.
 *
 * When a customer brings a Bombora API key, replace this stub with
 * the real impl in one PR. No other code changes — the signals cron
 * loads adapters by name and treats the empty result here as "no
 * intent today".
 */
export class BomboraAdapter implements IntentDataAdapter {
  vendor = 'bombora'
  capabilities = {
    topics: true,
    pageVisits: false, // Bombora is topic-level, not page-level
    firmographicsLookup: false,
  }
  costPerCall = 0.05 // approximate; real cost is licence-based + per-call

  // Constructor signature ready for future apiKey parameter.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_apiKey?: string | null) {
    // No-op until we ship the real impl.
  }

  async fetchIntent(opts: FetchIntentOpts): Promise<IntentSignalRow[]> {
    void opts
    if (!process.env.BOMBORA_API_KEY) {
      return [] // silent skip — adapter not configured
    }
    // TODO Phase 7.5+: implement the real Bombora Surge API call.
    // The shape of the surge response maps cleanly to IntentSignalRow:
    //   - one signal per (account, topic) pair with surge >= threshold
    //   - signal_type = 'intent_topic'
    //   - description = "Researching topic '${topic}' for ${days} days"
    //   - weighted_score = surge × 100
    console.warn('[bombora] adapter not yet implemented — returning empty')
    return []
  }
}
