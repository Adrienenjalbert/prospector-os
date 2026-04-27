import { urn, type PendingCitation } from '@prospector/core'
import { loadMemoriesByScope } from '@/lib/memory/writer'
import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'

/**
 * `motion-fingerprint` (Phase 4 of the smart memory layer) — for the
 * active deal's current stage, surfaces the tenant's own won-deal
 * median time + a deviation flag.
 *
 * Difference vs `stalled-deals` and `funnel-comparison`:
 *
 *   - stalled-deals quotes a benchmark median computed across ALL
 *     deals (won + lost + open). The median is biased by lost,
 *     stalled deals — exactly the population you want to ESCAPE.
 *
 *   - funnel-comparison compares the rep's stage distribution to
 *     the company average — a portfolio-level metric, not a
 *     per-deal one.
 *
 *   - This slice quotes the WON-ONLY median per stage, scoped to the
 *     active deal's current stage. The agent says "your wins close
 *     Proposal in 9 days median; this deal is at 22 — that's a
 *     2.5× deviation, intervene now" instead of the generic
 *     "stalled X days".
 *
 * Slice never injects without an active deal — there's nothing to
 * compare against without a stage.
 *
 * Phase 6 (Section 2.4) note: motion-fingerprint deliberately does NOT
 * refactor to pages-first. The slice's value comes from per-stage
 * NUMERICAL comparison (median_days, deviation_factor) computed at
 * load time against the active deal's days_in_stage. The compiled
 * `concept_motion/tenant-wide` page is a single tenant-wide page with
 * sections per stage — extracting stage-specific numbers from
 * markdown would be brittle. Keeping the atom-direct path means the
 * slice always has the precise stage scope it needs. Page-side
 * tenant-wide motion narrative is surfaced by other slices
 * (icp-snapshot, when relevant).
 */

interface MotionMemoryRow {
  id: string
  kind: string
  title: string
  body: string
  scope: { stage?: string }
  evidence: { urns?: string[]; counts?: Record<string, number>; samples?: string[] }
  confidence: number
}

interface MotionFingerprintRow {
  memory: MotionMemoryRow
  current_stage: string
  current_days_in_stage: number | null
  median_days_on_wins: number
  deviation_factor: number | null
}

const STRONG_DEVIATION = 1.75

export const motionFingerprintSlice: ContextSlice<MotionFingerprintRow> = {
  slug: 'motion-fingerprint',
  title: 'Sales-motion fingerprint',
  category: 'pipeline',

  triggers: {
    intents: ['risk_analysis', 'diagnosis', 'forecast', 'meeting_prep'],
    objects: ['deal'],
    whenStalled: true,
  },

  staleness: {
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/learning', 'cron/sync'],
  },

  token_budget: 300,
  soft_timeout_ms: 800,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<MotionFingerprintRow>> {
    const startedAt = Date.now()

    if (!ctx.activeDealId) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: ['motion-fingerprint loaded without an active deal — selector misroute.'],
      }
    }

    const { data: deal } = await ctx.supabase
      .from('opportunities')
      .select('stage, days_in_stage, is_stalled')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', ctx.activeDealId)
      .maybeSingle()

    const stage = typeof deal?.stage === 'string' ? deal.stage : null
    if (!stage) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
      }
    }

    const memories = (await loadMemoriesByScope(ctx.supabase, {
      tenant_id: ctx.tenantId,
      kind: 'motion_step',
      stage,
      limit: 1,
    })) as MotionMemoryRow[]

    if (memories.length === 0) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: [
          `No motion fingerprint for stage "${stage}" yet — derive-sales-motion needs ≥5 won deals at this stage.`,
        ],
      }
    }

    const memory = memories[0]
    const median = Number(memory.evidence.counts?.median_days ?? 0)
    const currentDays = typeof deal?.days_in_stage === 'number' ? deal.days_in_stage : null
    const deviationFactor = median > 0 && currentDays !== null ? currentDays / median : null

    const row: MotionFingerprintRow = {
      memory,
      current_stage: stage,
      current_days_in_stage: currentDays,
      median_days_on_wins: median,
      deviation_factor: deviationFactor,
    }

    const citations: PendingCitation[] = [
      { claim_text: memory.title, source_type: 'memory', source_id: memory.id },
    ]
    for (const evidenceUrn of (memory.evidence.urns ?? []).slice(0, 2)) {
      citations.push({
        claim_text: 'Source won deal',
        source_type: 'opportunity',
        source_id: evidenceUrn.split(':').pop() ?? evidenceUrn,
      })
    }

    return {
      rows: [row],
      citations,
      // Phase 6 (1.2) — close the bandit loop on the underlying atom.
      injectedMemoryIds: [memory.id],
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
    }
  },

  formatForPrompt(rows: MotionFingerprintRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) return ''
    const r = rows[0]
    const tenantId = fmtCtx?.tenantId ?? ''
    const memoryUrn = `\`${urn.memory(tenantId, r.memory.id)}\``

    const deviationLabel =
      r.deviation_factor === null
        ? 'No current stage age data'
        : r.deviation_factor >= STRONG_DEVIATION
          ? `**MOTION DEVIATION**: ${r.deviation_factor.toFixed(1)}× the won-deal median (${r.current_days_in_stage}d vs ${r.median_days_on_wins}d). Surface this — the deal is materially behind your usual win cadence.`
          : r.deviation_factor >= 1.2
            ? `Slight deviation: ${r.deviation_factor.toFixed(1)}× won-deal median (${r.current_days_in_stage}d vs ${r.median_days_on_wins}d).`
            : `On-track: ${r.deviation_factor.toFixed(1)}× won-deal median (${r.current_days_in_stage}d vs ${r.median_days_on_wins}d).`

    return [
      "### Sales motion vs your won-deal pattern",
      `- **Stage:** ${r.current_stage}`,
      `- **Your wins close ${r.current_stage} in:** ${r.median_days_on_wins} day${r.median_days_on_wins === 1 ? '' : 's'} (median) ${memoryUrn}`,
      `- ${deviationLabel}`,
      `  ${r.memory.body}`,
    ].join('\n')
  },

  citeRow(row: MotionFingerprintRow) {
    return {
      claim_text: row.memory.title,
      source_type: 'memory',
      source_id: row.memory.id,
    }
  },
}
