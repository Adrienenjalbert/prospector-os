import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import { citeSignal, fmtAge, urnInline } from './_helpers'

/**
 * `champion-alumni-opportunities` — surfaces signals of type
 * `champion_alumni` for the rep's accounts. These are the perpetual
 * pipeline source the Champion Alumni Tracker workflow generates: every
 * former champion who has moved to a new company in the rep's CRM is a
 * pre-warmed warm-intro opportunity.
 *
 * Always-on for AE/NAE/growth_AE roles when at least one champion-alumni
 * signal exists for the rep — the agent gets a perpetual reminder of the
 * highest-converting source of new pipeline (industry data: 4-8x cold).
 *
 * Format favours the rep's "ah, I should reach out to them" reflex:
 *   - Names the moved person + the source company they championed
 *   - Names the new company (URN-cited so the citation pill links)
 *   - Includes a one-line nudge to call draft_alumni_intro for a
 *     warm-intro draft
 */

interface AlumniRow {
  signal_id: string
  signal_title: string
  signal_description: string | null
  detected_at: string
  source_url: string | null
  signal_type: string
  /** New (target) company for the warm intro. */
  new_company_id: string
  new_company_name: string
}

export const championAlumniSlice: ContextSlice<AlumniRow> = {
  slug: 'champion-alumni-opportunities',
  title: 'Champion alumni — warm-intro pipeline',
  category: 'pipeline',

  triggers: {
    intents: [
      'draft_outreach',
      'meeting_prep',
      'forecast',
      'lookup',
      'general_query',
      'portfolio_health',
      'signal_triage',
    ],
    roles: ['ae', 'nae', 'growth_ae', 'ad'],
    // Substring match on signal_type — picks up any signal whose type
    // contains "champion_alumni". Lets future variants (champion_alumni_director
    // etc.) flow through naturally.
    signalTypes: ['champion_alumni'],
  },

  staleness: {
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/learning'],
  },

  token_budget: 350,
  soft_timeout_ms: 1500,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<AlumniRow>> {
    const startedAt = Date.now()

    // Find rep's owned company ids first — alumni signals are scoped to
    // companies in the rep's book. This keeps the slice noise-free for
    // reps who shouldn't see other reps' alumni moves.
    const { data: ownedCompanies } = await ctx.supabase
      .from('companies')
      .select('id, name')
      .eq('tenant_id', ctx.tenantId)
      .eq('owner_crm_id', ctx.repId)
      .limit(200)

    const ownedCompanyIds = (ownedCompanies ?? []).map((c) => c.id)
    if (ownedCompanyIds.length === 0) {
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

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

    const { data: signals, error } = await ctx.supabase
      .from('signals')
      .select('id, company_id, signal_type, title, description, detected_at, source_url')
      .eq('tenant_id', ctx.tenantId)
      .ilike('signal_type', '%champion_alumni%')
      .in('company_id', ownedCompanyIds)
      .gte('detected_at', since)
      .order('weighted_score', { ascending: false })
      .limit(5)
    if (error) {
      throw new Error(`champion-alumni-opportunities query failed: ${error.message}`)
    }

    const signalRows = signals ?? []
    if (signalRows.length === 0) {
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

    const companyById = new Map(
      (ownedCompanies ?? []).map((c) => [c.id as string, c]),
    )

    const rows: AlumniRow[] = signalRows.map((s) => ({
      signal_id: s.id,
      signal_title: s.title,
      signal_description: s.description,
      detected_at: s.detected_at,
      source_url: s.source_url,
      signal_type: s.signal_type,
      new_company_id: s.company_id,
      new_company_name: companyById.get(s.company_id)?.name ?? 'Unknown',
    }))

    return {
      rows,
      citations: rows.map((r) =>
        citeSignal({
          id: r.signal_id,
          title: r.signal_title,
          signal_type: r.signal_type,
          source_url: r.source_url,
        }),
      ),
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
    }
  },

  formatForPrompt(rows: AlumniRow[], fmtCtx?: { tenantId: string }): string {
    if (rows.length === 0) {
      return '### Champion alumni — warm-intro pipeline\n_No alumni opportunities surfaced yet — the nightly detector populates this as champions move._'
    }
    const tenantId = fmtCtx?.tenantId ?? ''
    const lines = rows.slice(0, 5).map((r) => {
      const fresh = fmtAge(r.detected_at)
      return `- ${r.signal_title} → ${r.new_company_name} ${urnInline(tenantId, 'company', r.new_company_id)} (detected ${fresh})`
    })
    return `### Champion alumni — warm-intro pipeline (${rows.length})
${lines.join('\n')}

_For any of these, call \`draft_alumni_intro\` with the contact and new-company URNs to get a warm-intro draft. These convert at 4-8x the rate of cold outbound._`
  },

  citeRow(row) {
    return {
      claim_text: row.signal_title,
      source_type: 'signal',
      source_id: row.signal_id,
      source_url: row.source_url ?? undefined,
    }
  },
}
