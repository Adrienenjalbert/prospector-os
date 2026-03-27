import type {
  Company,
  Contact,
  Opportunity,
  Signal,
  CRMActivity,
  FunnelBenchmark,
} from '@prospector/core'
import type {
  CRMAdapter,
  AccountFilters,
  OpportunityFilters,
  ScorePayload,
  OpportunityFlags,
  ChangeSet,
} from './interface'

export interface HubSpotCredentials {
  private_app_token: string
}

/**
 * HubSpot adapter — stub implementation.
 * Same interface as Salesforce, selected at runtime from tenant.crm_type.
 * Full implementation follows when HubSpot CRM is connected.
 */
export class HubSpotAdapter implements CRMAdapter {
  readonly name = 'hubspot'
  private token: string

  constructor(credentials: HubSpotCredentials) {
    this.token = credentials.private_app_token
  }

  async getAccounts(_filters: AccountFilters): Promise<Partial<Company>[]> {
    throw new Error('HubSpot adapter: getAccounts not yet implemented')
  }

  async getOpportunities(_filters: OpportunityFilters): Promise<Partial<Opportunity>[]> {
    throw new Error('HubSpot adapter: getOpportunities not yet implemented')
  }

  async getActivities(_accountId: string, _since: Date): Promise<CRMActivity[]> {
    throw new Error('HubSpot adapter: getActivities not yet implemented')
  }

  async getContacts(_accountId: string): Promise<Partial<Contact>[]> {
    throw new Error('HubSpot adapter: getContacts not yet implemented')
  }

  async updateAccountScores(_accountId: string, _scores: ScorePayload): Promise<void> {
    throw new Error('HubSpot adapter: updateAccountScores not yet implemented')
  }

  async updateOpportunityFlags(_oppId: string, _flags: OpportunityFlags): Promise<void> {
    throw new Error('HubSpot adapter: updateOpportunityFlags not yet implemented')
  }

  async createSignalRecord(_signal: Partial<Signal>): Promise<string> {
    throw new Error('HubSpot adapter: createSignalRecord not yet implemented')
  }

  async upsertBenchmark(_benchmark: Partial<FunnelBenchmark>): Promise<void> {
    throw new Error('HubSpot adapter: upsertBenchmark not yet implemented')
  }

  async setupWebhook(_events: string[], _callbackUrl: string): Promise<void> {
    throw new Error('HubSpot adapter: setupWebhook not yet implemented')
  }

  async getChangedRecords(_since: Date): Promise<ChangeSet> {
    throw new Error('HubSpot adapter: getChangedRecords not yet implemented')
  }
}
