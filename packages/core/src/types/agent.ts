import type {
  Company,
  Contact,
  Signal,
  Opportunity,
  FunnelBenchmark,
  RepProfile,
  PriorityTier,
} from './ontology'

export interface AgentContext {
  rep_profile: RepProfile

  priority_accounts: PriorityAccountSummary[]
  funnel_comparison: FunnelComparison[]
  stalled_deals: StalledDealSummary[]
  recent_signals: SignalSummary[]
  company_benchmarks: FunnelBenchmark[]

  current_page: string | null
  current_account: Company | null
  current_deal: Opportunity | null
}

export interface PriorityAccountSummary {
  id: string
  name: string
  expected_revenue: number
  propensity: number
  priority_tier: PriorityTier
  priority_reason: string | null
  icp_tier: string
  deal_value: number | null
  stage: string | null
  days_in_stage: number | null
  is_stalled: boolean
  signal_count: number
  top_signal: string | null
  contact_count: number
}

export interface FunnelComparison {
  stage: string
  rep_conv: number
  rep_drop: number
  rep_deals: number
  rep_avg_days: number
  bench_conv: number
  bench_drop: number
  delta_conv: number
  delta_drop: number
  impact_score: number
  stall_count: number
  status: 'CRITICAL' | 'MONITOR' | 'OPPORTUNITY' | 'HEALTHY' | 'UNKNOWN'
}

export interface StalledDealSummary {
  id: string
  name: string
  company_name: string
  company_id: string
  stage: string
  value: number | null
  days_in_stage: number
  median_days: number
  stall_reason: string | null
  last_activity_date: string | null
}

export interface SignalSummary {
  id: string
  company_id: string
  company_name: string
  signal_type: string
  title: string
  urgency: string
  relevance_score: number
  detected_at: string
}

export interface PageContext {
  page: string
  accountId?: string
  dealId?: string
}

export interface ConversationThread {
  id: string
  tenant_id: string
  user_id: string
  thread_type: ThreadType
  thread_entity_id: string | null
  messages: ConversationMessage[]
  message_count: number
  total_tokens_used: number
  created_at: string
  updated_at: string
}

export type ThreadType = 'general' | 'account' | 'deal'

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  tool_calls?: ToolCallRecord[]
}

export interface ToolCallRecord {
  tool_name: string
  arguments: Record<string, unknown>
  result: unknown
  duration_ms: number
}

export interface NextBestAction {
  action: string
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  channel: 'call' | 'email' | 'linkedin' | 'meeting'
  timing: string
  reasoning: string
}

export interface DailyBriefing {
  rep_id: string
  date: string
  greeting: string
  top_actions: BriefingItem[]
  stalled_deals: StalledDealSummary[]
  new_signals: SignalSummary[]
  funnel_snapshot: FunnelComparison[]
  pipeline_summary: {
    total_value: number
    expected_value: number
    deal_count: number
    hot_count: number
    stall_count: number
  }
}

export interface BriefingItem {
  rank: number
  account_id: string
  account_name: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  trigger_type: string
  reason: string
  action: NextBestAction
  deal_value: number | null
  expected_revenue: number
}

export interface OutreachDraft {
  subject: string
  body: string
  follow_up_timing: string
  follow_up_subject: string | null
  personalization_notes: string
  angle: OutreachAngle
}

export type OutreachAngle =
  | 'consultative'
  | 'direct'
  | 'peer_reference'
  | 'problem_focused'
  | 'signal_response'

export interface DealHealthAssessment {
  health: 'strong' | 'on_track' | 'at_risk' | 'stalled' | 'critical'
  win_probability: number
  strengths: string[]
  risks: string[]
  missing_elements: string[]
  recommended_actions: NextBestAction[]
  similar_won: SimilarDeal[]
  similar_lost: SimilarDeal[]
}

export interface SimilarDeal {
  name: string
  value: number
  outcome: 'won' | 'lost'
  similarity_score: number
  key_factor: string
}
