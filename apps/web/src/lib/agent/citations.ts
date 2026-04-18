import type { CitationCollector } from '@prospector/core'

/**
 * Builds a deep link to a record in the tenant's CRM. Returns null if the
 * CRM type isn't recognized or required pieces are missing. Used to populate
 * source_url on citations so the UI can offer "open in CRM" links.
 */
export function buildCrmRecordUrl(
  crmType: string | null | undefined,
  recordType: 'company' | 'opportunity' | 'contact',
  crmId: string | null | undefined,
): string | undefined {
  if (!crmId || !crmType) return undefined

  if (crmType === 'hubspot') {
    const objectId =
      recordType === 'company' ? '0-2' : recordType === 'opportunity' ? '0-3' : '0-1'
    return `https://app.hubspot.com/contacts/0/record/${objectId}/${crmId}`
  }

  if (crmType === 'salesforce') {
    return `https://lightning.force.com/lightning/r/${crmId}/view`
  }

  return undefined
}

type Row = Record<string, unknown>

function asRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is Row => v != null && typeof v === 'object')
}

function asRow(value: unknown): Row | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Row
}

function str(row: Row, key: string): string | undefined {
  const v = row[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export interface CitationContext {
  collector: CitationCollector
  crmType: string | null
}

type Extractor = (ctx: CitationContext, result: Row) => void

const addOpportunity = (ctx: CitationContext, deal: Row) => {
  const id = str(deal, 'id') ?? str(deal, 'crm_id')
  if (!id && !str(deal, 'name')) return
  ctx.collector.addCitation({
    claim_text: str(deal, 'name') ?? 'Opportunity',
    source_type: 'opportunity',
    source_id: id,
    source_url: buildCrmRecordUrl(ctx.crmType, 'opportunity', str(deal, 'crm_id') ?? id),
  })
}

const addCompany = (ctx: CitationContext, company: Row) => {
  const id = str(company, 'id') ?? str(company, 'crm_id')
  if (!id && !str(company, 'name')) return
  ctx.collector.addCitation({
    claim_text: str(company, 'name') ?? 'Company',
    source_type: 'company',
    source_id: id,
    source_url: buildCrmRecordUrl(ctx.crmType, 'company', str(company, 'crm_id') ?? id),
  })
}

const addContact = (ctx: CitationContext, contact: Row) => {
  const first = str(contact, 'first_name') ?? ''
  const last = str(contact, 'last_name') ?? ''
  const name = `${first} ${last}`.trim()
  if (!name && !str(contact, 'email')) return
  const id = str(contact, 'id') ?? str(contact, 'crm_id')
  ctx.collector.addCitation({
    claim_text: name || (str(contact, 'email') ?? 'Contact'),
    source_type: 'contact',
    source_id: id,
    source_url: buildCrmRecordUrl(ctx.crmType, 'contact', str(contact, 'crm_id') ?? id),
  })
}

const addSignal = (ctx: CitationContext, signal: Row) => {
  const title = str(signal, 'title') ?? str(signal, 'signal_type') ?? 'Signal'
  ctx.collector.addCitation({
    claim_text: title,
    source_type: 'signal',
    source_id: str(signal, 'id'),
  })
}

const addBenchmark = (ctx: CitationContext, stage: Row) => {
  const name = str(stage, 'stage') ?? str(stage, 'stage_name')
  if (!name) return
  ctx.collector.addCitation({
    claim_text: `Benchmark: ${name}`,
    source_type: 'funnel_benchmark',
    source_id: name,
  })
}

const addTranscript = (ctx: CitationContext, t: Row) => {
  ctx.collector.addCitation({
    claim_text: str(t, 'title') ?? 'Transcript',
    source_type: 'transcript',
    source_id: str(t, 'id'),
  })
}

/**
 * Sales-framework citation. The `consult_sales_framework` tool returns a
 * structured `citations` array on its result; we forward each entry as a
 * `framework`-typed citation so the UI's citation pill shows e.g.
 * "SPIN Selling — Rackham (1988)" with an optional canonical URL.
 *
 * Treating frameworks as cite-able sources keeps the cite-or-shut-up rule
 * intact even when the agent leans on a methodology rather than a CRM
 * record. Without this, an agent answering "what SPIN questions should I
 * ask" produces no citation, fails the citation-enforcer middleware, and
 * gets penalised in evals.
 */
const addFramework = (ctx: CitationContext, f: Row) => {
  const slug = str(f, 'framework_slug') ?? str(f, 'slug')
  const title = str(f, 'title') ?? slug ?? 'Sales framework'
  const source = str(f, 'source')
  ctx.collector.addCitation({
    claim_text: source ? `${title} — ${source}` : title,
    source_type: 'framework',
    source_id: slug,
    source_url: str(f, 'url'),
  })
}

/**
 * Citation for onboarding-time analytics tools.
 *
 * Onboarding tools (`explore_crm_fields`, `analyze_*`, `propose_*`,
 * `apply_*`) return aggregated stats derived from the tenant's CRM or
 * synced ontology. They are user-visible domain claims and therefore
 * fall under the cite-or-shut-up rule, even though they don't reference
 * a single record.
 *
 * The citation points at the data source the analysis was drawn from:
 * either the live CRM (via `crm_type` on the result, deep-linked to the
 * appropriate console) or the local ontology browser. `source_id` is the
 * tool slug so the citation pill labels the analysis honestly
 * ("Analysis: 47 won deals from HubSpot").
 */
const addOnboardingSource = (
  ctx: CitationContext,
  toolSlug: string,
  result: Row,
  defaultClaim: string,
) => {
  const data = result.data && typeof result.data === 'object' ? (result.data as Row) : result
  const counts: string[] = []
  for (const [key, val] of Object.entries(data)) {
    if (val && typeof val === 'object' && 'count' in (val as Row) && typeof (val as Row).count === 'number') {
      counts.push(`${(val as Row).count} ${key}`)
    }
  }
  const totalAccounts = typeof result.total_accounts === 'number' ? result.total_accounts : null
  const wonDeals = typeof result.won_deals === 'number' ? result.won_deals : null
  const stagesAnalyzed = Array.isArray(result.stages_found) ? (result.stages_found as unknown[]).length : null

  const summary = counts.length
    ? counts.join(' · ')
    : totalAccounts != null
      ? `${totalAccounts} accounts analysed`
      : wonDeals != null
        ? `${wonDeals} won deals analysed`
        : stagesAnalyzed != null
          ? `${stagesAnalyzed} pipeline stages detected`
          : defaultClaim

  const crmType = typeof result.crm_type === 'string' ? result.crm_type : ctx.crmType
  const sourceTypeLabel = crmType ? `${crmType} CRM` : 'tenant data'

  ctx.collector.addCitation({
    claim_text: `${defaultClaim} (${summary}, source: ${sourceTypeLabel})`,
    source_type: 'tenant_config',
    source_id: toolSlug,
    source_url: '/onboarding',
  })
}

/**
 * Per-tool extractors. Keep these tightly scoped to the actual shape returned
 * by each tool's execute() — matches drive trust, mismatches add noise. When a
 * tool changes its return shape, update the extractor here.
 */
const EXTRACTORS: Record<string, Extractor> = {
  // Pipeline Coach
  get_pipeline_overview: (ctx, r) => {
    for (const d of asRows(r.deals)) addOpportunity(ctx, d)
  },
  get_deal_detail: (ctx, r) => {
    const deal = asRow(r.deal)
    if (deal) addOpportunity(ctx, deal)
    const company = asRow(r.company)
    if (company) addCompany(ctx, company)
    for (const c of asRows(r.contacts)) addContact(ctx, c)
  },
  get_funnel_benchmarks: (ctx, r) => {
    for (const s of asRows(r.stages)) addBenchmark(ctx, s)
  },
  detect_stalls: (ctx, r) => {
    for (const d of asRows(r.stalled_and_at_risk)) addOpportunity(ctx, d)
  },
  suggest_next_action: (ctx, r) => {
    const deal = asRow(r.deal)
    if (deal) addOpportunity(ctx, deal)
    for (const s of asRows(r.active_signals)) addSignal(ctx, s)
    for (const c of asRows(r.contacts)) addContact(ctx, c)
  },
  explain_score: (ctx, r) => {
    const company = asRow(r.company)
    if (company) addCompany(ctx, company)
  },

  // Account Strategist (formerly outreach)
  research_account: (ctx, r) => {
    const company = asRow(r.company)
    if (company) addCompany(ctx, company)
    for (const s of asRows(r.signals)) addSignal(ctx, s)
    for (const c of asRows(r.contacts)) addContact(ctx, c)
    for (const d of asRows(r.open_deals)) addOpportunity(ctx, d)
  },
  find_contacts: (ctx, r) => {
    for (const c of asRows(r.contacts)) addContact(ctx, c)
  },
  get_active_signals: (ctx, r) => {
    for (const s of asRows(r.signals)) addSignal(ctx, s)
  },
  search_transcripts: (ctx, r) => {
    for (const t of asRows(r.transcripts)) addTranscript(ctx, t)
  },
  draft_outreach: (ctx, r) => {
    const company = asRow(r.company)
    if (company) addCompany(ctx, company)
    for (const s of asRows(r.signals)) addSignal(ctx, s)
    const contact = asRow(r.contact)
    if (contact) addContact(ctx, contact)
  },
  draft_meeting_brief: (ctx, r) => {
    const company = asRow(r.company)
    if (company) addCompany(ctx, company)
    for (const c of asRows(r.contacts)) addContact(ctx, c)
    for (const s of asRows(r.signals)) addSignal(ctx, s)
  },

  // Leadership Lens
  funnel_divergence: (ctx, r) => {
    for (const s of asRows(r.stages)) addBenchmark(ctx, s)
  },
  forecast_risk: (ctx, r) => {
    for (const d of asRows(r.at_risk_deals)) addOpportunity(ctx, d)
  },
  team_patterns: (_ctx, _r) => {
    // Aggregated team patterns don't cite individual records.
  },
  coaching_themes: (_ctx, _r) => {
    // Synthesised theme buckets aren't tied to specific source rows.
  },

  // Onboarding Coach — every tool's result is a domain claim derived from
  // the tenant's data ("we analysed 47 won deals across 3 industries").
  // Cite the data source (live CRM vs synced ontology) so the citation
  // pill links the rep to the place those numbers came from. See
  // `addOnboardingSource` above for the citation shape.
  explore_crm_fields: (ctx, r) =>
    addOnboardingSource(ctx, 'explore_crm_fields', r, 'CRM schema exploration'),
  analyze_account_distribution: (ctx, r) =>
    addOnboardingSource(ctx, 'analyze_account_distribution', r, 'Account distribution analysis'),
  analyze_pipeline_history: (ctx, r) =>
    addOnboardingSource(ctx, 'analyze_pipeline_history', r, 'Pipeline history analysis'),
  analyze_contact_patterns: (ctx, r) =>
    addOnboardingSource(ctx, 'analyze_contact_patterns', r, 'Contact-pattern analysis'),
  propose_icp_config: (ctx, r) =>
    addOnboardingSource(ctx, 'propose_icp_config', r, 'Proposed ICP scoring config'),
  propose_funnel_config: (ctx, r) =>
    addOnboardingSource(ctx, 'propose_funnel_config', r, 'Proposed funnel benchmarks'),
  apply_icp_config: (ctx, r) =>
    addOnboardingSource(ctx, 'apply_icp_config', r, 'ICP config applied'),
  apply_funnel_config: (ctx, r) =>
    addOnboardingSource(ctx, 'apply_funnel_config', r, 'Funnel config applied'),

  // Knowledge / framework consultations
  consult_sales_framework: (ctx, r) => {
    for (const c of asRows(r.citations)) addFramework(ctx, c)
  },

  // Context Pack on-demand slice hydration. The slice's loader already
  // builds full PendingCitation rows in `result.citations`; the tool
  // simply forwards them, so the extractor only needs to pass them
  // through to the collector unchanged.
  hydrate_context: (ctx, r) => {
    for (const c of asRows(r.citations)) {
      const claim = str(c, 'claim_text')
      if (!claim) continue
      ctx.collector.addCitation({
        claim_text: claim,
        source_type: str(c, 'source_type') ?? 'unknown',
        source_id: str(c, 'source_id'),
        source_url: str(c, 'source_url'),
      })
    }
  },

  // Champion alumni intro drafter — same shape as hydrate_context: tool
  // returns pre-built citations spanning contact + original company +
  // original deal + new company. Pass through to the collector.
  draft_alumni_intro: (ctx, r) => {
    for (const c of asRows(r.citations)) {
      const claim = str(c, 'claim_text')
      if (!claim) continue
      ctx.collector.addCitation({
        claim_text: claim,
        source_type: str(c, 'source_type') ?? 'unknown',
        source_id: str(c, 'source_id'),
        source_url: str(c, 'source_url'),
      })
    }
  },

  // CRM write-back tools (Phase 3.6) — each returns citations pointing
  // at the just-written CRM record so the citation pill links the rep
  // to the new note/task/property in HubSpot. Same pass-through pattern
  // as hydrate_context / draft_alumni_intro.
  log_crm_activity: (ctx, r) => {
    for (const c of asRows(r.citations)) {
      const claim = str(c, 'claim_text')
      if (!claim) continue
      ctx.collector.addCitation({
        claim_text: claim,
        source_type: str(c, 'source_type') ?? 'unknown',
        source_id: str(c, 'source_id'),
        source_url: str(c, 'source_url'),
      })
    }
  },
  update_crm_property: (ctx, r) => {
    for (const c of asRows(r.citations)) {
      const claim = str(c, 'claim_text')
      if (!claim) continue
      ctx.collector.addCitation({
        claim_text: claim,
        source_type: str(c, 'source_type') ?? 'unknown',
        source_id: str(c, 'source_id'),
        source_url: str(c, 'source_url'),
      })
    }
  },
  create_crm_task: (ctx, r) => {
    for (const c of asRows(r.citations)) {
      const claim = str(c, 'claim_text')
      if (!claim) continue
      ctx.collector.addCitation({
        claim_text: claim,
        source_type: str(c, 'source_type') ?? 'unknown',
        source_id: str(c, 'source_id'),
        source_url: str(c, 'source_url'),
      })
    }
  },
}

export function recordCitationsFromToolResult(
  ctx: CitationContext,
  toolName: string,
  result: unknown,
): void {
  if (result == null || typeof result !== 'object' || Array.isArray(result)) return

  const extractor = EXTRACTORS[toolName]
  if (!extractor) return

  try {
    extractor(ctx, result as Row)
  } catch (err) {
    console.warn(`[citations] extractor failed for ${toolName}:`, err)
  }
}
