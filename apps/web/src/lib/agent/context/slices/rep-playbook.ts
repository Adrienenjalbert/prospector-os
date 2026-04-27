import { urn, type PendingCitation } from '@prospector/core'
import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'

/**
 * `rep-playbook` (Phase 5 of the smart memory layer) — surfaces:
 *
 *   1. The active rep's own playbook memory (mine-rep-playbook,
 *      scope: {rep_id, segment: 'per_rep'}).
 *   2. The tenant-wide top-quartile playbook (mine-rep-playbook,
 *      scope: {segment: 'top_quartile'}) — "the bar".
 *   3. The stage_best_practice memory matching the active deal's
 *      current stage (mine-stage-best-practice, scope: {stage}).
 *
 * The combined slice is what makes the inbox top-1 action concrete:
 * the agent has the rep's gap to top-quartile + the differential
 * factor at the current stage, so the action verb falls out
 * naturally ("multi-thread to 7" vs a generic "follow up").
 *
 * Per-rep memories use the canonical `scope.rep_id` field on
 * tenant_memories; we resolve the active rep_id from `ctx.repId`
 * (already passed by the packer; same value the agent route uses
 * for tool selection).
 */

interface PlaybookMemoryRow {
  id: string
  kind: string
  title: string
  body: string
  scope: { rep_id?: string; stage?: string; segment?: string }
  evidence: { urns?: string[]; counts?: Record<string, number>; samples?: string[] }
  confidence: number
}

export const repPlaybookSlice: ContextSlice<PlaybookMemoryRow> = {
  slug: 'rep-playbook',
  title: 'Your playbook (vs top quartile)',
  category: 'learning',

  triggers: {
    intents: ['meeting_prep', 'diagnosis', 'risk_analysis', 'general_query'],
    roles: ['ae', 'nae', 'growth_ae', 'csm', 'ad', 'rep'],
  },

  staleness: {
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/learning'],
  },

  // Three small memories at most: per-rep + top-quartile + stage.
  token_budget: 600,
  soft_timeout_ms: 800,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<PlaybookMemoryRow>> {
    const startedAt = Date.now()

    // Pull the per-rep memory keyed on the active rep_id. ctx.repId is
    // the rep_profiles.id (not the CRM id) — same value the rep
    // playbook miner writes into scope.
    const perRepPromise = ctx.supabase
      .from('tenant_memories')
      .select('id, kind, title, body, scope, evidence, confidence')
      .eq('tenant_id', ctx.tenantId)
      .eq('kind', 'rep_playbook')
      .in('status', ['approved', 'pinned'])
      .eq('scope->>rep_id', ctx.repId)
      .limit(1)
      .maybeSingle()

    const topQuartilePromise = ctx.supabase
      .from('tenant_memories')
      .select('id, kind, title, body, scope, evidence, confidence')
      .eq('tenant_id', ctx.tenantId)
      .eq('kind', 'rep_playbook')
      .in('status', ['approved', 'pinned'])
      .eq('scope->>segment', 'top_quartile')
      .limit(1)
      .maybeSingle()

    // Stage memory only when there's an active deal.
    let stage: string | null = null
    if (ctx.activeDealId) {
      const { data: deal } = await ctx.supabase
        .from('opportunities')
        .select('stage')
        .eq('tenant_id', ctx.tenantId)
        .eq('id', ctx.activeDealId)
        .maybeSingle()
      stage =
        typeof deal?.stage === 'string' && deal.stage.length > 0
          ? deal.stage
          : null
    }

    const stagePromise = stage
      ? ctx.supabase
          .from('tenant_memories')
          .select('id, kind, title, body, scope, evidence, confidence')
          .eq('tenant_id', ctx.tenantId)
          .eq('kind', 'stage_best_practice')
          .in('status', ['approved', 'pinned'])
          .eq('scope->>stage', stage)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null })

    const [perRepRes, topQuartileRes, stageRes] = await Promise.all([
      perRepPromise,
      topQuartilePromise,
      stagePromise,
    ])

    const rows: PlaybookMemoryRow[] = []
    if (perRepRes.data) rows.push(perRepRes.data as PlaybookMemoryRow)
    if (topQuartileRes.data) rows.push(topQuartileRes.data as PlaybookMemoryRow)
    if (stageRes.data) rows.push(stageRes.data as PlaybookMemoryRow)

    if (rows.length === 0) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: [
          'No rep-playbook memories yet — mine-rep-playbook + mine-stage-best-practice need ≥8 closed deals per rep / stage.',
        ],
      }
    }

    const citations: PendingCitation[] = rows.map((m) => ({
      claim_text: m.title,
      source_type: 'memory',
      source_id: m.id,
    }))

    return {
      rows,
      citations,
      // Phase 6 (1.2) — close the bandit loop on rep playbook atoms.
      injectedMemoryIds: rows.map((m) => m.id),
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
    }
  },

  formatForPrompt(rows: PlaybookMemoryRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) return ''
    const tenantId = fmtCtx?.tenantId ?? ''
    const lines: string[] = []
    lines.push("### Playbook (you vs top quartile + stage best practice)")
    lines.push(
      'When recommending a single next action, lean on the verb the stage best-practice memory suggests.',
    )
    for (const m of rows) {
      const memoryUrn = `\`${urn.memory(tenantId, m.id)}\``
      const conf =
        m.confidence < 0.4
          ? ' _(low-confidence)_'
          : m.confidence >= 0.85
            ? ' _(high-confidence)_'
            : ''
      lines.push(`- **${m.title}**${conf} ${memoryUrn}`)
      lines.push(`  ${m.body}`)
    }
    return lines.join('\n')
  },

  citeRow(row: PlaybookMemoryRow) {
    return {
      claim_text: row.title,
      source_type: 'memory',
      source_id: row.id,
    }
  },
}
