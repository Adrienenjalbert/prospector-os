import {
  urn,
  type PendingCitation,
  type WikiPage,
} from '@prospector/core'
import {
  loadWikiPage,
  extractCitationsFromPageBody,
  formatPageForPrompt,
} from '@/lib/memory/wiki-loader'
import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'

/**
 * `bridge-opportunities` (Phase 7, Section 3.4) — surfaces warm-
 * intro paths into the active company.
 *
 * Pages-first per the Phase 6 pattern:
 *
 *   1. Try the `entity_company_neighbourhood/{company_id}` page
 *      compiled by compile-bridge-neighbourhoods (Section 3.5). If
 *      present, return it as ONE dense markdown row with cross-
 *      references.
 *
 *   2. Cold-start fallback: read the top 3 inbound `bridges_to`
 *      edges directly from memory_edges and emit a compact list.
 *
 * Triggered for AE/AD/CSM on draft_outreach / meeting_prep / lookup
 * intents when an active company is in scope. Same shape as the
 * Phase 6 pages-first slices (icp-snapshot, persona-library, etc.).
 */

interface BridgePageRow {
  source: 'page'
  page: WikiPage
}

interface BridgeEdgeRow {
  source: 'edge'
  edge_id: string
  src_company_id: string
  src_company_name: string | null
  weight: number
  miner: string
  bridging_contact_id: string | null
  bridging_contact_name: string | null
}

type BridgeOpportunityRow = BridgePageRow | BridgeEdgeRow

export const bridgeOpportunitiesSlice: ContextSlice<BridgeOpportunityRow> = {
  slug: 'bridge-opportunities',
  title: 'Warm-intro bridges',
  category: 'pipeline',

  triggers: {
    intents: [
      'draft_outreach',
      'meeting_prep',
      'lookup',
      'general_query',
      'stakeholder_mapping',
    ],
    objects: ['company', 'deal'],
    roles: ['ae', 'nae', 'growth_ae', 'ad', 'csm'],
  },

  staleness: {
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/learning'],
  },

  token_budget: 400,
  soft_timeout_ms: 800,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<BridgeOpportunityRow>> {
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
      }
    }

    // --- 1. Pages-first.
    const page = await loadWikiPage(ctx.supabase, {
      tenant_id: ctx.tenantId,
      kind: 'entity_company_neighbourhood',
      slug: ctx.activeCompanyId,
    })
    if (page) {
      const citations = extractCitationsFromPageBody(page, ctx.tenantId)
      return {
        rows: [{ source: 'page', page }],
        citations,
        injectedPageIds: [page.id],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
      }
    }

    // --- 2. Cold-start fallback: top 3 inbound bridges_to edges.
    const { data: edges } = await ctx.supabase
      .from('memory_edges')
      .select('id, src_id, src_kind, weight, evidence')
      .eq('tenant_id', ctx.tenantId)
      .eq('edge_kind', 'bridges_to')
      .eq('dst_kind', 'company')
      .eq('dst_id', ctx.activeCompanyId)
      .order('weight', { ascending: false })
      .limit(5)

    const inbound = (edges ?? []).filter(
      (e) => e.src_kind === 'company' && e.src_id !== ctx.activeCompanyId,
    )
    if (inbound.length === 0) {
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

    // Hydrate source company names + bridging contact names.
    const sourceCompanyIds = [...new Set(inbound.map((e) => e.src_id as string))]
    const allBridgingContactIds: string[] = []
    for (const e of inbound) {
      const ev = (e.evidence ?? {}) as {
        bridging_contact_id?: string
        bridging_contacts?: string[]
      }
      if (ev.bridging_contact_id) allBridgingContactIds.push(ev.bridging_contact_id)
      if (Array.isArray(ev.bridging_contacts)) allBridgingContactIds.push(...ev.bridging_contacts)
    }
    const uniqueContactIds = [...new Set(allBridgingContactIds)]

    const [companiesRes, contactsRes] = await Promise.all([
      ctx.supabase
        .from('companies')
        .select('id, name')
        .eq('tenant_id', ctx.tenantId)
        .in('id', sourceCompanyIds),
      uniqueContactIds.length
        ? ctx.supabase
            .from('contacts')
            .select('id, first_name, last_name')
            .eq('tenant_id', ctx.tenantId)
            .in('id', uniqueContactIds)
        : Promise.resolve({ data: [] as Array<{ id: string; first_name: string | null; last_name: string | null }> }),
    ])
    const companyById = new Map(
      (companiesRes.data ?? []).map((c) => [c.id as string, c.name as string]),
    )
    const contactById = new Map(
      (contactsRes.data ?? []).map((c) => [
        c.id as string,
        `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || (c.id as string),
      ]),
    )

    const rows: BridgeEdgeRow[] = inbound.slice(0, 3).map((e) => {
      const ev = (e.evidence ?? {}) as {
        miner?: string
        bridging_contact_id?: string
        bridging_contact_name?: string
      }
      return {
        source: 'edge',
        edge_id: e.id as string,
        src_company_id: e.src_id as string,
        src_company_name: companyById.get(e.src_id as string) ?? null,
        weight: Number(e.weight ?? 0),
        miner: ev.miner ?? 'unknown',
        bridging_contact_id: ev.bridging_contact_id ?? null,
        bridging_contact_name: ev.bridging_contact_id
          ? contactById.get(ev.bridging_contact_id) ?? ev.bridging_contact_name ?? null
          : ev.bridging_contact_name ?? null,
      }
    })

    const citations: PendingCitation[] = []
    for (const r of rows) {
      citations.push({
        claim_text: r.src_company_name
          ? `Warm path via ${r.src_company_name}`
          : 'Warm bridge',
        source_type: 'company',
        source_id: r.src_company_id,
      })
      if (r.bridging_contact_id) {
        citations.push({
          claim_text: r.bridging_contact_name ?? 'Bridging contact',
          source_type: 'contact',
          source_id: r.bridging_contact_id,
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

  formatForPrompt(rows: BridgeOpportunityRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) return ''
    const tenantId = fmtCtx?.tenantId ?? ''
    const first = rows[0]

    if (first.source === 'page') {
      return formatPageForPrompt(first.page, tenantId)
    }

    const edgeRows = rows.filter((r): r is BridgeEdgeRow => r.source === 'edge')
    const lines: string[] = []
    lines.push("### Warm-intro bridges (cold-start view)")
    lines.push(
      "Inbound bridges from companies you already sell to. The neighbourhood page hasn't compiled yet — surfacing raw edges. Cite the source-company URN inline.",
    )
    for (const r of edgeRows) {
      const sourceCompanyUrn = `\`${urn.company(tenantId, r.src_company_id)}\``
      const contactNote = r.bridging_contact_name
        ? ` (via ${r.bridging_contact_name})`
        : ''
      lines.push(
        `- **${r.src_company_name ?? 'Customer'}** → warm path${contactNote}, weight ${r.weight.toFixed(2)} ${sourceCompanyUrn}`,
      )
    }
    return lines.join('\n')
  },

  citeRow(row: BridgeOpportunityRow) {
    if (row.source === 'page') {
      return {
        claim_text: row.page.title,
        source_type: 'wiki_page',
        source_id: row.page.id,
      }
    }
    return {
      claim_text: row.src_company_name ?? 'Bridge source',
      source_type: 'company',
      source_id: row.src_company_id,
    }
  },
}
