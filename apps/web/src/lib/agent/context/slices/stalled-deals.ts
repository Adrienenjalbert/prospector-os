import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import {
  citeBenchmark,
  citeOpportunity,
  fmtMoney,
  urnInline,
} from './_helpers'

/**
 * `stalled-deals` — opportunities the rep owns that are flagged stalled
 * (`is_stalled = true`), joined to the company benchmark for the stage so
 * the agent can quote concrete "X days vs median Y days" framing.
 *
 * Loaded for risk_analysis / diagnosis / forecast intents and any time the
 * active deal is itself stalled (selector boost via `whenStalled`).
 *
 * Mirrors today's `assembleAgentContext.stalled_deals` field but with
 * URN-per-row and benchmark citation included.
 */

interface StalledDealRow {
  id: string
  crm_id: string | null
  name: string
  company_id: string
  company_name: string
  stage: string
  value: number | null
  days_in_stage: number
  median_days: number
  stall_reason: string | null
  expected_close_date: string | null
}

export const stalledDealsSlice: ContextSlice<StalledDealRow> = {
  slug: 'stalled-deals',
  title: 'Stalled deals',
  category: 'pipeline',

  triggers: {
    intents: ['risk_analysis', 'diagnosis', 'forecast', 'portfolio_health'],
    roles: ['ae', 'nae', 'growth_ae', 'leader', 'ad'],
    whenStalled: true,
  },

  staleness: {
    ttl_ms: 6 * 60 * 60 * 1000,
    invalidate_on: ['cron/sync', 'cron/score'],
  },

  token_budget: 400,
  soft_timeout_ms: 1500,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<StalledDealRow>> {
    const startedAt = Date.now()

    const { data: deals, error } = await ctx.supabase
      .from('opportunities')
      .select(
        'id, crm_id, name, company_id, stage, value, days_in_stage, stall_reason, expected_close_date',
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('owner_crm_id', ctx.repId)
      .eq('is_stalled', true)
      .eq('is_closed', false)
      .order('value', { ascending: false })
      .limit(8)

    if (error) {
      throw new Error(`stalled-deals query failed: ${error.message}`)
    }
    const dealRows = deals ?? []

    if (dealRows.length === 0) {
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

    const companyIds = [...new Set(dealRows.map((d) => d.company_id).filter(Boolean))]
    const stageNames = [...new Set(dealRows.map((d) => d.stage).filter(Boolean))]

    const [companiesRes, benchRes] = await Promise.all([
      companyIds.length > 0
        ? ctx.supabase
            .from('companies')
            .select('id, name')
            .eq('tenant_id', ctx.tenantId)
            .in('id', companyIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      stageNames.length > 0
        ? ctx.supabase
            .from('funnel_benchmarks')
            .select('stage_name, median_days_in_stage')
            .eq('tenant_id', ctx.tenantId)
            .eq('scope', 'company')
            .eq('scope_id', 'all')
            .in('stage_name', stageNames)
        : Promise.resolve({ data: [] as { stage_name: string; median_days_in_stage: number }[] }),
    ])

    const companyName = new Map<string, string>(
      (companiesRes.data ?? []).map((c) => [c.id, c.name]),
    )
    const medianByStage = new Map<string, number>(
      (benchRes.data ?? []).map((b) => [b.stage_name, b.median_days_in_stage]),
    )

    const rows: StalledDealRow[] = dealRows.map((d) => ({
      id: d.id,
      crm_id: d.crm_id,
      name: d.name,
      company_id: d.company_id,
      company_name: companyName.get(d.company_id) ?? 'Unknown',
      stage: d.stage,
      value: d.value,
      days_in_stage: d.days_in_stage ?? 0,
      median_days: medianByStage.get(d.stage) ?? 14,
      stall_reason: d.stall_reason,
      expected_close_date: d.expected_close_date,
    }))

    const citations = [
      ...rows.map((r) => citeOpportunity(ctx.tenantId, ctx.crmType, r)),
      ...stageNames.map((s) => citeBenchmark(s)),
    ]

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

  formatForPrompt(rows: StalledDealRow[]): string {
    if (rows.length === 0) {
      return '### Stalled deals\n_No deals currently flagged stalled — clean slate._'
    }
    const lines = rows.slice(0, 6).map((r) => {
      const reason = r.stall_reason ? ` — ${r.stall_reason}` : ''
      return `- ${r.company_name} "${r.name}" ${urnInline('opportunity', r.id)} — ${r.stage} ${r.days_in_stage}d (median ${r.median_days}d), ${fmtMoney(r.value)}${reason}`
    })
    return `### Stalled deals (${rows.length})\n${lines.join('\n')}`
  },

  citeRow(row) {
    return {
      claim_text: `${row.company_name} — ${row.name}`,
      source_type: 'opportunity',
      source_id: row.id,
    }
  },
}
