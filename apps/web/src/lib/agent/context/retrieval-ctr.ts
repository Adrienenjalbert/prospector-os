import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Retrieval-prior CTR booster (C5.3).
 *
 * Until now the `retrieval_priors` table was a write-only tombstone:
 * citation clicks landed there (via `recordCitationClick`) but
 * nothing ever READ them to influence ranking. The "citation pills
 * feed the retrieval ranker" promise was theatre.
 *
 * This module loads the priors keyed by `source_type` (the closest
 * proxy to "slice citation type" we have today — companies, deals,
 * signals, contacts, transcripts) and converts them to per-source
 * CTR scores. The packer multiplies its slice scores by a small
 * factor derived from CTR: slices that historically produced clicked
 * citations get a small bump.
 *
 * We deliberately keep the bump SMALL (max ±2 points on a ~10-point
 * baseline score). The bandit is the primary learning signal; CTR
 * is a secondary nudge so the slice selector starts to learn which
 * RAG sources actually drive engagement.
 */

export interface RetrievalCtrTable {
  /** source_type → CTR (clicks / max(impressions, 1)) */
  ctrBySourceType: Map<string, number>
  /** source_type → impression count (for debugging) */
  impressionsBySourceType: Map<string, number>
  /** When the table was loaded (for telemetry / cache freshness). */
  loadedAt: string
}

const MIN_IMPRESSIONS_FOR_TRUST = 10
const MAX_BUMP = 2

export async function loadRetrievalCtr(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<RetrievalCtrTable> {
  const ctrBySourceType = new Map<string, number>()
  const impressionsBySourceType = new Map<string, number>()
  const loadedAt = new Date().toISOString()

  try {
    const { data } = await supabase
      .from('retrieval_priors')
      .select('source_type, impressions, clicks')
      .eq('tenant_id', tenantId)

    // Aggregate across source_id so we get one row per source_type.
    const aggImp = new Map<string, number>()
    const aggClk = new Map<string, number>()
    for (const r of data ?? []) {
      const t = String(r.source_type)
      aggImp.set(t, (aggImp.get(t) ?? 0) + Number(r.impressions ?? 0))
      aggClk.set(t, (aggClk.get(t) ?? 0) + Number(r.clicks ?? 0))
    }

    for (const [t, imp] of aggImp) {
      impressionsBySourceType.set(t, imp)
      if (imp < MIN_IMPRESSIONS_FOR_TRUST) {
        continue
      }
      const clk = aggClk.get(t) ?? 0
      ctrBySourceType.set(t, clk / Math.max(imp, 1))
    }
  } catch (err) {
    // Table missing / RLS blocked / network — degrade silently. This
    // signal is a soft secondary nudge, never required.
    console.warn('[retrieval-ctr] load failed:', err)
  }

  return { ctrBySourceType, impressionsBySourceType, loadedAt }
}

/**
 * Map slice slugs to the citation `source_type` they typically
 * produce. The selector uses this mapping to translate slice-level
 * scoring into source-level CTR adjustments.
 *
 * Add a new slice here when you ship one — the validator could AST-
 * enforce this in a future Sprint.
 */
const SLICE_TO_SOURCE_TYPE: Record<string, string> = {
  'priority-accounts': 'company',
  'stalled-deals': 'opportunity',
  'current-deal-health': 'opportunity',
  'current-company-snapshot': 'company',
  'transcript-summaries': 'transcript',
  'key-contact-notes': 'contact',
  'relevant-notes-rag': 'contact',
  'recent-signals': 'signal',
  'champion-map': 'contact',
  'champion-alumni-opportunities': 'contact',
  'cross-sell-opportunities': 'opportunity',
}

/**
 * Convert a per-source-type CTR table into a per-slice score
 * adjustment in [-MAX_BUMP, +MAX_BUMP]. Higher CTR = positive bump,
 * very low CTR (< 1%) = small negative bump.
 *
 * Returns 0 for slices the mapping doesn't cover, OR for sources
 * with too few impressions (less than MIN_IMPRESSIONS_FOR_TRUST). We
 * never bump on noise.
 */
export function ctrAdjustment(
  table: RetrievalCtrTable,
  sliceSlug: string,
): number {
  const sourceType = SLICE_TO_SOURCE_TYPE[sliceSlug]
  if (!sourceType) return 0
  const ctr = table.ctrBySourceType.get(sourceType)
  if (ctr === undefined) return 0

  // Map CTR ranges to score deltas. Conservative — the bandit
  // already provides ±2 in its own logic; CTR is a tiebreaker, not
  // an override.
  if (ctr >= 0.2) return MAX_BUMP // very high CTR (20%+)
  if (ctr >= 0.1) return MAX_BUMP / 2
  if (ctr >= 0.05) return MAX_BUMP / 4
  if (ctr <= 0.01) return -MAX_BUMP / 4 // ignored / dead source
  return 0
}
