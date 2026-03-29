import type { PriorityTier, SignalType, SignalUrgency } from './ontology'

export interface TriggerDefinition {
  type: TriggerType
  condition: TriggerCondition
  cooldown_days: number
  priority: 'high' | 'medium' | 'low' | 'routine'
  channel: NotificationChannel
}

export type TriggerType =
  | 'deal_stall'
  | 'signal_detected'
  | 'priority_shift'
  | 'funnel_gap'
  | 'win_loss_insight'
  | 'daily_briefing'
  | 'relationship_touch'

export interface TriggerCondition {
  field: string
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'changed_by'
  value: number | string | boolean
}

export type NotificationChannel = 'slack_dm' | 'web_push' | 'slack_channel'

export interface TriggerEvent {
  id: string
  tenant_id: string
  trigger_type: TriggerType
  rep_id: string
  company_id: string | null
  opportunity_id: string | null

  payload: TriggerPayload
  created_at: string
}

export type TriggerPayload =
  | StallTriggerPayload
  | SignalTriggerPayload
  | PriorityShiftPayload
  | FunnelGapPayload
  | DailyBriefingPayload
  | RelationshipTouchPayload

export interface StallTriggerPayload {
  type: 'deal_stall'
  deal_name: string
  stage: string
  days_in_stage: number
  median_days: number
  stall_reason: string
  last_activity_date: string | null
}

export interface SignalTriggerPayload {
  type: 'signal_detected'
  signal_type: SignalType
  signal_title: string
  relevance_score: number
  urgency: SignalUrgency
  company_name: string
}

export interface PriorityShiftPayload {
  type: 'priority_shift'
  previous_tier: PriorityTier
  new_tier: PriorityTier
  score_change: number
  reason: string
}

export interface FunnelGapPayload {
  type: 'funnel_gap'
  stage: string
  rep_drop_rate: number
  benchmark_drop_rate: number
  delta: number
  deal_count: number
  value_at_risk: number
}

export interface DailyBriefingPayload {
  type: 'daily_briefing'
  top_actions: BriefingAction[]
  stall_count: number
  signal_count: number
  pipeline_value: number
}

export interface BriefingAction {
  account_name: string
  account_id: string
  reason: string
  action: string
  severity: 'critical' | 'high' | 'medium' | 'low'
}

export interface RelationshipTouchPayload {
  type: 'relationship_touch'
  event_type: string
  contact_name: string
  company_name: string
  event_date: string
  days_until: number
  suggested_action: string
  personal_context: string | null
}

export interface NotificationRecord {
  id: string
  tenant_id: string
  user_id: string
  trigger_event_id: string | null

  title: string
  body: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  channel: NotificationChannel

  account_id: string | null
  opportunity_id: string | null
  action_url: string | null

  read: boolean
  read_at: string | null
  acted_on: boolean

  created_at: string
}

export interface AlertFeedback {
  id: string
  tenant_id: string
  rep_crm_id: string
  alert_type: TriggerType
  company_id: string | null
  reaction: 'positive' | 'negative' | 'ignored'
  action_taken: boolean
  feedback_reason: string | null
  created_at: string
}

export interface CooldownEntry {
  trigger_type: TriggerType
  entity_id: string
  rep_id: string
  last_fired_at: string
  cooldown_days: number
}

export interface NotificationAdapter {
  send(notification: NotificationRecord, recipient: NotificationRecipient): Promise<void>
  sendBulk(notifications: NotificationRecord[], recipients: NotificationRecipient[]): Promise<void>
}

export interface NotificationRecipient {
  user_id: string
  slack_user_id?: string
  email?: string
}
