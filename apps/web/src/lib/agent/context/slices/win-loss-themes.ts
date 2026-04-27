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
 * `win-loss-themes` — surfaces win + loss themes from this tenant's
 * closed deals.
 *
 * Phase 6 (Section 2.4) refactor: pages-first.
 *
 * The compiler (Section 2.3) FOLDS win_theme + loss_theme atoms into
 * `entity_industry/{slug}` pages — the page body has dedicated sections
 * for "What we win on" and "Why we lose". So this slice loads the same
 * `entity_industry` page that icp-snapshot loads when an industry is
 * active. Both slices reading the same page is intentional: the page
 * is the canonical representation; slices are role-shaped views over
 * it.
 *
 * Cold-start fallback (the first ~7 days of a tenant): single-row
 * win/loss atoms via loadMemoriesByScope — exactly the pre-Phase-6
 * behaviour, kept so brand-new tenants get a useful slice on day one.
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

type WinLossThemesRow = AtomRow | PageRow

export const winLossThemesSlice: ContextSlice<WinLossThemesRow> = {
  slug: 'win-loss-themes',
  title: 'Win / loss themes from your closed deals',
  category: 'learning',

  triggers: {
    intents: [
      'meeting_prep',
      'risk_analysis',
      'diagnosis',
      'draft_outreach',
      'forecast',
    ],
    objects: ['company', 'deal'],
  },

  staleness: {
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/learning'],
  },

  token_budget: 500,
  soft_timeout_ms: 800,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<WinLossThemesRow>> {
    const startedAt = Date.now()

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

    // --- 1. Pages-first: try the entity_industry page (themes folded in).
    if (industry) {
      const page = await loadWikiPage(ctx.supabase, {
        tenant_id: ctx.tenantId,
        kind: 'entity_industry',
        slug: slugify(industry),
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
    }

    // No industry-scoped page (or no industry at all). Fall back to
    // tenant-wide concept_icp page (themes without an industry scope
    // get folded in there per Section 2.3 mapping).
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

    // --- 2. Cold-start fallback: pick one win + one loss atom.
    const wins = await pickThemeMemory(ctx, 'win_theme', industry)
    const losses = await pickThemeMemory(ctx, 'loss_theme', industry)
    const atomRows: AtomRow[] = [wins, losses]
      .filter((m): m is Omit<AtomRow, 'source'> => m !== null)
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
        warnings: [
          'No win/loss themes yet — mine-themes needs closed deals with linked transcripts or lost_reason values.',
        ],
      }
    }

    const citations: PendingCitation[] = []
    for (const m of atomRows) {
      citations.push({ claim_text: m.title, source_type: 'memory', source_id: m.id })
      for (const evidenceUrn of (m.evidence.urns ?? []).slice(0, 2)) {
        const id = evidenceUrn.split(':').pop() ?? evidenceUrn
        const sourceType = evidenceUrn.includes(':transcript:') ? 'transcript' : 'opportunity'
        citations.push({ claim_text: 'Source evidence', source_type: sourceType, source_id: id })
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

  formatForPrompt(rows: WinLossThemesRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) return ''
    const tenantId = fmtCtx?.tenantId ?? ''
    const first = rows[0]

    if (first.source === 'page') {
      return formatPageForPrompt(first.page, tenantId)
    }

    const atomRows = rows.filter((r): r is AtomRow => r.source === 'atom')
    const lines: string[] = []
    lines.push("### Win + loss themes (from this tenant's closed deals)")
    lines.push(
      'Use these to ground "what should I bring up?" / "what objection should I pre-empt?" reasoning. Quote the inline `urn:rev:...:memory:...` token to surface the citation pill.',
    )
    for (const m of atomRows) {
      const conf =
        m.confidence < 0.4
          ? ' _(low-confidence)_'
          : m.confidence >= 0.85
            ? ' _(high-confidence)_'
            : ''
      const memoryUrn = `\`${urn.memory(tenantId, m.id)}\``
      lines.push(`- **${m.title}**${conf} ${memoryUrn}`)
      lines.push(`  ${m.body}`)
    }
    return lines.join('\n')
  },

  citeRow(row: WinLossThemesRow) {
    if (row.source === 'page') {
      return {
        claim_text: row.page.title,
        source_type: 'wiki_page',
        source_id: row.page.id,
      }
    }
    return { claim_text: row.title, source_type: 'memory', source_id: row.id }
  },
}

/** Industry-first, tenant-wide fallback, single row. */
async function pickThemeMemory(
  ctx: SliceLoadCtx,
  kind: 'win_theme' | 'loss_theme',
  industry: string | null,
): Promise<Omit<AtomRow, 'source'> | null> {
  if (industry) {
    const scoped = (await loadMemoriesByScope(ctx.supabase, {
      tenant_id: ctx.tenantId,
      kind,
      industry,
      limit: 1,
    })) as Array<Omit<AtomRow, 'source'>>
    if (scoped.length > 0) return scoped[0]
  }
  const wide = (await loadMemoriesByScope(ctx.supabase, {
    tenant_id: ctx.tenantId,
    kind,
    limit: 1,
  })) as Array<Omit<AtomRow, 'source'>>
  return wide[0] ?? null
}
