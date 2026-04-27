export type { CRMAdapter, AccountFilters, OpportunityFilters, ScorePayload, OpportunityFlags, ChangeSet } from './crm/interface'
export { SalesforceAdapter } from './crm/salesforce'
export { HubSpotAdapter } from './crm/hubspot'

export type { EnrichmentProvider } from './enrichment/interface'
export { ApolloAdapter } from './enrichment/apollo'
export type { EnrichCompanyOutcome } from './enrichment/apollo'
export { normalizeIndustry } from './enrichment/normalizers/industry-map'
export { resolveLocationsInRegions, isInCountry } from './enrichment/normalizers/location-resolver'
export {
  ENRICHMENT_COSTS,
  totalSpend,
  addCost,
  canAfford,
} from './enrichment/cost'
export type { EnrichmentOperation } from './enrichment/cost'

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
  SlackBlock,
  SlackBlockMessage,
  SlackMessage,
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
  TranscriptIngesterOptions,
} from './transcripts'

// C5.1 — five additional embedding pipelines (companies, signals,
// notes, exemplars, framework chunks). All use OpenAI
// text-embedding-3-small via the same generic embedder. Drives the
// new RAG slices wired into the agent runtime in C5.2.
//
// Phase 6 (Two-Level Second Brain) adds two more pipelines —
// runMemoriesEmbedder (atoms) and runWikiPagesEmbedder (compiled
// pages) — both using the same content-hash idempotency pattern.
export {
  runCompaniesEmbedder,
  runSignalsEmbedder,
  runNotesEmbedder,
  runExemplarsEmbedder,
  runFrameworksEmbedder,
  runMemoriesEmbedder,
  runWikiPagesEmbedder,
} from './embeddings'
export type { EmbedderResult } from './embeddings'

// Phase 7 (Composite Triggers + Relationship Graph + Pluggable
// Enrichment) adapters. Each interface is a typed contract; the
// reference impl is the only one wired to a vendor today, the
// stubs ship the interface so the signals cron can compose them
// uniformly when a customer brings paid keys.
export type {
  IntentDataAdapter,
  IntentSignalRow,
  IntentAdapterCapabilities,
  FetchIntentOpts,
} from './intent/interface'
export { TavilyNewsAdapter } from './intent/tavily-news'
export { BomboraAdapter } from './intent/bombora'

export type {
  TechStackAdapter,
  TechStackChangeRow,
  TechStackAdapterCapabilities,
  FetchTechStackChangesOpts,
} from './tech-stack/interface'
export { BuiltWithAdapter } from './tech-stack/builtwith'

export type {
  JobChangeAdapter,
  JobChangeRow,
  JobChangeAdapterCapabilities,
  FetchJobChangesOpts,
} from './job-change/interface'
export { ApolloJobChangeAdapter } from './job-change/apollo'
export { LinkedInSalesNavAdapter } from './job-change/linkedin-sn'
