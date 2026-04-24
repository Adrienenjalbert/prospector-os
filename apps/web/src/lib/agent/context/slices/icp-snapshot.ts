import { urn, type PendingCitation, type WikiPage } from '@prospector/core'
import { loadMemoriesByScope } from '@/lib/memory/writer'
import {
  loadWikiPage,
  slugify,
  extractCitationsFromPageBody,
  formatPageForPrompt,
} from '@/lib/memory/wiki-loader'
import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'

/**
 * `icp-snapshot` — surfaces the tenant's ICP knowledge to the agent.
 *
 * Phase 6 (Section 2.4) refactor: the slice now reads compiled wiki
 * pages FIRST, atoms only as a cold-start fallback (the first ~7 days
 * of a tenant before compileWikiPages has had a chance to run).
 *
 * Page lookup order:
 *   1. `entity_industry/{slugify(industry)}` — when there's an
 *      active company with an industry. This page contains the
 *      industry-specific ICP narrative AND the win/loss themes the
 *      compiler folded in (`win_theme + loss_theme` rows for the
 *      same industry land here per Section 2.3 mapping).
 *   2. `concept_icp/tenant-wide` — the tenant-wide ICP page (folds
 *      icp_pattern atoms with no industry scope).
 *   3. Cold-start fallback: scope-loaded `icp_pattern` atoms via
 *      loadMemoriesByScope — exactly the pre-Phase-6 behaviour, kept
 *      so brand-new tenants get a useful slice on day one.
 *
 * Token win: ~600 tokens for one dense page vs ~1200 for 3 atoms +
 * framing. With richer cross-links via `[[wikilinks]]` baked into
 * the page body.
 */

interface AtomRow {
  source: 'atom'
  id: string
  kind: string
  title: string
  body: string
  scope: { industry?: string; segment?: string }
  evidence: { urns?: string[]; counts?: Record<string, number>; samples?: string[] }
  confidence: number
}

interface PageRow {
  source: 'page'
  page: WikiPage
}

type IcpSnapshotRow = AtomRow | PageRow

export const icpSnapshotSlice: ContextSlice<IcpSnapshotRow> = {
  slug: 'icp-snapshot',
  title: 'Your ICP (derived from won deals)',
  category: 'learning',

  triggers: {
    intents: ['lookup', 'diagnosis', 'meeting_prep', 'general_query'],
    objects: ['company', 'deal'],
  },

  staleness: {
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/learning'],
  },

  // Pages are denser than atoms — same budget covers either path.
  token_budget: 500,
  soft_timeout_ms: 800,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<IcpSnapshotRow>> {
    const startedAt = Date.now()

    // Resolve the active company's industry. Same logic as before;
    // determines which entity_industry page (and which atom scope) to
    // look up.
    let industry: string | null = null
    if (ctx.activeCompanyId) {
      const { data: company } = await ctx.supabase
        .from('companies')
        .select('industry')
        .eq('tenant_id', ctx.tenantId)
        .eq('id', ctx.activeCompanyId)
        .maybeSingle()
      industry =
        typeof company?.industry === 'string' && company.industry.length > 0
          ? company.industry
          : null
    }

    // --- 1. Try the compiled wiki page first.
    const industryPage = industry
      ? await loadWikiPage(ctx.supabase, {
          tenant_id: ctx.tenantId,
          kind: 'entity_industry',
          slug: slugify(industry),
        })
      : null

    if (industryPage) {
      const citations = extractCitationsFromPageBody(industryPage, ctx.tenantId)
      return {
        rows: [{ source: 'page', page: industryPage }],
        citations,
        injectedPageIds: [industryPage.id],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
      }
    }

    const tenantWidePage = await loadWikiPage(ctx.supabase, {
      tenant_id: ctx.tenantId,
      kind: 'concept_icp',
      slug: 'tenant-wide',
    })

    if (tenantWidePage) {
      const citations = extractCitationsFromPageBody(tenantWidePage, ctx.tenantId)
      return {
        rows: [{ source: 'page', page: tenantWidePage }],
        citations,
        injectedPageIds: [tenantWidePage.id],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
      }
    }

    // --- 2. Cold-start fallback: scope-loaded atoms.
    const scoped = industry
      ? ((await loadMemoriesByScope(ctx.supabase, {
          tenant_id: ctx.tenantId,
          kind: 'icp_pattern',
          industry,
          limit: 2,
        })) as Array<Omit<AtomRow, 'source'>>)
      : []

    const tenantWide = (await loadMemoriesByScope(ctx.supabase, {
      tenant_id: ctx.tenantId,
      kind: 'icp_pattern',
      industry: undefined,
      limit: scoped.length > 0 ? 1 : 3,
    })) as Array<Omit<AtomRow, 'source'>>

    const tenantWideFiltered = tenantWide.filter((m) => !m.scope.industry)
    const atomRows: AtomRow[] = [...scoped, ...tenantWideFiltered]
      .slice(0, 3)
      .map((m) => ({ ...m, source: 'atom' as const }))

    if (atomRows.length === 0) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: ['No ICP memories yet — derive-icp needs ≥3 closed-won deals.'],
      }
    }

    const citations: PendingCitation[] = []
    for (const m of atomRows) {
      citations.push({
        claim_text: m.title,
        source_type: 'memory',
        source_id: m.id,
      })
      for (const evidenceUrn of (m.evidence.urns ?? []).slice(0, 3)) {
        citations.push({
          claim_text: 'Source deal',
          source_type: 'opportunity',
          source_id: evidenceUrn.split(':').pop() ?? evidenceUrn,
        })
      }
    }

    return {
      rows: atomRows,
      citations,
      injectedMemoryIds: atomRows.map((r) => r.id),
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
    }
  },

  formatForPrompt(rows: IcpSnapshotRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) return ''
    const tenantId = fmtCtx?.tenantId ?? ''
    const first = rows[0]

    // Page path: the compiled markdown is already complete. Just frame
    // it with one line and emit body_md verbatim.
    if (first.source === 'page') {
      return formatPageForPrompt(first.page, tenantId)
    }

    // Atom path: existing logic, slightly compressed.
    const atomRows = rows.filter((r): r is AtomRow => r.source === 'atom')
    const lines: string[] = []
    lines.push('### Your ICP (continuously derived from closed-won)')
    lines.push(
      "Below are the ICP patterns mined from this tenant's actual wins. Use these to ground any 'is this account a fit' reasoning. Quote the inline `urn:rev:...:memory:...` token to trigger the citation pill.",
    )
    for (const m of atomRows) {
      const memoryUrn = `\`${urn.memory(tenantId, m.id)}\``
      const conf =
        m.confidence < 0.4
          ? ' _(low-confidence — small sample)_'
          : m.confidence >= 0.85
            ? ' _(high-confidence)_'
            : ''
      lines.push(`- **${m.title}**${conf} ${memoryUrn}`)
      lines.push(`  ${m.body}`)
    }
    return lines.join('\n')
  },

  citeRow(row: IcpSnapshotRow) {
    if (row.source === 'page') {
      return {
        claim_text: row.page.title,
        source_type: 'wiki_page',
        source_id: row.page.id,
      }
    }
    return {
      claim_text: row.title,
      source_type: 'memory',
      source_id: row.id,
    }
  },
}
