export type { CRMAdapter, AccountFilters, OpportunityFilters, ScorePayload, OpportunityFlags, ChangeSet } from './crm/interface'
export { SalesforceAdapter } from './crm/salesforce'
export { HubSpotAdapter } from './crm/hubspot'

export type { EnrichmentProvider } from './enrichment/interface'
export { ApolloAdapter } from './enrichment/apollo'
export { normalizeIndustry } from './enrichment/normalizers/industry-map'
export { resolveLocationsInRegions, isInCountry } from './enrichment/normalizers/location-resolver'

export type { NotificationAdapter } from './notifications/interface'
export { SlackAdapter } from './notifications/slack'
export { WebPushAdapter } from './notifications/web-push'
