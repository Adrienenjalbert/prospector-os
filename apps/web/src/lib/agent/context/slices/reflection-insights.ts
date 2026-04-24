import { urn, type PendingCitation } from '@prospector/core'
import { loadMemoriesByScope } from '@/lib/memory/writer'
import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'

/**
 * `reflection-insights` (Phase 6, Section 3.3) — surfaces the latest
 * cross-deal observations the reflectMemories weekly workflow writes.
 *
 * Loaded for `leader` / `admin` roles only — the observations are
 * portfolio-shaped ("deals where X persona was cited closed 1.4×
 * faster") not per-deal. Reps don't need to see them; leaders /
 * admins do.
 *
 * Reads up to 3 most recent reflection memories (kind='reflection').
 * Each one references the underlying atom + outcome URNs in its
 * evidence so the citation pill UI deep-links correctly.
 *
 * The matching reflection_weekly wiki_pages row carries the same
 * content with a denser format; this slice reads atoms because they
 * are easier to score per-week and keep bounded.
 */

interface ReflectionRow {
  id: string
  kind: string
  title: string
  body: string
  scope: { segment?: string; industry?: string }
  evidence: { urns?: string[]; counts?: Record<string, number>; samples?: string[] }
  confidence: number
}

export const reflectionInsightsSlice: ContextSlice<ReflectionRow> = {
  slug: 'reflection-insights',
  title: 'Cross-deal reflections (this week)',
  category: 'learning',

  triggers: {
    intents: ['portfolio_health', 'forecast', 'diagnosis', 'general_query'],
    roles: ['leader', 'admin'],
  },

  staleness: {
    // Refreshes weekly — TTL longer than the daily slices.
    ttl_ms: 7 * 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/learning'],
  },

  // Up to 3 reflections × ~250 tokens each.
  token_budget: 800,
  soft_timeout_ms: 800,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<ReflectionRow>> {
    const startedAt = Date.now()

    // Read up to 3 most recent reflection atoms. The
    // loadMemoriesByScope helper already orders by confidence desc
    // then derived_at desc — the most recent + highest-confidence
    // reflections come first.
    const rows = (await loadMemoriesByScope(ctx.supabase, {
      tenant_id: ctx.tenantId,
      kind: 'reflection',
      limit: 3,
    })) as ReflectionRow[]

    if (rows.length === 0) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: [
          'No reflection memories yet — reflectMemories runs weekly and needs ≥5 memory injections + outcomes.',
        ],
      }
    }

    const citations: PendingCitation[] = []
    for (const r of rows) {
      citations.push({ claim_text: r.title, source_type: 'memory', source_id: r.id })
      // Each reflection's evidence URNs deep-link to the underlying
      // memories / outcomes the observation rests on.
      for (const u of (r.evidence.urns ?? []).slice(0, 3)) {
        const id = u.split(':').pop() ?? u
        const sourceType = u.includes(':memory:')
          ? 'memory'
          : u.includes(':opportunity:')
            ? 'opportunity'
            : u.includes(':transcript:')
              ? 'transcript'
              : 'memory'
        citations.push({
          claim_text: 'Cited in reflection',
          source_type: sourceType,
          source_id: id,
        })
      }
    }

    return {
      rows,
      citations,
      injectedMemoryIds: rows.map((r) => r.id),
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
    }
  },

  formatForPrompt(rows: ReflectionRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) return ''
    const tenantId = fmtCtx?.tenantId ?? ''
    const lines: string[] = []
    lines.push('### Cross-deal reflections (weekly synthesis)')
    lines.push(
      'These are portfolio-level observations the reflection workflow synthesised this week. Quote the inline `urn:rev:...:memory:...` token to surface the citation pill.',
    )
    for (const r of rows) {
      const memoryUrn = `\`${urn.memory(tenantId, r.id)}\``
      const conf =
        r.confidence < 0.4
          ? ' _(low-confidence)_'
          : r.confidence >= 0.85
            ? ' _(high-confidence)_'
            : ''
      lines.push(`- **${r.title}**${conf} ${memoryUrn}`)
      lines.push(`  ${r.body}`)
    }
    return lines.join('\n')
  },

  citeRow(row: ReflectionRow) {
    return {
      claim_text: row.title,
      source_type: 'memory',
      source_id: row.id,
    }
  },
}
