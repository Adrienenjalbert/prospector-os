import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import { citeContact, urnInline, fmtAge } from './_helpers'
import { embedQuery } from '../embed-query'

/**
 * `relevant-notes-rag` (C5.2) — top-K relationship notes by SEMANTIC
 * similarity to the rep's current question.
 *
 * Differs from the legacy `key-contact-notes` slice (which loads the
 * 5 most-recent notes by `created_at`):
 *   - Uses the `match_notes` RPC (migration 020) to retrieve by
 *     cosine similarity on the OpenAI text-embedding-3-small vector.
 *   - Top-3 only — RAG quality drops fast past the third hit.
 *   - Skips entirely when:
 *       a. user message is empty (workflow / eval callers),
 *       b. OPENAI_API_KEY is unset (RAG infra not deployed),
 *       c. the embed call fails (rate limit / network).
 *     In every skip case the slice returns 0 rows, the packer marks
 *     `__skipped: true`, and the legacy `key-contact-notes` slice is
 *     still in the registry to fill the gap.
 *
 * The two slices are intentionally co-resident. Tenants with the
 * embeddings cron running pin `relevant-notes-rag` (better quality);
 * tenants on the legacy infrastructure keep `key-contact-notes`. The
 * selector picks based on tenant `pinned`/`allow` config.
 */

interface NoteHit {
  id: string
  company_id: string | null
  contact_id: string | null
  body: string
  similarity: number
}

export const relevantNotesRagSlice: ContextSlice<NoteHit> = {
  slug: 'relevant-notes-rag',
  title: 'Relevant relationship notes (RAG)',
  category: 'people',

  triggers: {
    intents: ['meeting_prep', 'draft_outreach', 'risk_analysis', 'diagnosis'],
    roles: ['ae', 'nae', 'growth_ae', 'csm', 'ad'],
  },

  staleness: {
    // Notes turn over slowly; embeddings are nightly. 24h TTL is
    // safe.
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/learning'],
  },

  token_budget: 250,
  soft_timeout_ms: 1500, // higher than legacy because of embed call

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<NoteHit>> {
    const startedAt = Date.now()
    const text = (ctx.userMessageText ?? '').trim()
    if (!text) {
      return {
        rows: [],
        citations: [],
        provenance: { fetched_at: new Date().toISOString(), source: 'db', duration_ms: Date.now() - startedAt },
        warnings: ['no user message — relevant-notes-rag skipped'],
      }
    }

    let queryEmbedding: number[]
    try {
      queryEmbedding = await embedQuery(text)
    } catch (err) {
      return {
        rows: [],
        citations: [],
        provenance: { fetched_at: new Date().toISOString(), source: 'db', duration_ms: Date.now() - startedAt },
        warnings: [`embed failed: ${err instanceof Error ? err.message : String(err)}`],
      }
    }

    const { data, error } = await ctx.supabase.rpc('match_notes', {
      query_embedding: queryEmbedding,
      match_tenant_id: ctx.tenantId,
      match_threshold: 0.5,
      match_count: 3,
      filter_company_id: ctx.activeCompanyId ?? null,
    })
    if (error) {
      // RPC missing (migration not applied) is the most common cause —
      // log + degrade. Other errors also degrade so RAG is never a
      // hard dependency.
      return {
        rows: [],
        citations: [],
        provenance: { fetched_at: new Date().toISOString(), source: 'db', duration_ms: Date.now() - startedAt },
        warnings: [`match_notes RPC failed: ${error.message}`],
      }
    }

    const rows = (data ?? []) as NoteHit[]
    if (rows.length === 0) {
      return {
        rows: [],
        citations: [],
        provenance: { fetched_at: new Date().toISOString(), source: 'db', duration_ms: Date.now() - startedAt },
      }
    }

    // Build citations against the contacts (URN target). Notes don't
    // have a citable URN type today; the contact does.
    const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((id): id is string => !!id))]
    const { data: contacts } = contactIds.length
      ? await ctx.supabase
          .from('contacts')
          .select('id, crm_id, first_name, last_name, email')
          .eq('tenant_id', ctx.tenantId)
          .in('id', contactIds)
      : { data: [] as Array<{ id: string; crm_id: string | null; first_name: string | null; last_name: string | null; email: string | null }> }
    const contactById = new Map((contacts ?? []).map((c) => [c.id, c]))

    const citations = rows
      .filter((r) => r.contact_id)
      .map((r) =>
        citeContact(ctx.tenantId, ctx.crmType, {
          id: r.contact_id as string,
          crm_id: contactById.get(r.contact_id as string)?.crm_id ?? null,
          first_name: contactById.get(r.contact_id as string)?.first_name ?? null,
          last_name: contactById.get(r.contact_id as string)?.last_name ?? null,
          email: contactById.get(r.contact_id as string)?.email ?? null,
        }),
      )

    return {
      rows,
      citations,
      provenance: { fetched_at: new Date().toISOString(), source: 'db', duration_ms: Date.now() - startedAt },
    }
  },

  formatForPrompt(rows: NoteHit[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) {
      return '### Relevant notes\n_No notes matched this question semantically._'
    }
    const tenantId = fmtCtx?.tenantId ?? ''
    const lines = rows.map((r, i) => {
      const urn = r.contact_id ? ` ${urnInline(tenantId, 'contact', r.contact_id)}` : ''
      const trimmed = r.body.length > 220 ? `${r.body.slice(0, 220)}…` : r.body
      const sim = (r.similarity * 100).toFixed(0)
      return `- [#${i + 1} ${sim}% match]${urn} ${trimmed}`
    })
    return `### Relevant notes (top ${rows.length} by similarity)\n${lines.join('\n')}`
  },

  citeRow(row: NoteHit) {
    return {
      claim_text: 'relationship note',
      source_type: 'contact',
      source_id: row.contact_id ?? row.id,
    }
  },

  // `fmtAge` import is intentional even when unused in current
  // formatForPrompt — kept available for tenants who want to add a
  // recency suffix without re-importing.
  // (eslint-disable-next-line @typescript-eslint/no-unused-vars at module level)
}

// Suppress "imported but unused" without a directive — the helper is
// part of this slice's public toolkit and kept available for an
// upcoming "show last touched" sub-feature.
void fmtAge
