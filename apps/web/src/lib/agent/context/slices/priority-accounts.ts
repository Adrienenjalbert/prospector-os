import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import {
  citeCompany,
  citeOpportunity,
  estimateTokens,
  fmtMoney,
  urnInline,
} from './_helpers'

/**
 * `priority-accounts` — top accounts the rep should think about right now.
 *
 * Mirrors the existing rep-centric assembler's `priority_accounts` field
 * but with two upgrades:
 *   1. URN per row (so the agent's claims about a specific account cite
 *      the canonical record).
 *   2. Compact, scannable markdown formatting that respects the slice's
 *      token budget.
 *
 * Loaded by default for AE/NAE/growth_AE roles when no specific object is
 * active. The selector also boosts it for `meeting_prep`, `draft_outreach`,
 * `portfolio_health`, and `forecast` intents.
 */

interface PriorityAccountRow {
  id: string
  crm_id: string | null
  name: string
  expected_revenue: number | null
  propensity: number | null
  priority_tier: string | null
  priority_reason: string | null
  icp_tier: string | null
  /** Top open opportunity on this account (largest by value). */
  top_deal: {
    id: string
    crm_id: string | null
    name: string
    value: number | null
    stage: string | null
    days_in_stage: number | null
    is_stalled: boolean
  } | null
  signal_count: number
  top_signal: string | null
}

export const prioritySlice: ContextSlice<PriorityAccountRow> = {
  slug: 'priority-accounts',
  title: 'Priority accounts',
  category: 'pipeline',

  triggers: {
    intents: [
      'meeting_prep',
      'draft_outreach',
      'portfolio_health',
      'forecast',
      'lookup',
      'general_query',
    ],
    roles: ['ae', 'nae', 'growth_ae'],
    objects: ['none'],
  },

  staleness: {
    ttl_ms: 6 * 60 * 60 * 1000,
    invalidate_on: ['cron/sync', 'cron/score', 'cron/signals'],
  },

  token_budget: 600,
  soft_timeout_ms: 1500,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<PriorityAccountRow>> {
    const startedAt = Date.now()

    const { data: companies, error } = await ctx.supabase
      .from('companies')
      .select(
        'id, crm_id, name, expected_revenue, propensity, priority_tier, priority_reason, icp_tier',
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('owner_crm_id', ctx.repId)
      .order('expected_revenue', { ascending: false })
      .limit(8)

    if (error) {
      throw new Error(`priority-accounts query failed: ${error.message}`)
    }

    const companyRows = companies ?? []
    const companyIds = companyRows.map((c) => c.id)

    if (companyIds.length === 0) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: ['No companies owned by this rep — onboarding may be incomplete.'],
      }
    }

    // One round-trip each for top deal + signal count, in parallel — the rest
    // of the cost is in companies query above.
    const [dealsRes, signalsRes] = await Promise.all([
      ctx.supabase
        .from('opportunities')
        .select('id, crm_id, company_id, name, value, stage, days_in_stage, is_stalled')
        .eq('tenant_id', ctx.tenantId)
        .in('company_id', companyIds)
        .eq('is_closed', false)
        .order('value', { ascending: false }),
      ctx.supabase
        .from('signals')
        .select('id, company_id, title, signal_type')
        .eq('tenant_id', ctx.tenantId)
        .in('company_id', companyIds)
        .gte(
          'detected_at',
          new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        )
        .order('weighted_score', { ascending: false }),
    ])

    const dealsByCompany = new Map<string, NonNullable<typeof dealsRes.data>[number]>()
    for (const d of dealsRes.data ?? []) {
      // First (highest-value) wins; deals are pre-sorted desc by value.
      if (!dealsByCompany.has(d.company_id)) dealsByCompany.set(d.company_id, d)
    }

    const signalCountByCompany = new Map<string, number>()
    const topSignalByCompany = new Map<string, string>()
    for (const s of signalsRes.data ?? []) {
      signalCountByCompany.set(
        s.company_id,
        (signalCountByCompany.get(s.company_id) ?? 0) + 1,
      )
      if (!topSignalByCompany.has(s.company_id)) {
        topSignalByCompany.set(s.company_id, s.title ?? s.signal_type ?? 'signal')
      }
    }

    const rows: PriorityAccountRow[] = companyRows.map((c) => {
      const topDeal = dealsByCompany.get(c.id) ?? null
      return {
        id: c.id,
        crm_id: c.crm_id,
        name: c.name,
        expected_revenue: c.expected_revenue,
        propensity: c.propensity,
        priority_tier: c.priority_tier,
        priority_reason: c.priority_reason,
        icp_tier: c.icp_tier,
        top_deal: topDeal
          ? {
              id: topDeal.id,
              crm_id: topDeal.crm_id,
              name: topDeal.name,
              value: topDeal.value,
              stage: topDeal.stage,
              days_in_stage: topDeal.days_in_stage,
              is_stalled: topDeal.is_stalled ?? false,
            }
          : null,
        signal_count: signalCountByCompany.get(c.id) ?? 0,
        top_signal: topSignalByCompany.get(c.id) ?? null,
      }
    })

    const citations = rows.flatMap((r) => {
      const out = [citeCompany(ctx.tenantId, ctx.crmType, r)]
      if (r.top_deal) out.push(citeOpportunity(ctx.tenantId, ctx.crmType, r.top_deal))
      return out
    })

    return {
      rows,
      citations,
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
      warnings: rows.length === 0 ? ['No priority accounts found.'] : undefined,
    }
  },

  formatForPrompt(rows: PriorityAccountRow[]): string {
    if (rows.length === 0) {
      return '### Priority accounts\n_No priority accounts found for this rep._'
    }
    const lines = rows.slice(0, 8).map((r, i) => {
      const tier = r.priority_tier ?? '—'
      const er = fmtMoney(r.expected_revenue)
      const dealPart = r.top_deal
        ? ` | Top deal: ${r.top_deal.name} (${r.top_deal.stage ?? '?'}, ${fmtMoney(r.top_deal.value)})${r.top_deal.is_stalled ? ' STALLED' : ''}`
        : ' | No open deal'
      const signalPart = r.signal_count > 0
        ? ` | ${r.signal_count} signal${r.signal_count > 1 ? 's' : ''}: ${r.top_signal}`
        : ''
      return `${i + 1}. ${r.name} ${urnInline('company', r.id)} — ${tier}, expected ${er}${dealPart}${signalPart}`
    })
    return `### Priority accounts (${rows.length})\n${lines.join('\n')}`
  },

  citeRow(row: PriorityAccountRow) {
    return {
      claim_text: row.name,
      source_type: 'company',
      source_id: row.id,
    }
  },
}

// re-export the implicit token estimator so registry consumers don't have
// to duplicate. Keeps slice files pure-data.
export const _estimateTokens = estimateTokens
