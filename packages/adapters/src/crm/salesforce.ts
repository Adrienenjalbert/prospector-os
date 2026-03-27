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

export interface SalesforceCredentials {
  client_id: string
  client_secret: string
  instance_url: string
  refresh_token?: string
  access_token?: string
}

export class SalesforceAdapter implements CRMAdapter {
  readonly name = 'salesforce'
  private credentials: SalesforceCredentials
  private accessToken: string | null = null

  constructor(credentials: SalesforceCredentials) {
    this.credentials = credentials
    this.accessToken = credentials.access_token ?? null
  }

  async getAccounts(filters: AccountFilters): Promise<Partial<Company>[]> {
    const conditions: string[] = []

    if (filters.owner_crm_id) {
      conditions.push(`OwnerId = '${filters.owner_crm_id}'`)
    }
    if (filters.icp_tier?.length) {
      const tiers = filters.icp_tier.map((t) => `'${t}'`).join(',')
      conditions.push(`ICP_Tier__c IN (${tiers})`)
    }
    if (filters.updated_since) {
      conditions.push(`LastModifiedDate >= ${filters.updated_since.toISOString()}`)
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
    const limit = filters.limit ? ` LIMIT ${filters.limit}` : ''
    const offset = filters.offset ? ` OFFSET ${filters.offset}` : ''

    const soql = `SELECT Id, Name, Website, Industry, NumberOfEmployees, AnnualRevenue, BillingCity, BillingCountry, OwnerId, Owner.Name, Owner.Email, ICP_Score__c, ICP_Tier__c, Signal_Score__c, Engagement_Score__c, Composite_Priority_Score__c, Priority_Tier__c, Priority_Reason__c, LastActivityDate FROM Account${where} ORDER BY Composite_Priority_Score__c DESC NULLS LAST${limit}${offset}`

    const records = await this.query(soql)

    return records.map((r: Record<string, unknown>) => ({
      crm_id: r.Id as string,
      crm_source: 'salesforce' as const,
      name: r.Name as string,
      website: r.Website as string | null,
      industry: r.Industry as string | null,
      employee_count: r.NumberOfEmployees as number | null,
      annual_revenue: r.AnnualRevenue as number | null,
      hq_city: r.BillingCity as string | null,
      hq_country: r.BillingCountry as string | null,
      owner_crm_id: r.OwnerId as string,
      owner_name: (r.Owner as Record<string, string>)?.Name ?? null,
      owner_email: (r.Owner as Record<string, string>)?.Email ?? null,
      icp_score: (r.ICP_Score__c as number) ?? 0,
      icp_tier: (r.ICP_Tier__c as string) ?? 'D',
      priority_tier: (r.Priority_Tier__c as string) ?? 'MONITOR',
      priority_reason: r.Priority_Reason__c as string | null,
      last_activity_date: r.LastActivityDate as string | null,
    }))
  }

  async getOpportunities(filters: OpportunityFilters): Promise<Partial<Opportunity>[]> {
    const conditions: string[] = []

    if (filters.owner_crm_id) {
      conditions.push(`OwnerId = '${filters.owner_crm_id}'`)
    }
    if (filters.company_crm_id) {
      conditions.push(`AccountId = '${filters.company_crm_id}'`)
    }
    if (filters.is_closed != null) {
      conditions.push(`IsClosed = ${filters.is_closed}`)
    }
    if (filters.stages?.length) {
      const stages = filters.stages.map((s) => `'${s}'`).join(',')
      conditions.push(`StageName IN (${stages})`)
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
    const limit = filters.limit ? ` LIMIT ${filters.limit}` : ''

    const soql = `SELECT Id, Name, Amount, StageName, Probability, CloseDate, AccountId, OwnerId, IsClosed, IsWon, Days_In_Stage__c, Stage_Entered_At__c, Is_Stalled__c, Stall_Reason__c, Next_Best_Action__c, Win_Probability_AI__c FROM Opportunity${where} ORDER BY Amount DESC NULLS LAST${limit}`

    const records = await this.query(soql)

    return records.map((r: Record<string, unknown>) => ({
      crm_id: r.Id as string,
      name: r.Name as string,
      value: r.Amount as number | null,
      stage: r.StageName as string,
      probability: r.Probability as number | null,
      expected_close_date: r.CloseDate as string | null,
      is_closed: r.IsClosed as boolean,
      is_won: r.IsWon as boolean,
      days_in_stage: (r.Days_In_Stage__c as number) ?? 0,
      stage_entered_at: r.Stage_Entered_At__c as string | null,
      is_stalled: (r.Is_Stalled__c as boolean) ?? false,
      stall_reason: r.Stall_Reason__c as string | null,
      owner_crm_id: r.OwnerId as string,
    }))
  }

  async getActivities(accountId: string, since: Date): Promise<CRMActivity[]> {
    const soql = `SELECT Id, Subject, ActivityDate, TaskSubtype, WhoId, CallDurationInSeconds FROM Task WHERE AccountId = '${accountId}' AND ActivityDate >= ${since.toISOString().split('T')[0]} ORDER BY ActivityDate DESC`

    const records = await this.query(soql)

    return records.map((r: Record<string, unknown>) => ({
      id: r.Id as string,
      type: mapSalesforceActivityType(r.TaskSubtype as string),
      contact_id: r.WhoId as string | null,
      account_id: accountId,
      subject: r.Subject as string | null,
      duration_minutes: r.CallDurationInSeconds
        ? Math.round((r.CallDurationInSeconds as number) / 60)
        : null,
      occurred_at: r.ActivityDate as string,
    }))
  }

  async getContacts(accountId: string): Promise<Partial<Contact>[]> {
    const soql = `SELECT Id, FirstName, LastName, Email, Title, Phone, Department FROM Contact WHERE AccountId = '${accountId}'`

    const records = await this.query(soql)

    return records.map((r: Record<string, unknown>) => ({
      crm_id: r.Id as string,
      first_name: r.FirstName as string,
      last_name: r.LastName as string,
      email: r.Email as string | null,
      title: r.Title as string | null,
      phone: r.Phone as string | null,
      department: r.Department as string | null,
    }))
  }

  async updateAccountScores(accountId: string, scores: ScorePayload): Promise<void> {
    await this.patch(`/sobjects/Account/${accountId}`, {
      ICP_Score__c: scores.icp_score,
      ICP_Tier__c: scores.icp_tier,
      Signal_Score__c: scores.signal_score,
      Engagement_Score__c: scores.engagement_score,
      Propensity__c: scores.propensity,
      Expected_Revenue__c: scores.expected_revenue,
      Priority_Tier__c: scores.priority_tier,
      Priority_Reason__c: scores.priority_reason,
    })
  }

  async updateOpportunityFlags(oppId: string, flags: OpportunityFlags): Promise<void> {
    const fields: Record<string, unknown> = {}
    if (flags.is_stalled != null) fields.Is_Stalled__c = flags.is_stalled
    if (flags.stall_reason != null) fields.Stall_Reason__c = flags.stall_reason
    if (flags.next_best_action != null) fields.Next_Best_Action__c = flags.next_best_action
    if (flags.win_probability_ai != null) fields.Win_Probability_AI__c = flags.win_probability_ai

    await this.patch(`/sobjects/Opportunity/${oppId}`, fields)
  }

  async createSignalRecord(signal: Partial<Signal>): Promise<string> {
    const result = await this.post('/sobjects/Signal__c', {
      Name: signal.title,
      Company__c: signal.company_id,
      Signal_Type__c: signal.signal_type,
      Description__c: signal.description,
      Source_URL__c: signal.source_url,
      Relevance_Score__c: signal.relevance_score,
      Weighted_Score__c: signal.weighted_score,
      Recommended_Action__c: signal.recommended_action,
      Urgency__c: signal.urgency,
      Detected_At__c: signal.detected_at,
    })
    return result.id as string
  }

  async upsertBenchmark(benchmark: Partial<FunnelBenchmark>): Promise<void> {
    await this.post('/sobjects/Funnel_Benchmark__c', {
      Stage_Name__c: benchmark.stage_name,
      Period__c: benchmark.period,
      Scope__c: benchmark.scope,
      Scope_Id__c: benchmark.scope_id,
      Conversion_Rate__c: benchmark.conversion_rate,
      Drop_Rate__c: benchmark.drop_rate,
      Deal_Count__c: benchmark.deal_count,
      Total_Value__c: benchmark.total_value,
      Avg_Days_In_Stage__c: benchmark.avg_days_in_stage,
      Impact_Score__c: benchmark.impact_score,
      Stall_Count__c: benchmark.stall_count,
    })
  }

  async setupWebhook(_events: string[], _callbackUrl: string): Promise<void> {
    // Salesforce uses PushTopics or Platform Events
    // Implementation requires Streaming API setup — placeholder
    throw new Error('Salesforce webhook setup requires manual PushTopic configuration')
  }

  async getChangedRecords(since: Date): Promise<ChangeSet> {
    const sinceISO = since.toISOString()

    const [accounts, opportunities, contacts] = await Promise.all([
      this.query(`SELECT Id FROM Account WHERE LastModifiedDate >= ${sinceISO}`),
      this.query(`SELECT Id FROM Opportunity WHERE LastModifiedDate >= ${sinceISO}`),
      this.query(`SELECT Id FROM Contact WHERE LastModifiedDate >= ${sinceISO}`),
    ])

    return {
      accounts: accounts.map((r: Record<string, unknown>) => ({
        id: r.Id as string,
        changed_fields: [],
      })),
      opportunities: opportunities.map((r: Record<string, unknown>) => ({
        id: r.Id as string,
        changed_fields: [],
      })),
      contacts: contacts.map((r: Record<string, unknown>) => ({
        id: r.Id as string,
        changed_fields: [],
      })),
    }
  }

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.credentials.client_id,
      client_secret: this.credentials.client_secret,
      refresh_token: this.credentials.refresh_token ?? '',
    })

    const res = await fetch('https://login.salesforce.com/services/oauth2/token', {
      method: 'POST',
      body: params,
    })

    if (!res.ok) {
      throw new Error(`Salesforce OAuth failed: ${res.status}`)
    }

    const data = await res.json()
    this.accessToken = data.access_token
    return this.accessToken!
  }

  private async query(soql: string): Promise<Record<string, unknown>[]> {
    const token = await this.ensureAccessToken()
    const url = `${this.credentials.instance_url}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      throw new Error(`Salesforce query failed: ${res.status} — ${await res.text()}`)
    }

    const data = await res.json()
    return data.records ?? []
  }

  private async patch(path: string, body: Record<string, unknown>): Promise<void> {
    const token = await this.ensureAccessToken()
    const url = `${this.credentials.instance_url}/services/data/v59.0${path}`

    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(`Salesforce PATCH failed: ${res.status}`)
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const token = await this.ensureAccessToken()
    const url = `${this.credentials.instance_url}/services/data/v59.0${path}`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(`Salesforce POST failed: ${res.status}`)
    }

    return res.json()
  }
}

function mapSalesforceActivityType(subtype: string): CRMActivity['type'] {
  switch (subtype?.toLowerCase()) {
    case 'call': return 'call_connected'
    case 'email': return 'email_reply_received'
    case 'task': return 'call_attempted'
    default: return 'call_attempted'
  }
}
