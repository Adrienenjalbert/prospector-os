import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import { citeContact, fmtAge, urnInline } from './_helpers'

/**
 * `champion-map` — active deal: contacts grouped by `is_champion`,
 * `is_economic_buyer`, `is_decision_maker`, with last-activity timestamps
 * and a quick gap-analysis ("missing economic buyer").
 *
 * Multi-threading is the strongest empirical predictor of close at
 * enterprise scale. This slice surfaces the committee's structure and the
 * gaps so the agent can recommend specific multi-threading moves.
 *
 * Loaded for active-deal context plus risk_analysis / meeting_prep /
 * stakeholder_mapping intents.
 */

interface ChampionMapRow {
  /** Active-deal company id this map is for. */
  company_id: string
  total_contacts: number
  champions: ChampionContact[]
  economic_buyers: ChampionContact[]
  decision_makers: ChampionContact[]
  /** Contacts with no flag set — useful "next to qualify". */
  unflagged: ChampionContact[]
  /** Specific gaps the agent should call out. */
  gaps: string[]
}

interface ChampionContact {
  id: string
  crm_id: string | null
  first_name: string | null
  last_name: string | null
  title: string | null
  email: string | null
  seniority: string | null
  last_activity_date: string | null
}

export const championMapSlice: ContextSlice<ChampionMapRow> = {
  slug: 'champion-map',
  title: 'Buying committee',
  category: 'people',

  triggers: {
    objects: ['deal'],
    intents: ['risk_analysis', 'meeting_prep', 'stakeholder_mapping', 'diagnosis'],
    roles: ['ae', 'nae', 'growth_ae', 'ad', 'leader'],
  },

  staleness: {
    ttl_ms: 6 * 60 * 60 * 1000,
    invalidate_on: ['cron/sync'],
  },

  token_budget: 400,
  soft_timeout_ms: 1500,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<ChampionMapRow>> {
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
        warnings: ['champion-map needs an active deal id.'],
      }
    }

    // First resolve company_id from the deal — we cite contacts by the
    // company they belong to.
    const { data: deal } = await ctx.supabase
      .from('opportunities')
      .select('company_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', ctx.activeDealId)
      .maybeSingle()

    if (!deal?.company_id) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: [`Deal ${ctx.activeDealId} has no company_id.`],
      }
    }

    const { data: contacts, error } = await ctx.supabase
      .from('contacts')
      .select(
        'id, crm_id, first_name, last_name, title, email, seniority, last_activity_date, is_champion, is_economic_buyer, is_decision_maker',
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('company_id', deal.company_id)
      .order('relevance_score', { ascending: false })
      .limit(20)

    if (error) {
      throw new Error(`champion-map query failed: ${error.message}`)
    }

    const all = contacts ?? []
    const champions: ChampionContact[] = []
    const economic_buyers: ChampionContact[] = []
    const decision_makers: ChampionContact[] = []
    const unflagged: ChampionContact[] = []

    for (const c of all) {
      const base: ChampionContact = {
        id: c.id,
        crm_id: c.crm_id,
        first_name: c.first_name,
        last_name: c.last_name,
        title: c.title,
        email: c.email,
        seniority: c.seniority,
        last_activity_date: c.last_activity_date,
      }
      let flagged = false
      if (c.is_champion) {
        champions.push(base)
        flagged = true
      }
      if (c.is_economic_buyer) {
        economic_buyers.push(base)
        flagged = true
      }
      if (c.is_decision_maker) {
        decision_makers.push(base)
        flagged = true
      }
      if (!flagged) unflagged.push(base)
    }

    const gaps: string[] = []
    if (champions.length === 0) gaps.push('No champion identified.')
    if (economic_buyers.length === 0) gaps.push('No economic buyer identified.')
    if (decision_makers.length === 0) gaps.push('No decision maker identified.')
    if (all.length < 3) gaps.push(`Only ${all.length} stakeholders engaged — multi-threading risk.`)

    const row: ChampionMapRow = {
      company_id: deal.company_id,
      total_contacts: all.length,
      champions,
      economic_buyers,
      decision_makers,
      unflagged: unflagged.slice(0, 5),
      gaps,
    }

    const citations = all.slice(0, 8).map((c) => citeContact(ctx.tenantId, ctx.crmType, c))

    return {
      rows: [row],
      citations,
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
      warnings: gaps.length ? gaps : undefined,
    }
  },

  formatForPrompt(rows: ChampionMapRow[], fmtCtx?: { tenantId: string }): string {
    const r = rows[0]
    if (!r) return '### Buying committee\n_No active deal context._'
    const tenantId = fmtCtx?.tenantId ?? ''

    const renderGroup = (label: string, contacts: ChampionContact[]) => {
      if (contacts.length === 0) return `${label}: _none_`
      return (
        `${label}:\n` +
        contacts
          .map((c) => {
            const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email || 'Contact'
            return `  - ${name}${c.title ? ` (${c.title})` : ''} ${urnInline(tenantId, 'contact', c.id)} — last activity ${fmtAge(c.last_activity_date)}`
          })
          .join('\n')
      )
    }

    const blocks = [
      `### Buying committee (${r.total_contacts} total)`,
      renderGroup('**Champions**', r.champions),
      renderGroup('**Economic buyers**', r.economic_buyers),
      renderGroup('**Decision makers**', r.decision_makers),
    ]

    if (r.unflagged.length > 0) {
      blocks.push(
        `**Unflagged stakeholders** (${r.unflagged.length} of ${r.total_contacts - r.champions.length - r.economic_buyers.length - r.decision_makers.length} unknown roles, top 5):`,
      )
      blocks.push(
        r.unflagged
          .map((c) => {
            const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email || 'Contact'
            return `  - ${name}${c.title ? ` (${c.title})` : ''} ${urnInline(tenantId, 'contact', c.id)}`
          })
          .join('\n'),
      )
    }

    if (r.gaps.length > 0) {
      blocks.push(`**Gaps to close:** ${r.gaps.join(' ')}`)
    }

    return blocks.join('\n')
  },

  citeRow(row) {
    return {
      claim_text: 'Buying committee',
      source_type: 'company',
      source_id: row.company_id,
    }
  },
}
