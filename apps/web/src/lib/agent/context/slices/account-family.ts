import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import { citeCompany, fmtMoney, urnInline } from './_helpers'

/**
 * `account-family` — Phase 3.10. Loaded when the active company is part
 * of an account family (has a parent_company_id OR is a family root with
 * children). Returns parent + siblings + children with an outcome label
 * per company:
 *
 *   won   — has at least one closed-won opportunity
 *   open  — has at least one open opportunity (no won yet)
 *   lost  — has only closed-lost opportunities
 *   cold  — no opportunity history at all
 *
 * Powers the "we already won the parent — here are the unconverted
 * subsidiaries" play that's purely manual today.
 *
 * Triggered for every active-company turn on AE/AD/growth_AE (the
 * land-and-expand roles). CSM gets it too because expansion conversations
 * benefit from family awareness.
 */

interface AccountFamilyMember {
  id: string
  name: string
  role: 'parent' | 'sibling' | 'self' | 'child'
  outcome: 'won' | 'open' | 'lost' | 'cold'
  open_deal_value: number | null
}

interface AccountFamilyRow {
  family_root_id: string
  members: AccountFamilyMember[]
  /** Quick stats for the prompt header. */
  total_members: number
  won_count: number
  open_count: number
  cold_count: number
}

export const accountFamilySlice: ContextSlice<AccountFamilyRow> = {
  slug: 'account-family',
  title: 'Account family — land and expand',
  category: 'pipeline',

  triggers: {
    objects: ['company'],
    intents: [
      'meeting_prep',
      'draft_outreach',
      'forecast',
      'risk_analysis',
      'lookup',
      'general_query',
      'portfolio_health',
    ],
    roles: ['ae', 'nae', 'growth_ae', 'ad', 'csm'],
  },

  staleness: {
    ttl_ms: 12 * 60 * 60 * 1000,
    invalidate_on: ['cron/sync'],
  },

  token_budget: 400,
  soft_timeout_ms: 1500,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<AccountFamilyRow>> {
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
        warnings: ['account-family needs an active company id.'],
      }
    }

    // Resolve the family root (the topmost ancestor). One row read.
    const { data: self } = await ctx.supabase
      .from('companies')
      .select('id, name, crm_id, parent_company_id, is_account_family_root')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', ctx.activeCompanyId)
      .maybeSingle()

    if (!self) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: [`Company ${ctx.activeCompanyId} not found.`],
      }
    }

    let familyRootId: string
    if (self.is_account_family_root) {
      familyRootId = self.id
    } else if (self.parent_company_id) {
      familyRootId = self.parent_company_id
    } else {
      // Standalone account — no family. Slice loads zero rows so the
      // selector can deprioritise it on the next bandit pass.
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

    // Fetch the entire family in one query: root + every direct child.
    // Phase 3.10 doesn't model multi-level hierarchies (subsidiary of
    // a subsidiary) — HubSpot supports them but they're rare and the
    // payoff isn't worth the recursion complexity for v1.
    const { data: familyRows, error } = await ctx.supabase
      .from('companies')
      .select('id, name, crm_id, parent_company_id, is_account_family_root')
      .eq('tenant_id', ctx.tenantId)
      .or(`id.eq.${familyRootId},parent_company_id.eq.${familyRootId}`)

    if (error) {
      throw new Error(`account-family query failed: ${error.message}`)
    }
    const family = familyRows ?? []
    if (family.length <= 1) {
      // Family root with no children, or query miss. Nothing to show.
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

    // Pull deal outcomes for every family member in one query.
    const memberIds = family.map((c) => c.id)
    const { data: deals } = await ctx.supabase
      .from('opportunities')
      .select('company_id, value, is_won, is_closed')
      .eq('tenant_id', ctx.tenantId)
      .in('company_id', memberIds)

    const dealsByCompany = new Map<string, typeof deals>()
    for (const d of deals ?? []) {
      const cur = dealsByCompany.get(d.company_id) ?? []
      cur.push(d)
      dealsByCompany.set(d.company_id, cur)
    }

    function classifyOutcome(companyId: string): AccountFamilyMember['outcome'] {
      const ds = dealsByCompany.get(companyId) ?? []
      if (ds.length === 0) return 'cold'
      if (ds.some((d) => d.is_won)) return 'won'
      if (ds.some((d) => !d.is_closed)) return 'open'
      return 'lost'
    }

    function openDealValue(companyId: string): number | null {
      const ds = dealsByCompany.get(companyId) ?? []
      const opens = ds.filter((d) => !d.is_closed)
      if (opens.length === 0) return null
      return opens.reduce((s, d) => s + (d.value ?? 0), 0)
    }

    const members: AccountFamilyMember[] = family.map((c) => {
      let role: AccountFamilyMember['role']
      if (c.id === ctx.activeCompanyId) role = 'self'
      else if (c.id === familyRootId) role = 'parent'
      else if (c.parent_company_id === familyRootId) {
        role = ctx.activeCompanyId && c.id !== ctx.activeCompanyId && self.parent_company_id === familyRootId
          ? 'sibling'
          : 'child'
      } else {
        role = 'sibling'
      }
      return {
        id: c.id,
        name: c.name,
        role,
        outcome: classifyOutcome(c.id),
        open_deal_value: openDealValue(c.id),
      }
    })

    const wonCount = members.filter((m) => m.outcome === 'won').length
    const openCount = members.filter((m) => m.outcome === 'open').length
    const coldCount = members.filter((m) => m.outcome === 'cold').length

    const row: AccountFamilyRow = {
      family_root_id: familyRootId,
      members,
      total_members: members.length,
      won_count: wonCount,
      open_count: openCount,
      cold_count: coldCount,
    }

    return {
      rows: [row],
      citations: members.map((m) =>
        citeCompany(ctx.tenantId, ctx.crmType, {
          id: m.id,
          name: m.name,
          crm_id: null,
        }),
      ),
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
    }
  },

  formatForPrompt(rows: AccountFamilyRow[], fmtCtx?: { tenantId: string }): string {
    const r = rows[0]
    if (!r) return ''
    const tenantId = fmtCtx?.tenantId ?? ''

    const summary = `${r.won_count} won · ${r.open_count} open · ${r.cold_count} cold across ${r.total_members} family members`
    const lines = r.members
      .sort((a, b) => {
        // Self first, then parent, then siblings/children
        const order: Record<AccountFamilyMember['role'], number> = {
          self: 0,
          parent: 1,
          sibling: 2,
          child: 3,
        }
        return order[a.role] - order[b.role]
      })
      .map((m) => {
        const label = m.role === 'self' ? '**(this account)**' : `_${m.role}_`
        const valuePart = m.open_deal_value
          ? ` · open ${fmtMoney(m.open_deal_value)}`
          : ''
        return `- [${m.outcome}] ${m.name} ${urnInline(tenantId, 'company', m.id)} ${label}${valuePart}`
      })

    const cold = r.members.filter(
      (m) => m.outcome === 'cold' && m.role !== 'self',
    )
    const expandHint = cold.length > 0 && r.won_count > 0
      ? `\n_Land-and-expand: you've won ${r.won_count} of ${r.total_members} family members. The ${cold.length} cold member(s) above are warm-by-association — you can reference the parent relationship in cold outreach._`
      : ''

    return `### Account family\n${summary}\n${lines.join('\n')}${expandHint}`
  },

  citeRow(row) {
    return {
      claim_text: 'Account family',
      source_type: 'company',
      source_id: row.family_root_id,
    }
  },
}
