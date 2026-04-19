// Types
export * from './types/ontology'
export * from './types/urn'
export * from './types/schemas'
export * from './types/config'
export * from './types/scoring'
export * from './types/enrichment'
export * from './types/notifications'
export * from './types/agent'
export * from './types/platform'

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

// Citation Engine
export { CitationCollector, extractCitationsFromToolResult, formatCitationFooter } from './citations'
export type { PendingCitation, CitationConfig } from './citations'

// Admin audit log — Phase 3 T2.1. Append-only record of every admin
// write to a tenant config or proposal. Lives in `admin_audit_log`
// (migration 011). Failures are warn-and-continue (audit is
// load-bearing for trust, not for correctness).
//
// NOTE: T2.3 (this branch) and T2.1 (PR #6) both add this export.
// When T2.1 merges first, this is a no-op redundancy that the merge
// will deduplicate; if T2.3 merges first, T2.1's PR conflict is a
// trivial accept-yours.
export {
  recordAdminAction,
  AUDIT_MAX_JSONB_BYTES,
} from './audit'
export type {
  AdminActionSlug,
  AdminAuditInput,
} from './audit'

// Business skills (Phase 7 — modular business_profiles replacement)
export {
  loadActiveBusinessSkills,
  composeSkillsForPrompt,
  promoteBusinessSkill,
} from './business-skills'
export type {
  BusinessSkillType,
  BusinessSkillRow,
  ActiveBusinessSkills,
} from './business-skills'

// Telemetry (event sourcing for self-improvement loop)
export {
  emitAgentEvent,
  emitOutcomeEvent,
  emitAgentEvents,
} from './telemetry'
export type {
  AgentEventType,
  OutcomeEventType,
  AgentEventInput,
  OutcomeEventInput,
} from './telemetry'

// Notification Engine — production cooldown/dispatch lives in
// `@prospector/adapters/notifications/slack-dispatcher` +
// `SupabaseCooldownStore`. The legacy in-memory CooldownManager,
// trigger-engine, and feedback-tracker were removed in B10 because nothing
// in app code consumed them. Notification *types* (TriggerType,
// NotificationAdapter, etc.) remain in `./types/notifications`.
