import { z } from 'zod'

/**
 * Runtime Zod schemas aligned with the TypeScript types in `ontology.ts` and
 * `platform.ts`. These exist for:
 *   - Validating inbound payloads at the tool boundary
 *   - Driving structured outputs from the agent (generateObject / streamObject)
 *   - Generating JSON Schema for the tool registry
 *
 * Keep these schemas lenient on fields that may be null from the CRM
 * (`.nullable()`) and strict on the IDs we need for URNs.
 */

// =============================================================================
// Primitive enums
// =============================================================================

export const ICPTierSchema = z.enum(['A', 'B', 'C', 'D'])
export const PriorityTierSchema = z.enum(['HOT', 'WARM', 'COOL', 'MONITOR'])
export const SenioritySchema = z.enum([
  'c_level',
  'vp',
  'director',
  'manager',
  'individual',
])
export const ContactRoleSchema = z.enum([
  'champion',
  'economic_buyer',
  'technical_evaluator',
  'end_user',
  'blocker',
])
export const SignalTypeSchema = z.enum([
  'hiring_surge',
  'funding',
  'leadership_change',
  'expansion',
  'temp_job_posting',
  'competitor_mention',
  'seasonal_peak',
  'negative_news',
])
export const SignalUrgencySchema = z.enum([
  'immediate',
  'this_week',
  'this_month',
])
export const CRMTypeSchema = z.enum(['salesforce', 'hubspot'])

// =============================================================================
// Ontology objects — trimmed to the fields agents + UI actually use.
// =============================================================================

export const CompanyLocationSchema = z.object({
  city: z.string(),
  country: z.string(),
  state: z.string().optional(),
  is_hq: z.boolean().optional(),
})

/**
 * `CompanySchema` is the **agent-facing trimmed view** of the Company
 * ontology row. It covers the fields the LLM sees inside prompts and
 * structured outputs — name, scoring, ICP/priority tier, owner. The
 * full DB row has more fields (industry_group, employee_range,
 * urgency_multiplier, enrichment_*, churn_risk_*, parent_company_id,
 * etc.) — those land in `CompanyRowSchema` below for code paths that
 * read straight from Supabase.
 *
 * Use `CompanySchema` for: tool inputs, structured agent outputs.
 * Use `CompanyRowSchema` for: server-side row validation, JSON-blob
 * persistence, audit trails.
 */
export const CompanySchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  crm_id: z.string(),
  crm_source: CRMTypeSchema,

  name: z.string(),
  domain: z.string().nullable(),
  website: z.string().nullable(),

  industry: z.string().nullable(),
  employee_count: z.number().nullable(),
  annual_revenue: z.number().nullable(),

  hq_city: z.string().nullable(),
  hq_country: z.string().nullable(),
  locations: z.array(CompanyLocationSchema).default([]),
  tech_stack: z.array(z.string()).default([]),

  owner_crm_id: z.string().nullable(),
  owner_name: z.string().nullable(),

  icp_score: z.number().min(0).max(100),
  icp_tier: ICPTierSchema,
  signal_score: z.number(),
  engagement_score: z.number(),
  contact_coverage_score: z.number(),
  velocity_score: z.number(),
  win_rate_score: z.number(),
  propensity: z.number().min(0).max(100),
  expected_revenue: z.number(),
  priority_tier: PriorityTierSchema,
  priority_reason: z.string().nullable(),
})
export type CompanyParsed = z.infer<typeof CompanySchema>

/**
 * Full row schema — covers every column on the `companies` table after
 * migrations 001–009. Use this when validating raw rows from Supabase
 * before persisting back, so silent drift (a new column added but not
 * declared here) shows up as a schema-parse failure rather than as a
 * silent missing field at write time.
 */
export const CompanyRowSchema = CompanySchema.extend({
  industry_group: z.string().nullable().optional(),
  employee_range: z.string().nullable().optional(),
  revenue_range: z.string().nullable().optional(),
  founded_year: z.number().nullable().optional(),
  location_count: z.number().optional(),
  owner_email: z.string().nullable().optional(),
  urgency_multiplier: z.number().optional(),
  // Per-tenant adaptation surface: weights / dimensions snapshot at
  // last scoring run — JSONB blobs that pass through to /admin/adaptation.
  icp_dimensions: z.record(z.unknown()).optional(),
  enrichment_data: z.record(z.unknown()).optional(),
  enrichment_source: z.string().nullable().optional(),
  enriched_at: z.string().nullable().optional(),
  last_signal_check: z.string().nullable().optional(),
  icp_config_version: z.string().nullable().optional(),
  // Account hierarchy (migration 008)
  parent_company_id: z.string().nullable().optional(),
  parent_crm_id: z.string().nullable().optional(),
  is_account_family_root: z.boolean().optional(),
  // CSM / churn columns added in migration 001 schema extensions
  csm_crm_id: z.string().nullable().optional(),
  churn_risk_score: z.number().nullable().optional(),
  churn_risk_factors: z.record(z.unknown()).nullable().optional(),
  last_exec_engagement: z.string().nullable().optional(),
  last_activity_date: z.string().nullable().optional(),
  last_crm_sync: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})
export type CompanyRowParsed = z.infer<typeof CompanyRowSchema>

export const ContactSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  company_id: z.string(),
  crm_id: z.string().nullable(),
  email: z.string().nullable(),
  first_name: z.string(),
  last_name: z.string(),
  title: z.string().nullable(),
  seniority: SenioritySchema.nullable(),
  role_tag: ContactRoleSchema.nullable(),
  is_champion: z.boolean().default(false),
  is_decision_maker: z.boolean().default(false),
  is_economic_buyer: z.boolean().default(false),
  linkedin_url: z.string().nullable(),
})
export type ContactParsed = z.infer<typeof ContactSchema>

export const OpportunitySchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  crm_id: z.string(),
  company_id: z.string(),
  owner_crm_id: z.string().nullable(),
  name: z.string(),
  value: z.number().nullable(),
  currency: z.enum(['GBP', 'USD']),
  stage: z.string(),
  probability: z.number().min(0).max(100).nullable(),
  days_in_stage: z.number(),
  expected_close_date: z.string().nullable(),
  is_stalled: z.boolean().default(false),
  stall_reason: z.string().nullable(),
  is_closed: z.boolean().default(false),
  is_won: z.boolean().default(false),
})
export type OpportunityParsed = z.infer<typeof OpportunitySchema>

export const SignalSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  company_id: z.string(),
  signal_type: SignalTypeSchema,
  title: z.string(),
  description: z.string().nullable(),
  source_url: z.string().nullable(),
  relevance_score: z.number(),
  weighted_score: z.number(),
  urgency: SignalUrgencySchema,
  detected_at: z.string(),
})
export type SignalParsed = z.infer<typeof SignalSchema>

export const TranscriptSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  // `company_id` matches the column name in `transcripts` (migration 001)
  // and the field name in `Transcript` from `platform.ts`. The earlier
  // `account_id` here was a drift artefact — every consumer of the
  // schema had to remember to translate the field name.
  company_id: z.string().nullable(),
  source: z.enum(['gong', 'fireflies', 'otter']),
  source_id: z.string(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  themes: z.array(z.string()).default([]),
  sentiment_score: z.number().min(-1).max(1).nullable(),
  occurred_at: z.string(),
})
export type TranscriptParsed = z.infer<typeof TranscriptSchema>

// =============================================================================
// Structured outputs — what the agent emits via generateObject/streamObject.
// Each schema is designed to be both LLM-friendly (small, descriptive fields)
// and durable (every output carries citation URNs).
// =============================================================================

export const CitationSchema = z.object({
  claim_text: z.string().describe('One-sentence claim being cited'),
  source_type: z.string().describe('Ontology type: company, deal, transcript, signal, etc.'),
  source_id: z.string().nullable().describe('URN or id of the backing object'),
  source_url: z.string().nullable().describe('Deep-link to the source'),
  confidence: z.number().min(0).max(1).nullable(),
})
export type Citation = z.infer<typeof CitationSchema>

/**
 * PreCallBrief — the structured output for the pre-call brief workflow.
 * Every field must be citable or the agent should leave it empty.
 */
export const PreCallBriefSchema = z.object({
  company_name: z.string(),
  company_one_liner: z.string().max(240),
  icp_tier: ICPTierSchema,
  icp_score: z.number().min(0).max(100),
  meeting_context: z.string().describe('Why this meeting, what is the goal'),
  attendees: z.array(z.object({
    name: z.string(),
    title: z.string().nullable(),
    role_hint: ContactRoleSchema.nullable(),
  })),
  recent_signals: z.array(z.object({
    headline: z.string(),
    urgency: SignalUrgencySchema,
    source_url: z.string().nullable(),
  })),
  discovery_questions: z.array(z.string()).min(3).max(6),
  likely_objections: z.array(z.object({
    objection: z.string(),
    response: z.string(),
  })).max(4),
  similar_won_deal: z.object({
    company_name: z.string(),
    one_line_why: z.string(),
  }).nullable(),
  risks_to_flag: z.array(z.string()).max(3),
  citations: z.array(CitationSchema),
})
export type PreCallBrief = z.infer<typeof PreCallBriefSchema>

/**
 * Summariser output schema (Phase 3 T1.2).
 *
 * The transcript ingester (`packages/adapters/src/transcripts/transcript-ingester.ts`)
 * asks Anthropic to summarise raw transcript text and return a JSON
 * blob with `summary`, `themes`, `sentiment_score`, `meddpicc`. The
 * pre-T1.2 ingester used a loose `JSON.parse` + a permissive cast,
 * which meant a model that returned a malicious-shape response (e.g.
 * dumped a different schema, or returned a 50-page essay because a
 * meeting attendee told it to "ignore prior instructions") would
 * silently land in the ontology. From there it fed every subsequent
 * agent context.
 *
 * This schema is the second layer of the prompt-injection defence:
 * boundary-wrap the input (via `wrapUntrusted` from
 * `apps/web/src/lib/agent/safety/untrusted-wrapper.ts`) AND
 * shape-validate the output. On schema-mismatch the ingester records
 * `summarise_invalid_output` as an `agent_event` and persists
 * `summary = null` so downstream code keeps working but does not
 * propagate the malformed string.
 *
 * Field constraints intentionally LOOSE on values (we don't reject a
 * legitimate long summary from a 90-minute call) and STRICT on shape
 * (`themes` must be an array, `sentiment_score` must be a number in
 * [-1, 1] or null). The MEDDPICC sub-schema is reused via
 * `.passthrough()` because the ingester doesn't enforce MEDDPICC
 * letter-by-letter — a separate downstream tool pulls those fields.
 */
export const SummarizeResultSchema = z.object({
  // Hard cap at 4000 chars — the ingester only persists the first
  // ~500 anyway (`summary` column has no TEXT length cap, but a
  // 50-page model dump is itself a signal the call went wrong).
  summary: z.string().max(4000),
  themes: z.array(z.string().max(120)).max(20).default([]),
  sentiment_score: z.number().min(-1).max(1).nullable().default(null),
  // MEDDPICC extracted from the call. The ingester downstream of this
  // schema will run a stricter MeddpiccExtractionSchema parse before
  // anything cites the fields; here we only enforce "object or null".
  meddpicc: z.record(z.unknown()).nullable().default(null),
})
export type SummarizeResult = z.infer<typeof SummarizeResultSchema>

/**
 * MEDDPICC extraction from a transcript. Every field optional — models
 * shouldn't fabricate when the signal isn't in the call.
 */
export const MeddpiccExtractionSchema = z.object({
  metrics: z.string().nullable().describe('Quantifiable value the buyer cares about'),
  economic_buyer: z.string().nullable(),
  decision_criteria: z.array(z.string()).default([]),
  decision_process: z.string().nullable(),
  paper_process: z.string().nullable(),
  implications_of_pain: z.array(z.string()).default([]),
  champion: z.string().nullable(),
  competition: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  citations: z.array(CitationSchema),
})
export type MeddpiccExtraction = z.infer<typeof MeddpiccExtractionSchema>

/**
 * Theme summarisation output — for the CSM weekly portfolio digest and
 * the leadership objection digest.
 */
export const ThemeSummarySchema = z.object({
  themes: z.array(z.object({
    name: z.string(),
    summary: z.string(),
    frequency: z.number().int(),
    affected_urns: z.array(z.string()).describe('URNs of accounts/deals this theme touches'),
    sentiment: z.enum(['positive', 'neutral', 'negative']),
  })),
  portfolio_urn: z.string().nullable().describe('URN of the portfolio scope (rep, team, tenant)'),
  period_start: z.string(),
  period_end: z.string(),
  citations: z.array(CitationSchema),
})
export type ThemeSummary = z.infer<typeof ThemeSummarySchema>

/**
 * ProposedAction — what the Action Panel invokes. The agent returns one of
 * these when asked to act on an object; the client routes it through the
 * appropriate write-back adapter (CRM note, Slack DM, etc).
 */
export const ProposedActionSchema = z.object({
  action_id: z.string().describe('Slug like draft_outreach, write_crm_note, create_signal'),
  subject_urn: z.string().describe('Target object URN'),
  summary: z.string(),
  payload: z.record(z.unknown()).describe('Action-specific typed body'),
  requires_confirmation: z.boolean(),
  citations: z.array(CitationSchema),
})
export type ProposedAction = z.infer<typeof ProposedActionSchema>

/**
 * AccountHealthSnapshot — CSM portfolio scoring output. Feeds the health
 * column on the ontology browser and the churn-risk alert trigger.
 */
export const AccountHealthSnapshotSchema = z.object({
  company_urn: z.string(),
  overall_health: z.enum(['green', 'amber', 'red']),
  churn_risk_score: z.number().min(0).max(100),
  key_risks: z.array(z.object({
    label: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
    evidence: z.string(),
  })),
  recent_wins: z.array(z.string()).max(3),
  recommended_next_action: z.string(),
  citations: z.array(CitationSchema),
})
export type AccountHealthSnapshotOutput = z.infer<typeof AccountHealthSnapshotSchema>

/**
 * ImprovementReportProposal — output of the nightly selfImproveWorkflow
 * meta-agent. Proposes fixes the engineering team can approve.
 */
export const ImprovementReportProposalSchema = z.object({
  cluster_label: z.string(),
  cluster_size: z.number().int(),
  root_cause: z.string(),
  proposed_fixes: z.array(z.object({
    kind: z.enum(['prompt_diff', 'new_tool', 'tool_tweak', 'data_gap', 'threshold_change']),
    description: z.string(),
    expected_lift: z.string().nullable(),
  })),
  affected_interactions: z.array(z.string()).describe('UUID list of example interactions'),
})
export type ImprovementReportProposal = z.infer<typeof ImprovementReportProposalSchema>
