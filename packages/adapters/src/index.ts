export type { CRMAdapter, AccountFilters, OpportunityFilters, ScorePayload, OpportunityFlags, ChangeSet } from './crm/interface'
export { SalesforceAdapter } from './crm/salesforce'
export { HubSpotAdapter } from './crm/hubspot'

export type { EnrichmentProvider } from './enrichment/interface'
export { ApolloAdapter } from './enrichment/apollo'
export { normalizeIndustry } from './enrichment/normalizers/industry-map'
export { resolveLocationsInRegions, isInCountry } from './enrichment/normalizers/location-resolver'

export type { NotificationAdapter } from './notifications/interface'
export { SlackAdapter } from './notifications/slack'
export { SlackDispatcher } from './notifications/slack-dispatcher'
export type {
  PreCallBriefParams,
  WeeklyDigestParams,
  LeadershipDigestParams,
  AlertParams,
  EscalationParams,
  CooldownOptions,
  PushBudgetOptions,
  DispatchResult,
} from './notifications/slack-dispatcher'
export {
  SupabaseCooldownStore,
  InMemoryCooldownStore,
} from './notifications/cooldown-store'
export type { CooldownStore } from './notifications/cooldown-store'
export {
  checkPushBudget,
  recordPushSent,
} from './notifications/push-budget'
export type { AlertFrequency, PushBudgetCheck } from './notifications/push-budget'
export { WebPushAdapter } from './notifications/web-push'

export type {
  ConnectorInterface,
  ConnectorHealth,
  ConnectorQuery,
  QueryFilter,
  ConnectorResult,
  SyncOptions,
  SyncResult,
  SyncError,
} from './connectors/interface'
export { ConnectorRegistry } from './connectors/interface'

// Single canonical transcript stack — see @prospector/adapters/transcripts.
// The legacy `TranscriptConnector` (under connectors/) was removed in B9.
// `TranscriptIngester.searchSimilar(query, { companyId, limit })` replaces
// the standalone `searchTranscripts` helper.
export { TranscriptIngester } from './transcripts'
export type {
  TranscriptWebhookPayload,
  TranscriptSearchResult,
} from './transcripts'
