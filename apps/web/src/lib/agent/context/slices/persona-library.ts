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
 * `persona-library` — surfaces the tenant's persona archetypes.
 *
 * Phase 6 (Section 2.4) refactor: pages-first, atoms-fallback.
 *
 * Page lookup: one `entity_persona/{slug(role)}` page per role
 * (champion, economic_buyer, decision_maker). The compiler folds
 * persona atoms by role into one page per role; the slice loads up
 * to 3 pages in one round trip.
 *
 * Cold-start fallback (the first ~7 days of a tenant before
 * compileWikiPages has run): scope-loaded `persona` atoms — exactly
 * the pre-Phase-6 behaviour.
 */

const ROLES = ['champion', 'economic_buyer', 'decision_maker'] as const

interface AtomRow {
  source: 'atom'
  id: string
  kind: string
  title: string
  body: string
  scope: { industry?: string; persona_role?: string }
  evidence: { urns?: string[]; counts?: Record<string, number>; samples?: string[] }
  confidence: number
}

interface PageRow {
  source: 'page'
  page: WikiPage
}

type PersonaLibraryRow = AtomRow | PageRow

export const personaLibrarySlice: ContextSlice<PersonaLibraryRow> = {
  slug: 'persona-library',
  title: "Tenant's persona library",
  category: 'people',

  triggers: {
    intents: [
      'meeting_prep',
      'risk_analysis',
      'stakeholder_mapping',
      'diagnosis',
      'draft_outreach',
    ],
    objects: ['company', 'deal', 'contact'],
  },

  staleness: {
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/learning'],
  },

  token_budget: 500,
  soft_timeout_ms: 800,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<PersonaLibraryRow>> {
    const startedAt = Date.now()

    // --- 1. Pages-first: one round trip for all 3 role pages.
    const pages = await loadWikiPagesBySlugs(ctx.supabase, {
      tenant_id: ctx.tenantId,
      kind: 'entity_persona',
      slugs: ROLES.map((r) => slugify(r)),
    })

    if (pages.length > 0) {
      // Order by ROLES so champion comes first, EB second, DM third —
      // matches the rep's mental model and the order the compiler
      // prefers when budget is tight.
      const slugToPage = new Map(pages.map((p) => [p.slug, p]))
      const ordered: PageRow[] = []
      for (const role of ROLES) {
        const page = slugToPage.get(slugify(role))
        if (page) ordered.push({ source: 'page', page })
      }

      const citations: PendingCitation[] = []
      for (const r of ordered) {
        for (const c of extractCitationsFromPageBody(r.page, ctx.tenantId)) {
          citations.push(c)
        }
      }

      return {
        rows: ordered.slice(0, 3),
        citations,
        injectedPageIds: ordered.slice(0, 3).map((r) => r.page.id),
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
      }
    }

    // --- 2. Cold-start fallback: scope-loaded atoms.
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

    const perRolePicks: AtomRow[] = []
    for (const role of ROLES) {
      const scoped = industry
        ? ((await loadMemoriesByScope(ctx.supabase, {
            tenant_id: ctx.tenantId,
            kind: 'persona',
            industry,
            persona_role: role,
            limit: 1,
          })) as Array<Omit<AtomRow, 'source'>>)
        : []
      if (scoped.length > 0) {
        perRolePicks.push({ ...scoped[0], source: 'atom' })
        continue
      }
      const wide = (await loadMemoriesByScope(ctx.supabase, {
        tenant_id: ctx.tenantId,
        kind: 'persona',
        persona_role: role,
        limit: 1,
      })) as Array<Omit<AtomRow, 'source'>>
      if (wide.length > 0) perRolePicks.push({ ...wide[0], source: 'atom' })
    }

    const atomRows = perRolePicks.slice(0, 3)

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
          'No persona memories yet — mine-personas needs ≥3 won deals with champion/EB flagged.',
        ],
      }
    }

    const citations: PendingCitation[] = []
    for (const m of atomRows) {
      citations.push({ claim_text: m.title, source_type: 'memory', source_id: m.id })
      for (const evidenceUrn of (m.evidence.urns ?? []).slice(0, 2)) {
        const id = evidenceUrn.split(':').pop() ?? evidenceUrn
        citations.push({ claim_text: 'Reference contact', source_type: 'contact', source_id: id })
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

  formatForPrompt(rows: PersonaLibraryRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) return ''
    const tenantId = fmtCtx?.tenantId ?? ''

    // Page path — concatenate one block per role page.
    const pageRows = rows.filter((r): r is PageRow => r.source === 'page')
    if (pageRows.length > 0) {
      return pageRows.map((r) => formatPageForPrompt(r.page, tenantId)).join('\n\n')
    }

    // Atom path: existing markdown framing.
    const atomRows = rows.filter((r): r is AtomRow => r.source === 'atom')
    const lines: string[] = []
    lines.push("### Champion / EB / DM archetypes (from this tenant's wins)")
    lines.push(
      'Use these as the default people to multi-thread to. Surface the title to the rep before suggesting outreach.',
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

  citeRow(row: PersonaLibraryRow) {
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
