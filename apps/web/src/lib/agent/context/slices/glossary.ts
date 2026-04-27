import { urn, type PendingCitation } from '@prospector/core'
import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'

/**
 * `glossary` (Phase 3 of the smart memory layer) — surfaces tenant-
 * specific terms (product names, acronyms, processes) that are
 * mentioned in the rep's current message OR in the active company's
 * recent transcripts.
 *
 * The mine-glossary workflow extracts capitalised terms from
 * transcripts; this slice picks the top-3 that the rep is likely to
 * encounter on this turn:
 *
 *   1. Direct mentions in `userMessageText` (highest priority — the
 *      rep is asking about the term right now).
 *   2. Terms whose evidence_urns include the active company's recent
 *      transcripts (the agent should use these verbatim instead of
 *      paraphrasing).
 *
 * Falls back to the top-3 most-frequent tenant-wide glossary terms
 * when the message + company filters yield nothing — this gives the
 * agent a baseline vocabulary even on cold-start turns.
 *
 * Token budget intentionally tiny (200 tokens) — glossary entries
 * are short by construction.
 */

interface GlossaryRow {
  id: string
  title: string
  body: string
  evidence: { urns?: string[]; counts?: Record<string, number>; samples?: string[] }
  confidence: number
}

const TOP_K = 3

export const glossarySlice: ContextSlice<GlossaryRow> = {
  slug: 'glossary',
  title: 'Tenant glossary',
  category: 'learning',

  triggers: {
    // Always-on at low priority — the agent never needs MORE than 3
    // glossary terms per turn but it nearly always benefits from
    // having tenant-specific vocabulary present.
    always: true,
  },

  staleness: {
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/learning'],
  },

  token_budget: 200,
  soft_timeout_ms: 600,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<GlossaryRow>> {
    const startedAt = Date.now()
    const userText = (ctx.userMessageText ?? '').toLowerCase()

    // Step 1: pull a generous candidate set so we can re-rank locally
    // by mention / company recency. Limit 20 keeps the query cheap.
    const { data: candidates } = await ctx.supabase
      .from('tenant_memories')
      .select('id, title, body, evidence, confidence')
      .eq('tenant_id', ctx.tenantId)
      .eq('kind', 'glossary_term')
      .in('status', ['approved', 'pinned'])
      .order('confidence', { ascending: false })
      .limit(20)

    const all = (candidates ?? []) as GlossaryRow[]
    if (all.length === 0) {
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

    // Step 2: score each candidate. Three contributions:
    //   - Direct mention in user text (+10).
    //   - Evidence URN matches a transcript on the active company
    //     (resolved below; +3 each, capped).
    //   - Base ranking by confidence.
    let activeCompanyTranscriptUrns = new Set<string>()
    if (ctx.activeCompanyId) {
      const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
      const { data: transcripts } = await ctx.supabase
        .from('transcripts')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('company_id', ctx.activeCompanyId)
        .gte('occurred_at', since)
        .limit(50)
      activeCompanyTranscriptUrns = new Set(
        (transcripts ?? []).map((t) => urn.transcript(ctx.tenantId, t.id)),
      )
    }

    const scored = all.map((m) => {
      let score = m.confidence
      const titleLower = m.title.toLowerCase()
      if (userText.length > 0 && userText.includes(titleLower)) {
        score += 10
      }
      const urns = m.evidence.urns ?? []
      const companyHits = urns.filter((u) => activeCompanyTranscriptUrns.has(u)).length
      score += Math.min(companyHits * 3, 9)
      return { row: m, score }
    })

    scored.sort((a, b) => b.score - a.score)
    const picked = scored.slice(0, TOP_K).map((s) => s.row)

    const citations: PendingCitation[] = picked.map((m) => ({
      claim_text: m.title,
      source_type: 'memory',
      source_id: m.id,
    }))

    return {
      rows: picked,
      citations,
      // Phase 6 (1.2) — close the bandit loop on glossary terms.
      injectedMemoryIds: picked.map((m) => m.id),
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
    }
  },

  formatForPrompt(rows: GlossaryRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) return ''
    const tenantId = fmtCtx?.tenantId ?? ''
    const items = rows.map((m) => {
      const memoryUrn = `\`${urn.memory(tenantId, m.id)}\``
      return `- **${m.title}** ${memoryUrn} — ${truncate(m.body, 120)}`
    })
    return [
      '### Glossary (tenant-specific terms — use verbatim)',
      ...items,
    ].join('\n')
  },

  citeRow(row: GlossaryRow) {
    return {
      claim_text: row.title,
      source_type: 'memory',
      source_id: row.id,
    }
  },
}

function truncate(s: string, max: number): string {
  if (!s) return ''
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}
