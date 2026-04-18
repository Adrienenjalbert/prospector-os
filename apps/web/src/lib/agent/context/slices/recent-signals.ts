import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import { citeSignal, fmtAge, urnInline } from './_helpers'

/**
 * `recent-signals` — top buying / context signals across the rep's book in
 * the last 14 days, ordered by `weighted_score`. Loaded for
 * signal_triage / meeting_prep / risk_analysis intents.
 *
 * The bandit will tune which signals matter most per tenant; this slice
 * just makes the recent-window honest.
 */

interface SignalRow {
  id: string
  company_id: string
  company_name: string
  signal_type: string
  title: string
  urgency: string
  relevance_score: number
  weighted_score: number | null
  detected_at: string
  source_url: string | null
}

export const recentSignalsSlice: ContextSlice<SignalRow> = {
  slug: 'recent-signals',
  title: 'Recent signals',
  category: 'account',

  triggers: {
    intents: [
      'signal_triage',
      'meeting_prep',
      'risk_analysis',
      'forecast',
      'portfolio_health',
    ],
    roles: ['ae', 'nae', 'growth_ae', 'csm', 'ad', 'leader'],
  },

  staleness: {
    ttl_ms: 6 * 60 * 60 * 1000,
    invalidate_on: ['cron/signals'],
  },

  token_budget: 300,
  soft_timeout_ms: 1500,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<SignalRow>> {
    const startedAt = Date.now()

    // Scope to the rep's accounts when known; otherwise to the active
    // company; otherwise tenant-wide (caps to top by weighted_score).
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

    let companyIds: string[] | null = null

    if (ctx.activeCompanyId) {
      companyIds = [ctx.activeCompanyId]
    } else if (ctx.repId) {
      const { data: ownedCompanies } = await ctx.supabase
        .from('companies')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('owner_crm_id', ctx.repId)
        .limit(50)
      companyIds = (ownedCompanies ?? []).map((c) => c.id)
      if (companyIds.length === 0) companyIds = null
    }

    let signalsQuery = ctx.supabase
      .from('signals')
      .select(
        'id, company_id, signal_type, title, urgency, relevance_score, weighted_score, detected_at, source_url',
      )
      .eq('tenant_id', ctx.tenantId)
      .gte('detected_at', since)
      .order('weighted_score', { ascending: false })
      .limit(8)

    if (companyIds) {
      signalsQuery = signalsQuery.in('company_id', companyIds)
    }

    const { data: signals, error } = await signalsQuery
    if (error) {
      throw new Error(`recent-signals query failed: ${error.message}`)
    }
    const signalRows = signals ?? []
    if (signalRows.length === 0) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: ['No signals detected in last 14 days for this scope.'],
      }
    }

    const uniqueCompanyIds = [...new Set(signalRows.map((s) => s.company_id).filter(Boolean))]
    const companyName = new Map<string, string>()
    if (uniqueCompanyIds.length > 0) {
      const { data: companies } = await ctx.supabase
        .from('companies')
        .select('id, name')
        .eq('tenant_id', ctx.tenantId)
        .in('id', uniqueCompanyIds)
      for (const c of companies ?? []) companyName.set(c.id, c.name)
    }

    const rows: SignalRow[] = signalRows.map((s) => ({
      id: s.id,
      company_id: s.company_id,
      company_name: companyName.get(s.company_id) ?? 'Unknown',
      signal_type: s.signal_type,
      title: s.title,
      urgency: s.urgency,
      relevance_score: s.relevance_score,
      weighted_score: s.weighted_score,
      detected_at: s.detected_at,
      source_url: s.source_url,
    }))

    return {
      rows,
      citations: rows.map((r) => citeSignal(r)),
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
    }
  },

  formatForPrompt(rows: SignalRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) {
      return '### Recent signals (14d)\n_No signals detected in this window._'
    }
    const tenantId = fmtCtx?.tenantId ?? ''
    const lines = rows.slice(0, 6).map((r) => {
      return `- [${r.urgency}] ${r.company_name}: ${r.title} ${urnInline(tenantId, 'signal', r.id)} — ${fmtAge(r.detected_at)}`
    })
    return `### Recent signals (${rows.length} in 14d)\n${lines.join('\n')}`
  },

  citeRow(row) {
    return {
      claim_text: row.title,
      source_type: 'signal',
      source_id: row.id,
      source_url: row.source_url ?? undefined,
    }
  },
}
