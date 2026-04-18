import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import { citeContact, fmtAge, urnInline } from './_helpers'

/**
 * `key-contact-notes` — recent rep-authored notes on contacts at the active
 * company (or the top priority account when no company is active). Pulls
 * from `relationship_notes` written via the relationship_notes tool.
 *
 * Loaded for meeting_prep / draft_outreach intents on AE/CSM/AD roles.
 * Cheap (single join) but high signal — these are facts the rep already
 * recorded ("champion has a daughter starting at MIT", "Mike asked about
 * SOC2") that the agent should weave into outreach.
 */

interface NoteRow {
  id: string
  contact_id: string | null
  contact_name: string
  contact_crm_id: string | null
  contact_first_name: string | null
  contact_last_name: string | null
  contact_email: string | null
  note_type: string | null
  content: string
  created_at: string
}

export const keyContactNotesSlice: ContextSlice<NoteRow> = {
  slug: 'key-contact-notes',
  title: 'Key contact notes',
  category: 'people',

  triggers: {
    intents: ['meeting_prep', 'draft_outreach', 'risk_analysis'],
    roles: ['ae', 'nae', 'growth_ae', 'csm', 'ad'],
  },

  staleness: {
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/sync'],
  },

  token_budget: 250,
  soft_timeout_ms: 1000,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<NoteRow>> {
    const startedAt = Date.now()

    // Scope: active company first, otherwise rep's whole book.
    let contactIds: string[] | null = null
    if (ctx.activeCompanyId) {
      const { data: contacts } = await ctx.supabase
        .from('contacts')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('company_id', ctx.activeCompanyId)
      contactIds = (contacts ?? []).map((c) => c.id)
      if (contactIds.length === 0) contactIds = null
    }

    let query = ctx.supabase
      .from('relationship_notes')
      .select('id, contact_id, note_type, content, created_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('rep_crm_id', ctx.repId)
      .order('created_at', { ascending: false })
      .limit(5)

    if (contactIds) {
      query = query.in('contact_id', contactIds)
    }

    const { data: notes, error } = await query
    if (error) {
      throw new Error(`key-contact-notes query failed: ${error.message}`)
    }
    const noteRows = notes ?? []
    if (noteRows.length === 0) {
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

    const noteContactIds = [...new Set(noteRows.map((n) => n.contact_id).filter(Boolean) as string[])]
    const { data: contactDetails } = noteContactIds.length
      ? await ctx.supabase
          .from('contacts')
          .select('id, crm_id, first_name, last_name, email')
          .eq('tenant_id', ctx.tenantId)
          .in('id', noteContactIds)
      : { data: [] as { id: string; crm_id: string | null; first_name: string | null; last_name: string | null; email: string | null }[] }

    const contactById = new Map((contactDetails ?? []).map((c) => [c.id, c]))

    const rows: NoteRow[] = noteRows.map((n) => {
      const c = n.contact_id ? contactById.get(n.contact_id) : undefined
      const name = c
        ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email || 'Contact'
        : 'Unknown contact'
      return {
        id: n.id,
        contact_id: n.contact_id,
        contact_name: name,
        contact_crm_id: c?.crm_id ?? null,
        contact_first_name: c?.first_name ?? null,
        contact_last_name: c?.last_name ?? null,
        contact_email: c?.email ?? null,
        note_type: n.note_type,
        content: n.content,
        created_at: n.created_at,
      }
    })

    const citations = rows
      .filter((r) => r.contact_id)
      .map((r) =>
        citeContact(ctx.tenantId, ctx.crmType, {
          id: r.contact_id as string,
          crm_id: r.contact_crm_id,
          first_name: r.contact_first_name,
          last_name: r.contact_last_name,
          email: r.contact_email,
        }),
      )

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

  formatForPrompt(rows: NoteRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) {
      return '### Key contact notes\n_No personal notes recorded yet — encourage the rep to capture takeaways via the relationship_notes tool._'
    }
    const tenantId = fmtCtx?.tenantId ?? ''
    const lines = rows.slice(0, 5).map((r) => {
      const urn = r.contact_id ? ` ${urnInline(tenantId, 'contact', r.contact_id)}` : ''
      const trimmed = r.content.length > 180 ? `${r.content.slice(0, 180)}…` : r.content
      return `- ${r.contact_name}${urn} (${r.note_type ?? 'note'}, ${fmtAge(r.created_at)}): ${trimmed}`
    })
    return `### Key contact notes (${rows.length})\n${lines.join('\n')}`
  },

  citeRow(row) {
    return {
      claim_text: `${row.contact_name} note`,
      source_type: 'contact',
      source_id: row.contact_id ?? row.id,
    }
  },
}
