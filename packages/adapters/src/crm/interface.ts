import type {
  Company,
  Contact,
  Opportunity,
  Signal,
  CRMActivity,
  FunnelBenchmark,
} from '@prospector/core'

export interface AccountFilters {
  owner_crm_id?: string
  icp_tier?: string[]
  updated_since?: Date
  limit?: number
  offset?: number
}

export interface OpportunityFilters {
  owner_crm_id?: string
  company_crm_id?: string
  stages?: string[]
  is_closed?: boolean
  updated_since?: Date
  limit?: number
}

export interface ScorePayload {
  icp_score: number
  icp_tier: string
  signal_score: number
  engagement_score: number
  propensity: number
  expected_revenue: number
  priority_tier: string
  priority_reason: string
}

export interface OpportunityFlags {
  is_stalled?: boolean
  stall_reason?: string
  next_best_action?: string
  win_probability_ai?: number
}

export interface ChangeSet {
  accounts: { id: string; changed_fields: string[] }[]
  opportunities: { id: string; changed_fields: string[] }[]
  contacts: { id: string; changed_fields: string[] }[]
}

export interface CRMAdapter {
  readonly name: string

  getAccounts(filters: AccountFilters): Promise<Partial<Company>[]>
  getOpportunities(filters: OpportunityFilters): Promise<Partial<Opportunity>[]>
  getActivities(accountId: string, since: Date): Promise<CRMActivity[]>
  getContacts(accountId: string): Promise<Partial<Contact>[]>

  updateAccountScores(accountId: string, scores: ScorePayload): Promise<void>
  updateOpportunityFlags(oppId: string, flags: OpportunityFlags): Promise<void>
  createSignalRecord(signal: Partial<Signal>): Promise<string>
  upsertBenchmark(benchmark: Partial<FunnelBenchmark>): Promise<void>

  setupWebhook(events: string[], callbackUrl: string): Promise<void>
  getChangedRecords(since: Date): Promise<ChangeSet>
}
