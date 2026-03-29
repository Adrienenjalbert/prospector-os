export interface Company {
  id: string
  tenant_id: string
  crm_id: string
  crm_source: 'salesforce' | 'hubspot'

  name: string
  domain: string | null
  website: string | null

  industry: string | null
  industry_group: string | null
  employee_count: number | null
  employee_range: string | null
  annual_revenue: number | null
  revenue_range: string | null
  founded_year: number | null

  hq_city: string | null
  hq_country: string | null
  location_count: number
  locations: CompanyLocation[]

  tech_stack: string[]

  owner_crm_id: string | null
  owner_name: string | null
  owner_email: string | null

  icp_score: number
  icp_tier: ICPTier
  icp_dimensions: Record<string, DimensionResult>
  signal_score: number
  engagement_score: number
  contact_coverage_score: number
  velocity_score: number
  win_rate_score: number
  propensity: number
  expected_revenue: number
  priority_tier: PriorityTier
  priority_reason: string | null
  urgency_multiplier: number

  enriched_at: string | null
  enrichment_source: string | null
  enrichment_data: Record<string, unknown>
  last_signal_check: string | null
  icp_config_version: string | null

  created_at: string
  updated_at: string
  last_activity_date: string | null
  last_crm_sync: string
}

export interface CompanyLocation {
  city: string
  country: string
  state?: string
  is_hq?: boolean
}

export interface Contact {
  id: string
  tenant_id: string
  company_id: string
  crm_id: string | null
  apollo_id: string | null

  email: string | null
  first_name: string
  last_name: string
  title: string | null
  seniority: Seniority | null
  department: string | null
  phone: string | null
  linkedin_url: string | null

  engagement_score: number
  relevance_score: number

  is_champion: boolean
  is_decision_maker: boolean
  is_economic_buyer: boolean
  role_tag: ContactRole | null

  birthday: string | null
  work_anniversary: string | null
  timezone: string | null
  location_city: string | null
  photo_url: string | null
  twitter_url: string | null
  personal_interests: string[]
  communication_preference: string | null
  preferred_contact_time: string | null
  alma_mater: string | null
  previous_companies: string[]
  years_in_role: number | null

  last_activity_date: string | null
  enriched_at: string | null
  created_at: string
}

export type Seniority = 'c_level' | 'vp' | 'director' | 'manager' | 'individual'

export type ContactRole =
  | 'champion'
  | 'economic_buyer'
  | 'technical_evaluator'
  | 'end_user'
  | 'blocker'

export interface Signal {
  id: string
  tenant_id: string
  company_id: string

  signal_type: SignalType
  title: string
  description: string | null
  source_url: string | null
  source: string

  relevance_score: number
  weight_multiplier: number
  recency_days: number
  weighted_score: number

  recommended_action: string | null
  urgency: SignalUrgency

  detected_at: string
  expires_at: string | null
  created_at: string
}

export type SignalType =
  | 'hiring_surge'
  | 'funding'
  | 'leadership_change'
  | 'expansion'
  | 'temp_job_posting'
  | 'competitor_mention'
  | 'seasonal_peak'
  | 'negative_news'

export type SignalUrgency = 'immediate' | 'this_week' | 'this_month'

export interface Opportunity {
  id: string
  tenant_id: string
  crm_id: string
  company_id: string
  owner_crm_id: string | null

  name: string
  value: number | null
  currency: 'GBP' | 'USD'
  stage: string
  stage_order: number
  probability: number | null

  days_in_stage: number
  stage_entered_at: string | null
  expected_close_date: string | null

  is_stalled: boolean
  stall_reason: string | null
  next_best_action: string | null

  is_closed: boolean
  is_won: boolean
  closed_at: string | null
  lost_reason: string | null

  win_probability_ai: number | null

  created_at: string
  updated_at: string
  last_crm_sync: string
}

export interface FunnelBenchmark {
  id: string
  tenant_id: string
  stage_name: string
  period: string
  scope: BenchmarkScope
  scope_id: string

  conversion_rate: number
  drop_rate: number

  deal_count: number
  total_value: number
  avg_deal_value: number

  avg_days_in_stage: number
  median_days_in_stage: number

  impact_score: number
  stall_count: number
  stall_value: number

  computed_at: string
}

export type BenchmarkScope = 'company' | 'team_uk' | 'team_us' | 'rep'

export interface RepProfile {
  id: string
  tenant_id: string
  user_id: string | null
  crm_id: string
  name: string
  email: string | null
  slack_user_id: string | null

  market: 'uk' | 'us'
  team: string | null

  comm_style: CommStyle
  alert_frequency: AlertFrequency
  focus_stage: string | null
  outreach_tone: OutreachTone

  kpi_meetings_monthly: number | null
  kpi_proposals_monthly: number | null
  kpi_pipeline_value: number | null
  kpi_win_rate: number | null

  active: boolean
  created_at: string
  updated_at: string
}

export type CommStyle = 'formal' | 'casual' | 'brief'
export type AlertFrequency = 'high' | 'medium' | 'low'
export type OutreachTone = 'professional' | 'consultative' | 'direct'

export type ICPTier = 'A' | 'B' | 'C' | 'D'
export type PriorityTier = 'HOT' | 'WARM' | 'COOL' | 'MONITOR'

export interface DimensionResult {
  name: string
  score: number
  weight: number
  weighted_score: number
  label: string
}

export interface Tenant {
  id: string
  name: string
  slug: string
  domain: string | null

  crm_type: 'salesforce' | 'hubspot'

  enrichment_providers: string[]
  enrichment_budget_monthly: number
  enrichment_spend_current: number

  ai_provider: string
  ai_token_budget_monthly: number
  ai_tokens_used_current: number

  icp_config: unknown
  funnel_config: unknown
  signal_config: unknown
  scoring_config: unknown
  business_config: unknown

  active: boolean
  onboarded_at: string | null
  created_at: string
  updated_at: string
}

export interface UserProfile {
  id: string
  tenant_id: string
  email: string
  full_name: string
  role: UserRole
  rep_profile_id: string | null
  created_at: string
}

export type UserRole = 'rep' | 'manager' | 'admin' | 'revops'

export interface CRMActivity {
  id: string
  type: ActivityType
  contact_id: string | null
  account_id: string
  subject: string | null
  duration_minutes: number | null
  occurred_at: string
}

export type ActivityType =
  | 'proposal_sent'
  | 'meeting_multi_party'
  | 'meeting_one_on_one'
  | 'call_connected'
  | 'call_attempted'
  | 'email_reply_received'
  | 'email_opened_multiple'
  | 'email_opened_once'
