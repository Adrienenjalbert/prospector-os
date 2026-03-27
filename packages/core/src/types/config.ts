export interface ICPConfig {
  version: string
  business: string
  dimensions: ICPDimension[]
  tier_thresholds: Record<string, number>
  recalibration: RecalibrationConfig
}

export interface ICPDimension {
  name: string
  weight: number
  description: string
  data_source: string
  scoring_tiers: ScoringTier[]
  disqualify_below?: number
  operating_regions?: Record<string, string[]>
}

export interface ScoringTier {
  condition: TierCondition
  score: number
  label: string
  values?: string[]
  min?: number
  max?: number
  min_count?: number
}

export type TierCondition =
  | 'in'
  | 'between'
  | 'uses_any'
  | 'locations_in_operating_regions'
  | 'active_temp_postings'
  | 'hq_in_country'
  | 'historical_temp_postings'
  | 'high_turnover_industry'
  | 'default'

export interface ScoringConfig {
  version: string
  propensity_weights: PropensityWeights
  icp_tier_thresholds: Record<string, number>
  priority_tiers: Record<string, { min_propensity: number }>

  deal_value_estimation: {
    method: string
    fallback_values: Record<string, number>
    currency: string
  }

  urgency_config: {
    immediate_signal_bonus: number
    close_date_30d_bonus: number
    competitive_pressure_bonus: number
    signal_surge_bonus: number
    stall_going_dark_penalty: number
    max_multiplier: number
    min_multiplier: number
  }

  contact_coverage: ContactCoverageConfig
  engagement_activity_points: Record<string, number>
  engagement_recency: EngagementRecencyTier[]
  velocity_ratio_tiers: VelocityTier[]

  profile_match: {
    dimensions: string[]
    lookback_months: number
    blend_threshold: number
    value_tiers: ValueTier[]
  }

  recalibration: RecalibrationConfig
}

export interface PropensityWeights {
  icp_fit: number
  signal_momentum: number
  engagement_depth: number
  contact_coverage: number
  stage_velocity: number
  profile_win_rate: number
}

export interface ContactCoverageConfig {
  breadth_tiers: { min_contacts: number; score: number; label: string }[]
  seniority_points: Record<string, number>
  key_roles: {
    role: string
    identified_pts: number
    engaged_pts: number
  }[]
  champion_engaged_bonus: number
  economic_buyer_engaged_bonus: number
}

export interface EngagementRecencyTier {
  max_days: number
  score: number
}

export interface VelocityTier {
  min_ratio: number
  score: number
  label: string
}

export interface ValueTier {
  name: string
  min: number
}

export interface RecalibrationConfig {
  frequency_days: number
  min_closed_deals?: number
  min_sample_size?: number
  method: string
  auto_apply?: boolean
  notify_revops?: boolean
  metrics_to_track?: string[]
}

export interface SignalConfig {
  version: string
  business: string
  signal_types: SignalTypeConfig[]
  recency_decay: {
    formula: string
    description: string
  }
  composite_signal_score: {
    formula: string
    max_signals_per_company: number
    description: string
  }
  deep_research_config: {
    model: string
    temperature: number
    max_tokens: number
    only_for_tiers: string[]
  }
}

export interface SignalTypeConfig {
  name: string
  display_name: string
  description: string
  source: string
  weight_multiplier: number
  recency_decay_days: number
  min_relevance_threshold: number
  urgency_default: string
  enrichment_depth: 'standard' | 'deep'
}

export interface FunnelConfig {
  version: string
  business: string
  stages: FunnelStageConfig[]
  benchmark_config: {
    rolling_window_days: number
    refresh_frequency: string
    min_deals_for_valid_benchmark: number
    scopes: string[]
    drift_alert_threshold_points: number
    drift_alert_window_weeks: number
  }
  stall_config: {
    default_multiplier: number
    alert_cooldown_days: number
    escalation_multiplier: number
    escalation_action: string
  }
  impact_score: {
    formula: string
    description: string
  }
  drop_volume_matrix: Record<string, { label: string; action: string }>
}

export interface FunnelStageConfig {
  name: string
  order: number
  crm_field_value: string
  stage_type: string
  expected_velocity_days: number | null
  stall_multiplier: number | null
  description: string
}
