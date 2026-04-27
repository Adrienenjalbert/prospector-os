import {
  urn,
  TRIGGER_PATTERN_LABELS,
  type PendingCitation,
  type TriggerPattern,
} from '@prospector/core'
import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'

/**
 * `trigger-now` (Phase 7, Section 6.3) — surfaces the strongest open
 * composite triggers for the rep's book at the start of every turn.
 *
 * One slice load = top-3 open triggers ordered by trigger_score
 * desc, scoped to companies the rep owns. Each row carries the
 * pattern, the company, the rationale, and a recommended_tool slug
 * the agent can chain into.
 *
 * Why always-on for AE / CSM / AD: the trigger surface is the
 * "smaller decision" replacement for the heuristic urgency surface.
 * Adoption-research mistake #2 (cognitive load) is the strongest
 * argument for always loading it — without this slice the rep is
 * back to mentally composing signal × bridge × enrichment per turn.
 *
 * Token budget: 400 (3 triggers × ~120 tokens). Smaller than the
 * priority-accounts slice but more decision-dense.
 */

interface TriggerRow {
  id: string
  pattern: TriggerPattern
  company_id: string | null
  company_name: string | null
  trigger_score: number
  rationale: string
  recommended_action: string | null
  recommended_tool: string | null
  detected_at: string
}

const TOP_K = 3
const MIN_SCORE = 0.5

export const triggerNowSlice: ContextSlice<TriggerRow> = {
  slug: 'trigger-now',
  title: 'Triggers — act now',
  category: 'pipeline',

  triggers: {
    intents: [
      'lookup',
      'meeting_prep',
      'risk_analysis',
      'forecast',
      'portfolio_health',
      'general_query',
      'signal_triage',
      'draft_outreach',
    ],
    roles: ['ae', 'nae', 'growth_ae', 'ad', 'csm'],
  },

  staleness: {
    // Triggers refresh nightly via mineCompositeTriggers; 24h TTL
    // means the agent doesn't load stale "act now" decisions.
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/learning'],
  },

  token_budget: 400,
  soft_timeout_ms: 800,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<TriggerRow>> {
    const startedAt = Date.now()

    // Scope to companies the rep owns. Triggers exist at the
    // tenant level, but only the rep's book is action-relevant
    // for them. We pull owned companies first then filter.
    const { data: ownedCompanies } = await ctx.supabase
      .from('companies')
      .select('id, name')
      .eq('tenant_id', ctx.tenantId)
      .eq('owner_crm_id', ctx.repId)
      .limit(500)

    const ownedCompanyIds = (ownedCompanies ?? []).map((c) => c.id as string)
    if (ownedCompanyIds.length === 0) {
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

    const ownedCompanyById = new Map(
      (ownedCompanies ?? []).map((c) => [c.id as string, c.name as string]),
    )

    const { data: triggers, error } = await ctx.supabase
      .from('triggers')
      .select(
        'id, pattern, company_id, trigger_score, rationale, recommended_action, recommended_tool, detected_at',
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'open')
      .gte('trigger_score', MIN_SCORE)
      .in('company_id', ownedCompanyIds)
      .order('trigger_score', { ascending: false })
      .limit(TOP_K)

    if (error) {
      // Triggers table may not exist yet (deployments still on
      // migration <024). Same defensive pattern as the wiki loader:
      // empty result, no warning crash.
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

    const rows: TriggerRow[] = (triggers ?? []).map((t) => ({
      id: t.id as string,
      pattern: t.pattern as TriggerPattern,
      company_id: t.company_id as string | null,
      company_name: t.company_id ? ownedCompanyById.get(t.company_id as string) ?? null : null,
      trigger_score: Number(t.trigger_score),
      rationale: t.rationale as string,
      recommended_action: (t.recommended_action as string | null) ?? null,
      recommended_tool: (t.recommended_tool as string | null) ?? null,
      detected_at: t.detected_at as string,
    }))

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
          'No active triggers — composite trigger miner runs nightly; check back tomorrow.',
        ],
      }
    }

    const citations: PendingCitation[] = []
    for (const r of rows) {
      // Trigger URN — pill deep-links to /admin/triggers when admin,
      // /companies/[id] when rep.
      citations.push({
        claim_text: r.rationale.slice(0, 80),
        source_type: 'trigger',
        source_id: r.id,
      })
      if (r.company_id) {
        citations.push({
          claim_text: r.company_name ?? 'Account',
          source_type: 'company',
          source_id: r.company_id,
        })
      }
    }

    return {
      rows,
      citations,
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
    }
  },

  formatForPrompt(rows: TriggerRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) return ''
    const tenantId = fmtCtx?.tenantId ?? ''

    const lines: string[] = []
    lines.push("### Composite triggers (act today)")
    lines.push(
      'Each row is one ready-to-act event. Quote the inline `urn:rev:...:trigger:...` token to surface the citation pill. When recommending a single next step, prefer the trigger\'s `recommended_tool`.',
    )
    for (const r of rows) {
      const triggerUrn = `\`${urn.trigger(tenantId, r.id)}\``
      const companyUrn = r.company_id
        ? ` at \`${urn.company(tenantId, r.company_id)}\``
        : ''
      const patternLabel = TRIGGER_PATTERN_LABELS[r.pattern] ?? r.pattern
      lines.push(`- **${patternLabel}** (score ${r.trigger_score.toFixed(2)})${companyUrn} ${triggerUrn}`)
      lines.push(`  ${r.rationale}`)
      if (r.recommended_action) {
        lines.push(`  → Next: ${r.recommended_action}${r.recommended_tool ? ` (\`${r.recommended_tool}\`)` : ''}`)
      }
    }
    return lines.join('\n')
  },

  citeRow(row: TriggerRow) {
    return {
      claim_text: row.rationale.slice(0, 80),
      source_type: 'trigger',
      source_id: row.id,
    }
  },
}
