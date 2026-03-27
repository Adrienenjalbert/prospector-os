import type { DimensionResult, PriorityTier, ICPTier } from './ontology'

export interface ScoringResult {
  score: number
  tier?: string
  dimensions: DimensionResult[]
  top_reason: string
  computed_at: string
  config_version: string
}

export interface SubScoreSet {
  icp_fit: number
  signal_momentum: number
  engagement_depth: number
  contact_coverage: number
  stage_velocity: number
  profile_win_rate: number
}

export interface PriorityResult {
  expected_revenue: number
  deal_value: number
  propensity: number
  urgency_multiplier: number
  priority_tier: PriorityTier
  priority_reason: string
  sub_scores: {
    icp_fit: ScoringResult
    signal_momentum: ScoringResult
    engagement_depth: ScoringResult
    contact_coverage: ScoringResult
    stage_velocity: ScoringResult
    profile_win_rate: ScoringResult
  }
}

export interface ScoringSnapshot {
  id: string
  tenant_id: string
  company_id: string
  opportunity_id: string | null

  icp_fit: number
  signal_momentum: number
  engagement_depth: number
  contact_coverage: number
  stage_velocity: number
  profile_win_rate: number
  propensity: number
  deal_value: number
  expected_revenue: number

  snapshot_trigger: SnapshotTrigger
  config_version: string
  created_at: string
}

export type SnapshotTrigger =
  | 'deal_created'
  | 'stage_change'
  | 'weekly'
  | 'deal_closed'

export interface UrgencyComponents {
  immediate_signal: boolean
  close_date_within_30d: boolean
  competitive_pressure: boolean
  signal_surge: boolean
  stall_going_dark: boolean
}

export interface TierMatchResult {
  score: number
  label: string
  matched_condition: string
}

export interface RecalibrationReport {
  period: string
  overall_auc: number
  dimension_analysis: {
    dimension: string
    current_weight: number
    suggested_weight: number
    finding: string
    correlation: number
  }[]
  sample_size: number
  generated_at: string
}

export interface DealValueEstimate {
  value: number
  source: 'actual_opportunity' | 'historical_tier_average' | 'fallback_config'
  icp_tier?: ICPTier
}
