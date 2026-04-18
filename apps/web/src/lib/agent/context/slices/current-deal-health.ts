import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import {
  citeBenchmark,
  citeCompany,
  citeContact,
  citeOpportunity,
  fmtMoney,
  urnInline,
} from './_helpers'

/**
 * `current-deal-health` — only loaded when `activeUrn` is a deal/opportunity.
 *
 * The "deep look" the agent gets when the user is on a specific deal page.
 * Joins opportunity + company + contact-coverage flags + stage benchmark.
 *
 * The selector force-includes this when the active object is a deal so the
 * agent always anchors on the deal URN it's about to discuss.
 */

interface DealHealthRow {
  id: string
  crm_id: string | null
  name: string
  value: number | null
  /**
   * ISO 4217 code from the opportunity row. Plumbed through to `fmtMoney`
   * so the prompt's deal value renders in the right symbol per tenant.
   */
  currency: string | null
  stage: string
  days_in_stage: number
  median_days: number
  is_stalled: boolean
  stall_reason: string | null
  expected_close_date: string | null
  is_won: boolean
  is_closed: boolean

  company: {
    id: string
    crm_id: string | null
    name: string
    industry: string | null
    icp_tier: string | null
    propensity: number | null
  } | null

  /** Coverage rollup — counts of stakeholders by role flag. */
  coverage: {
    total_contacts: number
    has_champion: boolean
    has_economic_buyer: boolean
    has_decision_maker: boolean
  }

  /** Health verdict derived from stall flag + days vs benchmark. */
  health: 'on_track' | 'at_risk' | 'stalled' | 'unknown'
}

export const currentDealHealthSlice: ContextSlice<DealHealthRow> = {
  slug: 'current-deal-health',
  title: 'Current deal health',
  category: 'pipeline',

  triggers: {
    objects: ['deal'],
  },

  staleness: {
    ttl_ms: 60 * 60 * 1000,
    invalidate_on: ['cron/sync', 'webhooks/hubspot-meeting'],
  },

  token_budget: 500,
  soft_timeout_ms: 1500,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<DealHealthRow>> {
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
        warnings: ['Loaded current-deal-health without an active deal id — selector misroute.'],
      }
    }

    const { data: deal, error } = await ctx.supabase
      .from('opportunities')
      .select(
        'id, crm_id, name, company_id, value, currency, stage, days_in_stage, is_stalled, stall_reason, expected_close_date, is_won, is_closed',
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('id', ctx.activeDealId)
      .maybeSingle()

    if (error) {
      throw new Error(`current-deal-health query failed: ${error.message}`)
    }
    if (!deal) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: [`Deal ${ctx.activeDealId} not found in tenant.`],
      }
    }

    const [companyRes, contactsRes, benchRes] = await Promise.all([
      ctx.supabase
        .from('companies')
        .select('id, crm_id, name, industry, icp_tier, propensity')
        .eq('tenant_id', ctx.tenantId)
        .eq('id', deal.company_id)
        .maybeSingle(),
      ctx.supabase
        .from('contacts')
        .select(
          'id, crm_id, first_name, last_name, email, is_champion, is_decision_maker, is_economic_buyer',
        )
        .eq('tenant_id', ctx.tenantId)
        .eq('company_id', deal.company_id),
      ctx.supabase
        .from('funnel_benchmarks')
        .select('median_days_in_stage')
        .eq('tenant_id', ctx.tenantId)
        .eq('scope', 'company')
        .eq('scope_id', 'all')
        .eq('stage_name', deal.stage)
        .maybeSingle(),
    ])

    const contacts = contactsRes.data ?? []
    const median = benchRes.data?.median_days_in_stage ?? 14
    const stallThreshold = Math.round(median * 1.5)

    const health: DealHealthRow['health'] = deal.is_stalled
      ? 'stalled'
      : (deal.days_in_stage ?? 0) > stallThreshold
      ? 'at_risk'
      : 'on_track'

    const row: DealHealthRow = {
      id: deal.id,
      crm_id: deal.crm_id,
      name: deal.name,
      value: deal.value,
      currency: (deal as { currency?: string | null }).currency ?? null,
      stage: deal.stage,
      days_in_stage: deal.days_in_stage ?? 0,
      median_days: median,
      is_stalled: deal.is_stalled ?? false,
      stall_reason: deal.stall_reason,
      expected_close_date: deal.expected_close_date,
      is_won: deal.is_won ?? false,
      is_closed: deal.is_closed ?? false,
      company: companyRes.data
        ? {
            id: companyRes.data.id,
            crm_id: companyRes.data.crm_id,
            name: companyRes.data.name,
            industry: companyRes.data.industry,
            icp_tier: companyRes.data.icp_tier,
            propensity: companyRes.data.propensity,
          }
        : null,
      coverage: {
        total_contacts: contacts.length,
        has_champion: contacts.some((c) => c.is_champion),
        has_economic_buyer: contacts.some((c) => c.is_economic_buyer),
        has_decision_maker: contacts.some((c) => c.is_decision_maker),
      },
      health,
    }

    const citations = [
      citeOpportunity(ctx.tenantId, ctx.crmType, row),
      ...(row.company ? [citeCompany(ctx.tenantId, ctx.crmType, row.company)] : []),
      ...contacts.slice(0, 5).map((c) => citeContact(ctx.tenantId, ctx.crmType, c)),
      citeBenchmark(row.stage),
    ]

    const warnings: string[] = []
    if (!row.coverage.has_champion) warnings.push('No champion identified on this deal.')
    if (!row.coverage.has_economic_buyer) warnings.push('No economic buyer identified.')
    if (row.health === 'at_risk') warnings.push(`Deal is at-risk: ${row.days_in_stage}d in ${row.stage} (median ${median}d, stall ≥ ${stallThreshold}d).`)

    return {
      rows: [row],
      citations,
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
      warnings: warnings.length ? warnings : undefined,
    }
  },

  formatForPrompt(rows: DealHealthRow[], fmtCtx?: { tenantId: string }): string {
    const r = rows[0]
    if (!r) return '### Current deal\n_No active deal context._'
    const tenantId = fmtCtx?.tenantId ?? ''
    const cov = r.coverage
    const flags: string[] = []
    if (!cov.has_champion) flags.push('NO CHAMPION')
    if (!cov.has_economic_buyer) flags.push('NO ECONOMIC BUYER')
    if (!cov.has_decision_maker) flags.push('NO DECISION MAKER')
    const flagPart = flags.length ? ` ⚠ ${flags.join(', ')}` : ''
    const stallPart = r.is_stalled ? ` STALLED${r.stall_reason ? `: ${r.stall_reason}` : ''}` : ''
    const companyLine = r.company
      ? `\n- Company: ${r.company.name} ${urnInline(tenantId, 'company', r.company.id)} (${r.company.industry ?? '—'}, ICP ${r.company.icp_tier ?? '—'})`
      : ''
    return `### Current deal health
- ${r.name} ${urnInline(tenantId, 'opportunity', r.id)} — ${r.stage} ${r.days_in_stage}d (median ${r.median_days}d), ${fmtMoney(r.value, r.currency)} [${r.health.toUpperCase()}]${stallPart}${flagPart}
- Stakeholders: ${cov.total_contacts} total${companyLine}`
  },

  citeRow(row) {
    return {
      claim_text: row.name,
      source_type: 'opportunity',
      source_id: row.id,
    }
  },
}
