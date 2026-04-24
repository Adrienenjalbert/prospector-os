import { urn, type PendingCitation, type WikiPage } from '@prospector/core'
import { loadMemoriesByScope } from '@/lib/memory/writer'
import {
  loadWikiPagesBySlugs,
  slugify,
  extractCitationsFromPageBody,
  formatPageForPrompt,
} from '@/lib/memory/wiki-loader'
import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'

/**
 * `competitor-plays` — surfaces the competitor playbook for any
 * competitor recently mentioned on the active company.
 *
 * Phase 6 (Section 2.4) refactor: pages-first.
 *
 * Trigger discipline (unchanged): the slice loads recent
 * `competitor_mention` signals on the active company; without at least
 * one mention, it returns 0 rows so the packer skips it.
 *
 * Page lookup: one `entity_competitor/{slug(name)}` page per matched
 * competitor (max 2). The compiler folds competitor_play atoms by
 * competitor name into one page per competitor.
 *
 * Cold-start fallback: scope-loaded `competitor_play` atoms — pre-
 * Phase-6 behaviour kept for new tenants.
 */

interface AtomRow {
  source: 'atom'
  id: string
  kind: string
  title: string
  body: string
  scope: { competitor?: string }
  evidence: { urns?: string[]; counts?: Record<string, number>; samples?: string[] }
  confidence: number
}

interface PageRow {
  source: 'page'
  page: WikiPage
}

type CompetitorPlaysRow = AtomRow | PageRow

const RECENT_SIGNAL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

export const competitorPlaysSlice: ContextSlice<CompetitorPlaysRow> = {
  slug: 'competitor-plays',
  title: 'Competitor playbook',
  category: 'learning',

  triggers: {
    intents: ['meeting_prep', 'risk_analysis', 'diagnosis', 'draft_outreach'],
    objects: ['company', 'deal'],
    signalTypes: ['competitor_mention'],
  },

  staleness: {
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/learning'],
  },

  token_budget: 350,
  soft_timeout_ms: 800,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<CompetitorPlaysRow>> {
    const startedAt = Date.now()

    // Detect competitor names from recent signals on the active company.
    let competitorNames: string[] = []
    if (ctx.activeCompanyId) {
      const since = new Date(Date.now() - RECENT_SIGNAL_LOOKBACK_MS).toISOString()
      const { data: signals } = await ctx.supabase
        .from('signals')
        .select('title, description')
        .eq('tenant_id', ctx.tenantId)
        .eq('company_id', ctx.activeCompanyId)
        .eq('signal_type', 'competitor_mention')
        .gte('detected_at', since)
        .limit(5)

      const found: string[] = []
      for (const s of signals ?? []) {
        const titleLower = (s.title ?? '').toLowerCase()
        const m = titleLower.match(/competitor mentioned:\s*(.+)/)
        if (m && m[1]) found.push(m[1].trim())
      }
      competitorNames = [...new Set(found)].slice(0, 2)
    }

    if (competitorNames.length === 0) {
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

    // --- 1. Pages-first: one round trip for the matched competitors.
    const pages = await loadWikiPagesBySlugs(ctx.supabase, {
      tenant_id: ctx.tenantId,
      kind: 'entity_competitor',
      slugs: competitorNames.map((n) => slugify(n)),
    })

    if (pages.length > 0) {
      const pageRows: PageRow[] = pages.slice(0, 2).map((p) => ({ source: 'page', page: p }))
      const citations: PendingCitation[] = []
      for (const r of pageRows) {
        for (const c of extractCitationsFromPageBody(r.page, ctx.tenantId)) {
          citations.push(c)
        }
      }
      return {
        rows: pageRows,
        citations,
        injectedPageIds: pageRows.map((r) => r.page.id),
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
      }
    }

    // --- 2. Cold-start fallback: scope-loaded atoms.
    const picks: AtomRow[] = []
    for (const name of competitorNames) {
      const memories = (await loadMemoriesByScope(ctx.supabase, {
        tenant_id: ctx.tenantId,
        kind: 'competitor_play',
        competitor: name,
        limit: 1,
      })) as Array<Omit<AtomRow, 'source'>>
      if (memories.length > 0) picks.push({ ...memories[0], source: 'atom' })
    }

    if (picks.length === 0) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: [
          `Competitor signals on this company match no mined plays. Configure /admin/config competitor list to seed.`,
        ],
      }
    }

    const citations: PendingCitation[] = []
    for (const m of picks) {
      citations.push({ claim_text: m.title, source_type: 'memory', source_id: m.id })
      for (const ev of (m.evidence.urns ?? []).slice(0, 2)) {
        const id = ev.split(':').pop() ?? ev
        citations.push({ claim_text: 'Source transcript', source_type: 'transcript', source_id: id })
      }
    }

    return {
      rows: picks,
      citations,
      injectedMemoryIds: picks.map((r) => r.id),
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
    }
  },

  formatForPrompt(rows: CompetitorPlaysRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) return ''
    const tenantId = fmtCtx?.tenantId ?? ''

    const pageRows = rows.filter((r): r is PageRow => r.source === 'page')
    if (pageRows.length > 0) {
      return pageRows.map((r) => formatPageForPrompt(r.page, tenantId)).join('\n\n')
    }

    const atomRows = rows.filter((r): r is AtomRow => r.source === 'atom')
    const lines: string[] = []
    lines.push('### Competitor playbook (mined from your closed deals)')
    for (const m of atomRows) {
      const memoryUrn = `\`${urn.memory(tenantId, m.id)}\``
      lines.push(`- **${m.title}** ${memoryUrn}`)
      lines.push(`  ${m.body}`)
    }
    return lines.join('\n')
  },

  citeRow(row: CompetitorPlaysRow) {
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
