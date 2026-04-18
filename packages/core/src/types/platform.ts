// ── Context strategy for role-based agent behavior ──

export type ContextStrategy =
  | 'rep_centric'
  | 'account_centric'
  | 'portfolio_centric'
  | 'team_centric'

// ── Tool taxonomy ──

export type ToolCategory = 'data_query' | 'action' | 'analysis' | 'generation'

export type ToolType = 'builtin' | 'api' | 'supabase_query' | 'mcp'

// ── Connector taxonomy ──

export type ConnectorType =
  | 'crm'
  | 'analytics'
  | 'transcripts'
  | 'tickets'
  | 'enrichment'
  | 'notifications'
  | 'custom'

export type AuthType = 'api_key' | 'oauth2' | 'bearer_token' | 'basic'

export type ConnectorStatus = 'pending' | 'connected' | 'error' | 'disabled'

// ── JSONB sub-types ──

export interface ValueProposition {
  prop: string
  when_to_use: string
}

export interface OperatingRegion {
  region: string
  cities: string[]
}

export interface TranscriptParticipant {
  name: string
  email: string
  company: string
}

export interface RoleDefinition {
  slug: string
  label: string
  description: string
  context_strategy: ContextStrategy
  prompt_template: string
  default_tools: string[]
}

// ── Execution config variants ──

export interface BuiltinConfig {
  handler: string
}

export interface ApiConfig {
  url: string
  method: string
  headers?: Record<string, string>
  body_template?: Record<string, unknown>
  auth_connector_id?: string
}

export interface QueryFilter {
  column: string
  operator: string
  value_param: string
}

export interface SupabaseQueryConfig {
  table: string
  select: string
  filters: QueryFilter[]
}

export interface McpConfig {
  server: string
  tool_name: string
}

export interface CitationConfig {
  source_type: string
  url_template?: string
  id_field?: string
}

// ── Business Profiles ──

export interface BusinessProfile {
  id: string
  tenant_id: string

  company_name: string
  company_description: string | null
  industry_context: string | null
  target_industries: string[]
  ideal_customer_description: string | null
  value_propositions: ValueProposition[]
  operating_regions: OperatingRegion[]

  /**
   * Common buyer objections + the recommended counter for each. Sourced
   * from the `business_skills.objection_handlers` row when present and
   * overlaid by `loadBusinessProfile`. Surfaced in the system prompt so
   * the agent can quote the tenant's actual playbook ("when prospect
   * says price, lead with X") instead of generic objection handling.
   * Optional for backwards compatibility — tenants who haven't set them
   * up just get no section.
   */
  objection_handlers?: Array<{ objection: string; response: string }>

  agent_name: string
  agent_mission: string | null
  brand_voice: string | null

  role_definitions: RoleDefinition[]

  created_at: string
  updated_at: string
}

// ── Tool Registry ──

export interface ToolDefinition {
  id: string
  tenant_id: string

  slug: string
  display_name: string
  description: string
  category: ToolCategory

  tool_type: ToolType
  execution_config: BuiltinConfig | ApiConfig | SupabaseQueryConfig | McpConfig

  parameters_schema: Record<string, unknown>

  response_mapping: Record<string, unknown> | null
  citation_config: CitationConfig | null

  available_to_roles: string[]
  requires_connector_id: string | null

  enabled: boolean
  is_builtin: boolean

  created_at: string
  updated_at: string
}

// ── Connector Registry ──

export interface ConnectorDefinition {
  id: string
  tenant_id: string

  connector_type: ConnectorType
  provider: string
  display_name: string

  auth_type: AuthType
  credentials_encrypted: Record<string, unknown> | null

  field_mapping: Record<string, string> | null

  sync_enabled: boolean
  sync_frequency: string | null
  sync_config: Record<string, unknown> | null
  last_sync_at: string | null
  last_sync_status: string | null

  status: ConnectorStatus
  last_health_check: string | null
  error_message: string | null

  created_at: string
  updated_at: string
}

// ── Transcripts ──

export interface Transcript {
  id: string
  tenant_id: string
  source: string
  source_id: string
  company_id: string | null
  opportunity_id: string | null
  rep_crm_id: string | null

  call_type: string | null
  occurred_at: string
  duration_minutes: number | null

  participants: TranscriptParticipant[]

  raw_text: string | null
  summary: string | null
  themes: string[]
  sentiment_score: number | null

  meddpicc_extracted: Record<string, unknown> | null

  source_url: string | null
  created_at: string
}

// ── Tickets ──

export interface Ticket {
  id: string
  tenant_id: string
  source: string
  source_id: string
  company_id: string

  subject: string | null
  description: string | null
  priority: string | null
  status: string | null
  sentiment_score: number | null

  opened_at: string | null
  resolved_at: string | null
  age_days: number | null

  created_at: string
}

// ── Account Health Snapshots ──

export interface AccountHealthSnapshot {
  id: string
  tenant_id: string
  company_id: string
  snapshot_date: string

  churn_risk_score: number | null
  risk_factors: Record<string, unknown> | null
  fulfillment_rate: number | null
  ticket_volume_7d: number | null
  sentiment_7d: number | null
  last_exec_contact_days: number | null

  computed_at: string
}

// ── Agent Citations ──

export interface AgentCitation {
  id: string
  tenant_id: string
  interaction_id: string | null

  claim_text: string
  source_type: string | null
  source_id: string | null
  source_url: string | null
  confidence: number | null

  created_at: string
}
