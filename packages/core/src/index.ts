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

// Safety — Phase 3 T1.2 prompt-injection defence at trust boundaries.
// `wrapUntrusted` wraps any string from an untrusted source (transcript
// raw_text, CRM free-text, conversation note) in a stable marker the
// agent's behaviour rule teaches it to treat as data only. Used at the
// transcript ingest boundary, search_transcripts tool result, and the
// conversation-memory slice. See `commonBehaviourRules()` in
// `apps/web/src/lib/agent/agents/_shared.ts` for the model-side
// counterpart.
export {
  wrapUntrusted,
  wrapUntrustedFields,
  UNTRUSTED_OPEN_MARKER,
  UNTRUSTED_CLOSE_MARKER,
  UNTRUSTED_MAX_SOURCE_LABEL_LEN,
} from './safety/untrusted-wrapper'
