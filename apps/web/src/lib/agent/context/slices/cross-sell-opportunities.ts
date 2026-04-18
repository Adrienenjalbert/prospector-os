import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import { citeCompany, urnInline } from './_helpers'

/**
 * `cross-sell-opportunities` — Phase 3.10. Always-on for AE/AD/growth_AE.
 *
 * For every won deal in the rep's book, look at the account's family
 * (via parent_company_id). Surface up to 5 cold/open family members the
 * rep hasn't yet converted — these are the "we already won the parent"
 * cross-sell plays that today require manual hierarchy walking in
 * HubSpot.
 *
 * The agent uses this to nudge "you closed Acme Logistics last quarter
 * but Acme APAC is cold — same parent, similar industry, warm-by-
 * association cold outreach is high-conversion."
 *
 * Loaded for any intent because it's a perpetual pipeline-source surface
 * — a rep with 50 won deals over 3 years can have 10+ family-cross-sell
 * opportunities at any time.
 */

interface CrossSellRow {
  /** The rep's won account in this family. */
  won_company: { id: string; name: string }
  /** The cross-sell candidate (cold or open at a sibling). */
  candidate_company: {
    id: string
    name: string
    industry: string | null
    icp_tier: string | null
    has_open_deal: boolean
  }
  /** Family root for context. */
  family_root_name: string
}

export const crossSellOpportunitiesSlice: ContextSlice<CrossSellRow> = {
  slug: 'cross-sell-opportunities',
  title: 'Cross-sell — already won a sibling',
  category: 'pipeline',

  triggers: {
    intents: [
      'draft_outreach',
      'meeting_prep',
      'forecast',
      'lookup',
      'general_query',
      'portfolio_health',
    ],
    roles: ['ae', 'nae', 'growth_ae', 'ad'],
  },

  staleness: {
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/sync'],
  },

  token_budget: 300,
  soft_timeout_ms: 1500,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<CrossSellRow>> {
    const startedAt = Date.now()

    // Find the rep's won-deal company ids — anchor for the cross-sell map.
    const since = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString() // 24mo
    const { data: wonDeals } = await ctx.supabase
      .from('opportunities')
      .select('company_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('owner_crm_id', ctx.repId)
      .eq('is_won', true)
      .gte('closed_at', since)
    const wonCompanyIds = [
      ...new Set((wonDeals ?? []).map((d) => d.company_id).filter(Boolean) as string[]),
    ]
    if (wonCompanyIds.length === 0) {
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

    // Hydrate the won companies + their family root pointers.
    const { data: wonCompanies } = await ctx.supabase
      .from('companies')
      .select('id, name, parent_company_id, is_account_family_root')
      .eq('tenant_id', ctx.tenantId)
      .in('id', wonCompanyIds)

    // Compute the set of family roots the rep has at least one win in.
    const familyRootsByWonId = new Map<string, string>()
    for (const wc of wonCompanies ?? []) {
      if (wc.is_account_family_root) {
        familyRootsByWonId.set(wc.id, wc.id)
      } else if (wc.parent_company_id) {
        familyRootsByWonId.set(wc.id, wc.parent_company_id)
      }
    }
    const familyRoots = [...new Set(familyRootsByWonId.values())]
    if (familyRoots.length === 0) {
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

    // For each family root, fetch the children + the root itself + the
    // root's name (for prompt context).
    const { data: familyMembers } = await ctx.supabase
      .from('companies')
      .select('id, name, parent_company_id, industry, icp_tier')
      .eq('tenant_id', ctx.tenantId)
      .or(
        familyRoots
          .map((rootId) => `id.eq.${rootId},parent_company_id.eq.${rootId}`)
          .join(','),
      )

    // Index family members by family root.
    const membersByRoot = new Map<string, typeof familyMembers>()
    const rootNameById = new Map<string, string>()
    for (const m of familyMembers ?? []) {
      if (m.parent_company_id) {
        const list = membersByRoot.get(m.parent_company_id) ?? []
        list.push(m)
        membersByRoot.set(m.parent_company_id, list)
      } else if (familyRoots.includes(m.id)) {
        rootNameById.set(m.id, m.name)
        const list = membersByRoot.get(m.id) ?? []
        list.push(m)
        membersByRoot.set(m.id, list)
      }
    }

    // Pull deal outcomes for every family member so we can label cold
    // vs has-open-deal.
    const allMemberIds = (familyMembers ?? []).map((m) => m.id)
    const { data: memberDeals } = allMemberIds.length
      ? await ctx.supabase
          .from('opportunities')
          .select('company_id, is_won, is_closed')
          .eq('tenant_id', ctx.tenantId)
          .in('company_id', allMemberIds)
      : { data: [] as { company_id: string; is_won: boolean; is_closed: boolean }[] }

    const dealStatusByCompany = new Map<string, { won: boolean; open: boolean }>()
    for (const d of memberDeals ?? []) {
      const cur = dealStatusByCompany.get(d.company_id) ?? { won: false, open: false }
      if (d.is_won) cur.won = true
      if (!d.is_closed) cur.open = true
      dealStatusByCompany.set(d.company_id, cur)
    }

    // Build cross-sell rows: for each family the rep has won at, list
    // family members the rep hasn't won yet (cold OR open).
    const candidates: CrossSellRow[] = []
    for (const [wonId, familyRootId] of familyRootsByWonId.entries()) {
      const won = (wonCompanies ?? []).find((c) => c.id === wonId)
      if (!won) continue
      const members = membersByRoot.get(familyRootId) ?? []
      const rootName = rootNameById.get(familyRootId) ?? won.name
      for (const m of members) {
        if (m.id === wonId) continue // skip the won account itself
        const status = dealStatusByCompany.get(m.id) ?? { won: false, open: false }
        if (status.won) continue // already won this sibling — skip
        candidates.push({
          won_company: { id: won.id, name: won.name },
          candidate_company: {
            id: m.id,
            name: m.name,
            industry: m.industry,
            icp_tier: m.icp_tier,
            has_open_deal: status.open,
          },
          family_root_name: rootName,
        })
      }
    }

    // Top 5 — prefer ones with no open deal (truly cold) over ones with
    // an existing open deal (already in motion).
    candidates.sort((a, b) => {
      if (a.candidate_company.has_open_deal !== b.candidate_company.has_open_deal) {
        return a.candidate_company.has_open_deal ? 1 : -1
      }
      return 0
    })
    const top = candidates.slice(0, 5)

    return {
      rows: top,
      citations: top.flatMap((r) => [
        citeCompany(ctx.tenantId, ctx.crmType, {
          id: r.candidate_company.id,
          name: r.candidate_company.name,
          crm_id: null,
        }),
        citeCompany(ctx.tenantId, ctx.crmType, {
          id: r.won_company.id,
          name: r.won_company.name,
          crm_id: null,
        }),
      ]),
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
    }
  },

  formatForPrompt(rows: CrossSellRow[]): string {
    if (rows.length === 0) return ''
    const lines = rows.map((r) => {
      const status = r.candidate_company.has_open_deal ? '_open deal_' : '_cold_'
      const tier = r.candidate_company.icp_tier
        ? ` (ICP ${r.candidate_company.icp_tier})`
        : ''
      const industry = r.candidate_company.industry
        ? ` · ${r.candidate_company.industry}`
        : ''
      return `- ${r.candidate_company.name} ${urnInline('company', r.candidate_company.id)}${tier}${industry} — same family as won ${r.won_company.name} ${urnInline('company', r.won_company.id)} ${status}`
    })
    return `### Cross-sell — already won a sibling (${rows.length})\n${lines.join('\n')}\n\n_These are family members of accounts you've won. Warm-by-association cold outreach has 2-4x conversion of pure cold._`
  },

  citeRow(row) {
    return {
      claim_text: row.candidate_company.name,
      source_type: 'company',
      source_id: row.candidate_company.id,
    }
  },
}
