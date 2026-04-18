import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import { citeTranscript, fmtAge, urnInline } from './_helpers'

/**
 * `transcript-summaries` — recent call/meeting summaries for the active
 * company over the last 60 days. Top 3 by recency.
 *
 * In Phase 1 this is recency-sorted (cheap, no embedding cost). The on-
 * demand `hydrate_context` tool in Phase 2 will offer a query-embedded
 * variant when the agent needs semantic match across the full corpus.
 *
 * Loaded for meeting_prep / diagnosis / stakeholder_mapping intents on
 * AE/CSM/AD roles when an active company is in scope.
 */

interface TranscriptRow {
  id: string
  title: string | null
  summary: string | null
  themes: string[]
  occurred_at: string
  source_url: string | null
  source: string | null
}

export const transcriptSummariesSlice: ContextSlice<TranscriptRow> = {
  slug: 'transcript-summaries',
  title: 'Recent transcripts',
  category: 'health',

  triggers: {
    intents: [
      'meeting_prep',
      'diagnosis',
      'stakeholder_mapping',
      'risk_analysis',
    ],
    roles: ['ae', 'nae', 'growth_ae', 'csm', 'ad', 'leader'],
    objects: ['company', 'deal'],
  },

  staleness: {
    ttl_ms: 60 * 60 * 1000,
    invalidate_on: ['transcript_ingest', 'webhooks/transcripts'],
  },

  token_budget: 500,
  soft_timeout_ms: 1500,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<TranscriptRow>> {
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
        warnings: ['transcript-summaries needs an active company id.'],
      }
    }

    // Cooperative deadline check. The packer assigns each turn a hard
    // wall-clock deadline (`SliceLoadCtx.deadlineMs`) so 12 parallel
    // slice loads can't blow the route's 30s budget. This is the
    // heaviest slice (joins + ranks transcripts), so we honour the
    // contract here even though the packer's per-slice timeout would
    // catch a runaway query — the cooperative bail returns "no
    // transcripts available" rather than a timeout warning, which
    // reads as honest rather than broken in the agent's response.
    if (Date.now() > ctx.deadlineMs) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: ['transcript-summaries: turn budget exceeded before fetch.'],
      }
    }

    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await ctx.supabase
      .from('transcripts')
      .select('id, title, summary, themes, occurred_at, source_url, source')
      .eq('tenant_id', ctx.tenantId)
      .eq('company_id', ctx.activeCompanyId)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(3)

    if (error) {
      throw new Error(`transcript-summaries query failed: ${error.message}`)
    }

    const rows: TranscriptRow[] = (data ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      summary: t.summary,
      themes: (t.themes as string[]) ?? [],
      occurred_at: t.occurred_at,
      source_url: t.source_url,
      source: t.source,
    }))

    return {
      rows,
      citations: rows.map((r) => citeTranscript(r)),
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
      warnings: rows.length === 0 ? ['No transcripts in the last 60 days for this company.'] : undefined,
    }
  },

  formatForPrompt(rows: TranscriptRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) {
      return '### Recent transcripts (60d)\n_No transcripts captured for this company in the last 60 days._'
    }
    const tenantId = fmtCtx?.tenantId ?? ''
    const blocks = rows.map((r) => {
      const titlePart = r.title ?? r.source ?? 'Transcript'
      const themesPart = r.themes.length ? ` · themes: ${r.themes.slice(0, 4).join(', ')}` : ''
      const summary = r.summary
        ? r.summary.slice(0, 240)
        : '_No summary._'
      return `**${titlePart}** (${fmtAge(r.occurred_at)}${themesPart})\n> ${summary}\n${urnInline(tenantId, 'transcript', r.id)}`
    })
    return `### Recent transcripts (${rows.length})\n${blocks.join('\n\n')}`
  },

  citeRow(row) {
    return {
      claim_text: row.title ?? row.summary?.slice(0, 60) ?? 'Transcript',
      source_type: 'transcript',
      source_id: row.id,
    }
  },
}
