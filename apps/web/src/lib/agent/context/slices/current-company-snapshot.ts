import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import {
  citeCompany,
  citeContact,
  citeOpportunity,
  citeSignal,
  fmtMoney,
  urnInline,
} from './_helpers'

/**
 * `current-company-snapshot` — only loaded when `activeUrn` is a company.
 *
 * The "deep look" the agent gets when the user is on a company page or asks
 * a question with that company anchored. Combines firmographics + scoring
 * breakdown + top 3 signals + top 3 contacts + open deals into one section.
 *
 * Force-included by the selector when active object is a company so the
 * agent always anchors on the company URN it's discussing.
 */

interface CompanySnapshotRow {
  id: string
  crm_id: string | null
  name: string
  industry: string | null
  employee_count: number | null
  annual_revenue: number | null
  hq_city: string | null
  hq_country: string | null
  icp_tier: string | null
  icp_score: number | null
  signal_score: number | null
  engagement_score: number | null
  propensity: number | null
  priority_tier: string | null
  priority_reason: string | null

  top_signals: { id: string; title: string; signal_type: string; urgency: string; detected_at: string; source_url: string | null }[]
  top_contacts: {
    id: string
    crm_id: string | null
    first_name: string | null
    last_name: string | null
    title: string | null
    email: string | null
    is_champion: boolean
    is_economic_buyer: boolean
    is_decision_maker: boolean
  }[]
  open_deals: {
    id: string
    crm_id: string | null
    name: string
    value: number | null
    stage: string | null
    days_in_stage: number | null
    is_stalled: boolean
  }[]
}

export const currentCompanySnapshotSlice: ContextSlice<CompanySnapshotRow> = {
  slug: 'current-company-snapshot',
  title: 'Current company snapshot',
  category: 'account',

  triggers: {
    objects: ['company'],
  },

  staleness: {
    ttl_ms: 6 * 60 * 60 * 1000,
    invalidate_on: ['cron/sync', 'cron/score', 'cron/signals'],
  },

  token_budget: 600,
  soft_timeout_ms: 1500,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<CompanySnapshotRow>> {
    const startedAt = Date.now()
    if (!ctx.activeCompanyId) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: ['Loaded current-company-snapshot without an active company id — selector misroute.'],
      }
    }

    const { data: company, error } = await ctx.supabase
      .from('companies')
      .select(
        'id, crm_id, name, industry, employee_count, annual_revenue, hq_city, hq_country, icp_tier, icp_score, signal_score, engagement_score, propensity, priority_tier, priority_reason',
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('id', ctx.activeCompanyId)
      .maybeSingle()

    if (error) {
      throw new Error(`current-company-snapshot query failed: ${error.message}`)
    }
    if (!company) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: [`Company ${ctx.activeCompanyId} not found in tenant.`],
      }
    }

    const [signalsRes, contactsRes, dealsRes] = await Promise.all([
      ctx.supabase
        .from('signals')
        .select('id, title, signal_type, urgency, detected_at, source_url')
        .eq('tenant_id', ctx.tenantId)
        .eq('company_id', ctx.activeCompanyId)
        .order('weighted_score', { ascending: false })
        .limit(3),
      ctx.supabase
        .from('contacts')
        .select(
          'id, crm_id, first_name, last_name, title, email, is_champion, is_economic_buyer, is_decision_maker',
        )
        .eq('tenant_id', ctx.tenantId)
        .eq('company_id', ctx.activeCompanyId)
        .order('relevance_score', { ascending: false })
        .limit(5),
      ctx.supabase
        .from('opportunities')
        .select('id, crm_id, name, value, stage, days_in_stage, is_stalled')
        .eq('tenant_id', ctx.tenantId)
        .eq('company_id', ctx.activeCompanyId)
        .eq('is_closed', false)
        .order('value', { ascending: false })
        .limit(5),
    ])

    const row: CompanySnapshotRow = {
      ...company,
      top_signals: (signalsRes.data ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        signal_type: s.signal_type,
        urgency: s.urgency,
        detected_at: s.detected_at,
        source_url: s.source_url,
      })),
      top_contacts: contactsRes.data ?? [],
      open_deals: (dealsRes.data ?? []).map((d) => ({
        id: d.id,
        crm_id: d.crm_id,
        name: d.name,
        value: d.value,
        stage: d.stage,
        days_in_stage: d.days_in_stage,
        is_stalled: d.is_stalled ?? false,
      })),
    }

    const citations = [
      citeCompany(ctx.tenantId, ctx.crmType, row),
      ...row.top_signals.map((s) => citeSignal(s)),
      ...row.top_contacts.map((c) => citeContact(ctx.tenantId, ctx.crmType, c)),
      ...row.open_deals.map((d) => citeOpportunity(ctx.tenantId, ctx.crmType, d)),
    ]

    const warnings: string[] = []
    if (row.top_signals.length === 0) warnings.push('No signals detected for this company.')
    if (row.top_contacts.length === 0) warnings.push('No contacts on file for this company.')

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

  formatForPrompt(rows: CompanySnapshotRow[]): string {
    const r = rows[0]
    if (!r) return '### Current company\n_No active company context._'

    const headLine = `### ${r.name} ${urnInline('company', r.id)}`
    const meta = [
      r.industry,
      r.hq_city ?? r.hq_country,
      r.employee_count ? `${r.employee_count} employees` : null,
      r.icp_tier ? `ICP ${r.icp_tier}` : null,
      r.priority_tier ? `Priority ${r.priority_tier}` : null,
    ]
      .filter(Boolean)
      .join(' · ')
    const reason = r.priority_reason ? `\n_Priority reason: ${r.priority_reason}_` : ''

    const signalLines = r.top_signals.length
      ? `\n**Top signals:**\n${r.top_signals
          .map((s) => `- [${s.urgency}] ${s.title} ${urnInline('signal', s.id)}`)
          .join('\n')}`
      : ''

    const dealLines = r.open_deals.length
      ? `\n**Open deals:**\n${r.open_deals
          .slice(0, 3)
          .map((d) => `- ${d.name} ${urnInline('opportunity', d.id)} — ${d.stage} ${d.days_in_stage ?? '?'}d, ${fmtMoney(d.value)}${d.is_stalled ? ' STALLED' : ''}`)
          .join('\n')}`
      : ''

    const contactLines = r.top_contacts.length
      ? `\n**Stakeholders:**\n${r.top_contacts
          .slice(0, 4)
          .map((c) => {
            const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email || 'Contact'
            const flags = [
              c.is_champion ? 'champion' : null,
              c.is_economic_buyer ? 'EB' : null,
              c.is_decision_maker ? 'DM' : null,
            ].filter(Boolean).join('/')
            return `- ${name}${c.title ? ` (${c.title})` : ''}${flags ? ` [${flags}]` : ''} ${urnInline('contact', c.id)}`
          })
          .join('\n')}`
      : ''

    return `${headLine}\n${meta}${reason}${signalLines}${dealLines}${contactLines}`
  },

  citeRow(row) {
    return {
      claim_text: row.name,
      source_type: 'company',
      source_id: row.id,
    }
  },
}
