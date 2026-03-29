// Types
export * from './types/ontology'
export * from './types/config'
export * from './types/scoring'
export * from './types/enrichment'
export * from './types/notifications'
export * from './types/agent'

// Scoring Engine
export { computeICPScore } from './scoring/icp-scorer'
export type { ICPScorerInput } from './scoring/icp-scorer'
export { matchScoringTier } from './scoring/tier-matcher'
export type { TierMatchContext } from './scoring/tier-matcher'
export { computeSignalMomentum } from './scoring/signal-scorer'
export type { SignalScorerInput } from './scoring/signal-scorer'
export { computeEngagementDepth } from './scoring/engagement-scorer'
export type { EngagementScorerInput } from './scoring/engagement-scorer'
export { computeContactCoverage } from './scoring/contact-coverage-scorer'
export { computeStageVelocity } from './scoring/velocity-scorer'
export type { VelocityScorerInput } from './scoring/velocity-scorer'
export { computeProfileWinRate } from './scoring/win-rate-scorer'
export type { WinRateScorerInput } from './scoring/win-rate-scorer'
export { computePropensity } from './scoring/propensity-scorer'
export { computeExpectedRevenue } from './scoring/expected-revenue'
export type { ExpectedRevenueInput, ExpectedRevenueResult } from './scoring/expected-revenue'
export { computeCompositeScore } from './scoring/composite-scorer'
export type { CompositeScoreInput, CompositeScoreResult, CompositeScoreConfig, HistoricalDealOutcome } from './scoring/composite-scorer'

// Calibration / Learning
export { analyzeCalibration, shouldAutoApply } from './scoring/calibration-analyzer'
export type { CalibrationResult, DealOutcomeRecord, DimensionAnalysis } from './scoring/calibration-analyzer'

// Funnel Engine
export { computeBenchmarks } from './funnel/benchmark-engine'
export type { BenchmarkInput } from './funnel/benchmark-engine'
export { detectStalls } from './funnel/stall-detector'
export type { StallDetectionResult } from './funnel/stall-detector'
export { computeImpactScores } from './funnel/impact-scorer'
export type { StageStatus, ImpactScoreResult } from './funnel/impact-scorer'
export { computeForecast } from './funnel/forecast'
export type { ForecastInput, ForecastResult } from './funnel/forecast'

// Prioritisation Engine
export { buildQueue } from './prioritisation/queue-builder'
export type { QueueType, QueueInput } from './prioritisation/queue-builder'
export { generateNextBestAction } from './prioritisation/action-generator'
export { assembleDailyBriefing } from './prioritisation/briefing-assembler'
export type { BriefingInput } from './prioritisation/briefing-assembler'

// Relationship Intelligence
export { detectRelationshipEvents } from './relationships/event-detector'
export type { RelationshipEventInput } from './relationships/event-detector'

// Notification Engine
export { evaluateTriggers } from './notifications/trigger-engine'
export type { TriggerEvaluationInput, TriggerConfig } from './notifications/trigger-engine'
export { CooldownManager, TRIGGER_COOLDOWNS } from './notifications/cooldown-manager'
export { aggregateFeedback, shouldDisableTrigger, shouldRaiseThreshold } from './notifications/feedback-tracker'
export type { FeedbackSummary } from './notifications/feedback-tracker'
