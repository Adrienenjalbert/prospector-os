import type {
  Company,
  Contact,
  Opportunity,
  Signal,
  CRMActivity,
  FunnelBenchmark,
  ActivityType,
} from '@prospector/core'
import type {
  CRMAdapter,
  AccountFilters,
  OpportunityFilters,
  ScorePayload,
  OpportunityFlags,
  ChangeSet,
} from './interface'
import type {
  ConnectorInterface,
  ConnectorHealth,
  ConnectorQuery,
  ConnectorResult,
  SyncOptions,
  SyncResult,
} from '../connectors/interface'

export interface HubSpotCredentials {
  private_app_token: string
}

export class HubSpotError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly category?: string,
  ) {
    super(message)
    this.name = 'HubSpotError'
  }
}

const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1000

const COMPANY_PROPERTIES = [
  'name',
  'domain',
  'website',
  'industry',
  'numberofemployees',
  'annualrevenue',
  'city',
  'country',
  'hubspot_owner_id',
  'icp_score',
  'icp_tier',
  'signal_score',
  'engagement_score',
  'composite_priority_score',
  'priority_tier',
  'priority_reason',
  'notes_last_updated',
] as const

const DEAL_PROPERTIES = [
  'dealname',
  'amount',
  'dealstage',
  'closedate',
  'pipeline',
  'hs_deal_stage_probability',
  'hubspot_owner_id',
  'hs_is_closed',
  'hs_is_closed_won',
  'days_in_stage',
  'stage_entered_at',
  'is_stalled',
  'stall_reason',
  'next_best_action',
  'win_probability_ai',
  'closed_lost_reason',
  'hs_lastmodifieddate',
] as const

const CONTACT_PROPERTIES = [
  'firstname',
  'lastname',
  'email',
  'jobtitle',
  'phone',
  'hs_lead_status',
  'department',
] as const

const ENTITY_TO_OBJECT: Record<string, string> = {
  companies: 'companies',
  accounts: 'companies',
  deals: 'deals',
  opportunities: 'deals',
  contacts: 'contacts',
  engagements: 'engagements',
}

const FILTER_OP_MAP: Record<string, string> = {
  eq: 'EQ',
  neq: 'NEQ',
  gt: 'GT',
  gte: 'GTE',
  lt: 'LT',
  lte: 'LTE',
  in: 'IN',
  like: 'CONTAINS_TOKEN',
  contains: 'CONTAINS_TOKEN',
}

export class HubSpotAdapter implements CRMAdapter, ConnectorInterface {
  readonly type = 'crm'
  readonly provider = 'hubspot'
  readonly name = 'hubspot'
  private token: string
  private baseUrl = 'https://api.hubapi.com'

  constructor(credentials: HubSpotCredentials) {
    this.token = credentials.private_app_token
  }

  // ── ConnectorInterface ────────────────────────────────────────────────

  async connect(credentials: Record<string, unknown>): Promise<void> {
    if (credentials.private_app_token) {
      this.token = credentials.private_app_token as string
    }
    const health = await this.healthCheck()
    if (health.status === 'error') {
      throw new HubSpotError(
        `Connection failed: ${health.message}`,
        401,
      )
    }
  }

  async disconnect(): Promise<void> {
    // Stateless — nothing to tear down
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now()
    try {
      const res = await this.request(
        '/crm/v3/objects/companies?limit=1',
      )
      if (!res.ok) {
        return {
          status: 'error',
          latency_ms: Date.now() - start,
          message: `API returned ${res.status}`,
          checked_at: new Date().toISOString(),
        }
      }
      return {
        status: 'healthy',
        latency_ms: Date.now() - start,
        checked_at: new Date().toISOString(),
      }
    } catch (err) {
      return {
        status: 'error',
        latency_ms: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
        checked_at: new Date().toISOString(),
      }
    }
  }

  async read(query: ConnectorQuery): Promise<ConnectorResult> {
    const objectType =
      ENTITY_TO_OBJECT[query.entity] ?? query.entity

    if (query.filters?.length) {
      return this.searchRead(objectType, query)
    }

    const params = new URLSearchParams()
    if (query.limit) params.set('limit', String(query.limit))
    if (query.offset) params.set('after', String(query.offset))
    if (query.fields?.length) {
      params.set('properties', query.fields.join(','))
    }

    const url = `/crm/v3/objects/${objectType}?${params}`
    const body = await this.get<HubSpotListResponse>(url)

    return {
      data: body.results.map((r) => ({
        id: r.id,
        ...r.properties,
      })),
      total: body.total ?? undefined,
      has_more: !!body.paging?.next,
      cursor: body.paging?.next?.after,
    }
  }

  async write(
    entity: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const objectType = ENTITY_TO_OBJECT[entity] ?? entity
    const id = data.id as string | undefined
    delete data.id

    if (id) {
      await this.patch(
        `/crm/v3/objects/${objectType}/${id}`,
        { properties: data },
      )
      return id
    }

    const result = await this.post<{ id: string }>(
      `/crm/v3/objects/${objectType}`,
      { properties: data },
    )
    return result.id
  }

  async sync(options: SyncOptions): Promise<SyncResult> {
    const objectType =
      ENTITY_TO_OBJECT[options.entity] ?? options.entity
    const batchSize = options.batch_size ?? 100
    let created = 0
    let updated = 0
    const errors: { record_id: string; error: string }[] = []
    let totalSynced = 0
    let after: string | undefined

    const filters: HubSpotFilter[] = []
    if (options.since && !options.full_sync) {
      filters.push({
        propertyName: 'hs_lastmodifieddate',
        operator: 'GTE',
        value: options.since,
      })
    }

    do {
      const searchBody: HubSpotSearchBody = {
        filterGroups: filters.length
          ? [{ filters }]
          : [],
        limit: batchSize,
        ...(after ? { after } : {}),
      }

      const body = await this.post<HubSpotListResponse>(
        `/crm/v3/objects/${objectType}/search`,
        searchBody,
      )

      totalSynced += body.results.length
      updated += body.results.length
      after = body.paging?.next?.after
    } while (after)

    return {
      records_synced: totalSynced,
      records_created: created,
      records_updated: updated,
      errors,
      completed_at: new Date().toISOString(),
    }
  }

  // ── CRMAdapter ────────────────────────────────────────────────────────

  async getAccounts(
    filters: AccountFilters,
  ): Promise<Partial<Company>[]> {
    const hsFilters: HubSpotFilter[] = []

    if (filters.owner_crm_id) {
      hsFilters.push({
        propertyName: 'hubspot_owner_id',
        operator: 'EQ',
        value: filters.owner_crm_id,
      })
    }
    if (filters.icp_tier?.length) {
      hsFilters.push({
        propertyName: 'icp_tier',
        operator: 'IN',
        values: filters.icp_tier,
      })
    }
    if (filters.updated_since) {
      hsFilters.push({
        propertyName: 'hs_lastmodifieddate',
        operator: 'GTE',
        value: filters.updated_since.toISOString(),
      })
    }

    const limit = filters.limit ?? 100
    const after = filters.offset ? String(filters.offset) : undefined

    const body = await this.post<HubSpotListResponse>(
      '/crm/v3/objects/companies/search',
      {
        filterGroups: hsFilters.length
          ? [{ filters: hsFilters }]
          : [],
        properties: [...COMPANY_PROPERTIES],
        sorts: [
          {
            propertyName: 'composite_priority_score',
            direction: 'DESCENDING',
          },
        ],
        limit,
        ...(after ? { after } : {}),
      },
    )

    return body.results.map(mapCompany)
  }

  /**
   * Batch lookup of parent-company associations for a list of HubSpot
   * company crm_ids. Returns a Map<crmId, parentCrmId> for the
   * companies that have a parent association (rows without a parent
   * are absent from the map).
   *
   * Uses HubSpot's v4 batch associations API: one POST per call, up to
   * 100 ids per batch. The route's cron/sync caller batches in 100s.
   *
   * Used by the Phase-3.10 account hierarchy work — without this method,
   * subsidiaries and parents stay invisible to each other in our
   * canonical store and the agent can't reason about land-and-expand.
   */
  async getCompanyParentMap(
    crmIds: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    if (crmIds.length === 0) return out

    // v4 batch associations: POST /crm/v4/associations/{fromObjectType}/{toObjectType}/batch/read
    // For company-to-company, both fromObjectType and toObjectType are "companies".
    // We request the "child_to_parent_company" associationTypeId implicitly —
    // HubSpot returns ALL company-to-company associations, and we filter by
    // the well-known typeId in the response. Per HubSpot docs:
    //   typeId 14 = child_to_parent_company (the one we want)
    //   typeId 15 = parent_to_child_company (the inverse)
    const CHILD_TO_PARENT_TYPE_ID = 14

    const batchSize = 100
    for (let i = 0; i < crmIds.length; i += batchSize) {
      const batch = crmIds.slice(i, i + batchSize)
      try {
        const body = await this.post<{
          results: Array<{
            from: { id: string }
            to: Array<{ toObjectId: string; associationTypes: Array<{ typeId: number; label: string | null }> }>
          }>
        }>(
          `/crm/v4/associations/companies/companies/batch/read`,
          { inputs: batch.map((id) => ({ id })) },
        )

        for (const row of body.results ?? []) {
          // Pick the first association whose typeId matches the
          // child_to_parent direction. HubSpot only allows ONE parent
          // per company so first-match is safe.
          const parentEntry = (row.to ?? []).find((t) =>
            (t.associationTypes ?? []).some(
              (at) => at.typeId === CHILD_TO_PARENT_TYPE_ID,
            ),
          )
          if (parentEntry) {
            out.set(row.from.id, parentEntry.toObjectId)
          }
        }
      } catch (err) {
        // Don't fail the whole sync — just log and skip this batch.
        // The next sync run gets another chance.
        console.warn('[hubspot] getCompanyParentMap batch failed:', err)
      }
    }

    return out
  }

  async getOpportunities(
    filters: OpportunityFilters,
  ): Promise<Partial<Opportunity>[]> {
    const hsFilters: HubSpotFilter[] = []

    if (filters.owner_crm_id) {
      hsFilters.push({
        propertyName: 'hubspot_owner_id',
        operator: 'EQ',
        value: filters.owner_crm_id,
      })
    }
    if (filters.company_crm_id) {
      hsFilters.push({
        propertyName: 'associations.company',
        operator: 'EQ',
        value: filters.company_crm_id,
      })
    }
    if (filters.is_closed != null) {
      hsFilters.push({
        propertyName: 'hs_is_closed',
        operator: 'EQ',
        value: String(filters.is_closed),
      })
    }
    if (filters.stages?.length) {
      hsFilters.push({
        propertyName: 'dealstage',
        operator: 'IN',
        values: filters.stages,
      })
    }

    const body = await this.post<HubSpotListResponse>(
      '/crm/v3/objects/deals/search',
      {
        filterGroups: hsFilters.length
          ? [{ filters: hsFilters }]
          : [],
        properties: [...DEAL_PROPERTIES],
        sorts: [
          { propertyName: 'amount', direction: 'DESCENDING' },
        ],
        limit: filters.limit ?? 100,
      },
    )

    return body.results.map(mapDeal)
  }

  async getActivities(
    accountId: string,
    since: Date,
  ): Promise<CRMActivity[]> {
    const body = await this.post<HubSpotListResponse>(
      '/crm/v3/objects/engagements/search',
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'associations.company',
                operator: 'EQ',
                value: accountId,
              },
              {
                propertyName: 'hs_createdate',
                operator: 'GTE',
                value: since.toISOString(),
              },
            ],
          },
        ],
        properties: [
          'hs_engagement_type',
          'hs_createdate',
          'hs_activity_type',
          'hs_engagement_source',
          'hs_call_title',
          'hs_call_duration',
          'hs_email_subject',
        ],
        sorts: [
          { propertyName: 'hs_createdate', direction: 'DESCENDING' },
        ],
        limit: 100,
      },
    )

    return body.results.map((r) =>
      mapActivity(r, accountId),
    )
  }

  async getContacts(
    accountId: string,
  ): Promise<Partial<Contact>[]> {
    const body = await this.post<HubSpotListResponse>(
      '/crm/v3/objects/contacts/search',
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'associations.company',
                operator: 'EQ',
                value: accountId,
              },
            ],
          },
        ],
        properties: [...CONTACT_PROPERTIES],
        limit: 100,
      },
    )

    return body.results.map(mapContact)
  }

  async updateAccountScores(
    accountId: string,
    scores: ScorePayload,
  ): Promise<void> {
    await this.patch(`/crm/v3/objects/companies/${accountId}`, {
      properties: {
        icp_score: String(scores.icp_score),
        icp_tier: scores.icp_tier,
        signal_score: String(scores.signal_score),
        engagement_score: String(scores.engagement_score),
        propensity: String(scores.propensity),
        expected_revenue: String(scores.expected_revenue),
        priority_tier: scores.priority_tier,
        priority_reason: scores.priority_reason,
      },
    })
  }

  async updateOpportunityFlags(
    oppId: string,
    flags: OpportunityFlags,
  ): Promise<void> {
    const properties: Record<string, string> = {}
    if (flags.is_stalled != null)
      properties.is_stalled = String(flags.is_stalled)
    if (flags.stall_reason != null)
      properties.stall_reason = flags.stall_reason
    if (flags.next_best_action != null)
      properties.next_best_action = flags.next_best_action
    if (flags.win_probability_ai != null)
      properties.win_probability_ai = String(flags.win_probability_ai)

    await this.patch(`/crm/v3/objects/deals/${oppId}`, {
      properties,
    })
  }

  async createSignalRecord(
    signal: Partial<Signal>,
  ): Promise<string> {
    const noteBody = [
      `**Signal: ${signal.title ?? 'Untitled'}**`,
      `Type: ${signal.signal_type ?? 'unknown'}`,
      signal.description ? `Description: ${signal.description}` : null,
      signal.source_url ? `Source: ${signal.source_url}` : null,
      signal.relevance_score != null
        ? `Relevance: ${signal.relevance_score}`
        : null,
      signal.weighted_score != null
        ? `Weighted Score: ${signal.weighted_score}`
        : null,
      signal.recommended_action
        ? `Action: ${signal.recommended_action}`
        : null,
      signal.urgency ? `Urgency: ${signal.urgency}` : null,
      signal.detected_at ? `Detected: ${signal.detected_at}` : null,
    ]
      .filter(Boolean)
      .join('\n')

    const result = await this.post<{ id: string }>(
      '/crm/v3/objects/notes',
      {
        properties: {
          hs_note_body: noteBody,
          hs_timestamp: new Date().toISOString(),
        },
      },
    )

    if (signal.company_id) {
      await this.put(
        `/crm/v3/objects/notes/${result.id}/associations/companies/${signal.company_id}/note_to_company`,
      )
    }

    return result.id
  }

  async upsertBenchmark(
    benchmark: Partial<FunnelBenchmark>,
  ): Promise<void> {
    if (!benchmark.scope_id) {
      throw new HubSpotError(
        'upsertBenchmark requires scope_id (company CRM ID)',
        400,
      )
    }

    await this.patch(
      `/crm/v3/objects/companies/${benchmark.scope_id}`,
      {
        properties: {
          funnel_stage_name: benchmark.stage_name ?? '',
          funnel_period: benchmark.period ?? '',
          funnel_scope: benchmark.scope ?? '',
          funnel_conversion_rate: String(
            benchmark.conversion_rate ?? 0,
          ),
          funnel_drop_rate: String(benchmark.drop_rate ?? 0),
          funnel_deal_count: String(benchmark.deal_count ?? 0),
          funnel_total_value: String(benchmark.total_value ?? 0),
          funnel_avg_days_in_stage: String(
            benchmark.avg_days_in_stage ?? 0,
          ),
          funnel_impact_score: String(benchmark.impact_score ?? 0),
          funnel_stall_count: String(benchmark.stall_count ?? 0),
        },
      },
    )
  }

  async setupWebhook(
    events: string[],
    callbackUrl: string,
  ): Promise<void> {
    const appId = await this.resolveAppId()

    await this.put(
      `/webhooks/v3/${appId}/settings`,
      {
        targetUrl: callbackUrl,
        throttling: {
          period: 'SECONDLY',
          maxConcurrentRequests: 10,
        },
      },
    )

    for (const event of events) {
      const { objectType, propertyName, eventType } =
        parseWebhookEvent(event)
      await this.post(
        `/webhooks/v3/${appId}/subscriptions`,
        {
          eventType,
          ...(objectType ? { objectTypeId: objectType } : {}),
          ...(propertyName ? { propertyName } : {}),
          active: true,
        },
      )
    }
  }

  async getChangedRecords(since: Date): Promise<ChangeSet> {
    const sinceISO = since.toISOString()
    const modifiedFilter: HubSpotFilter = {
      propertyName: 'hs_lastmodifieddate',
      operator: 'GTE',
      value: sinceISO,
    }

    const [companies, deals, contacts] = await Promise.all([
      this.post<HubSpotListResponse>(
        '/crm/v3/objects/companies/search',
        {
          filterGroups: [{ filters: [modifiedFilter] }],
          properties: ['hs_lastmodifieddate'],
          limit: 100,
        },
      ),
      this.post<HubSpotListResponse>(
        '/crm/v3/objects/deals/search',
        {
          filterGroups: [{ filters: [modifiedFilter] }],
          properties: ['hs_lastmodifieddate'],
          limit: 100,
        },
      ),
      this.post<HubSpotListResponse>(
        '/crm/v3/objects/contacts/search',
        {
          filterGroups: [{ filters: [modifiedFilter] }],
          properties: ['hs_lastmodifieddate'],
          limit: 100,
        },
      ),
    ])

    return {
      accounts: companies.results.map((r) => ({
        id: r.id,
        changed_fields: [],
      })),
      opportunities: deals.results.map((r) => ({
        id: r.id,
        changed_fields: [],
      })),
      contacts: contacts.results.map((r) => ({
        id: r.id,
        changed_fields: [],
      })),
    }
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────

  // -------------------------------------------------------------------------
  // Engagement + task creation (Phase 3.6 — CRM write-back tools)
  //
  // The agent never auto-acts on CRM state; these methods are called by
  // tools that go through `writeApprovalGate` middleware first, so by the
  // time we reach the API we already have rep approval. Each method
  // returns the new HubSpot object id so the calling tool can build a
  // citation pointing at the new record — that means the next turn's
  // `current-deal-health` slice already shows the change.
  // -------------------------------------------------------------------------

  /**
   * Create a HubSpot engagement (note / call / email / meeting) and
   * associate it with one or more parent objects (deal, company, contact).
   *
   * Engagement type maps to the HubSpot v3 object endpoint:
   *   - 'note'    → /crm/v3/objects/notes
   *   - 'call'    → /crm/v3/objects/calls
   *   - 'email'   → /crm/v3/objects/emails
   *   - 'meeting' → /crm/v3/objects/meetings
   *
   * Associations use the well-known v3 association type names:
   *   note_to_company / note_to_deal / note_to_contact (and call/email/meeting
   *   variants). HubSpot tolerates association calls on missing types
   *   (silent no-op), so we don't pre-validate.
   */
  async createEngagement(
    type: 'note' | 'call' | 'email' | 'meeting',
    body: string,
    associations: { companyId?: string; dealId?: string; contactId?: string } = {},
    extraProperties: Record<string, unknown> = {},
  ): Promise<string> {
    const objectType = `${type}s` // notes, calls, emails, meetings
    const propertyKey = `hs_${type}_body`

    const properties: Record<string, unknown> = {
      [propertyKey]: body,
      hs_timestamp: new Date().toISOString(),
      ...extraProperties,
    }

    const result = await this.post<{ id: string }>(
      `/crm/v3/objects/${objectType}`,
      { properties },
    )

    // Best-effort associations — failure on one shouldn't block the others.
    const tasks: Promise<unknown>[] = []
    if (associations.companyId) {
      tasks.push(
        this.put(
          `/crm/v3/objects/${objectType}/${result.id}/associations/companies/${associations.companyId}/${type}_to_company`,
        ).catch((err) => console.warn(`[hubspot] note→company assoc failed: ${err}`)),
      )
    }
    if (associations.dealId) {
      tasks.push(
        this.put(
          `/crm/v3/objects/${objectType}/${result.id}/associations/deals/${associations.dealId}/${type}_to_deal`,
        ).catch((err) => console.warn(`[hubspot] note→deal assoc failed: ${err}`)),
      )
    }
    if (associations.contactId) {
      tasks.push(
        this.put(
          `/crm/v3/objects/${objectType}/${result.id}/associations/contacts/${associations.contactId}/${type}_to_contact`,
        ).catch((err) => console.warn(`[hubspot] note→contact assoc failed: ${err}`)),
      )
    }
    await Promise.all(tasks)

    return result.id
  }

  /**
   * Create a HubSpot task with optional association to a deal/company/contact.
   * The owner can be set via the HubSpot user id (`hubspot_owner_id`).
   */
  async createTask(input: {
    subject: string
    body?: string
    dueDate?: string // ISO timestamp
    ownerId?: string
    priority?: 'LOW' | 'MEDIUM' | 'HIGH'
    companyId?: string
    dealId?: string
    contactId?: string
  }): Promise<string> {
    const properties: Record<string, unknown> = {
      hs_task_subject: input.subject,
      hs_task_priority: input.priority ?? 'MEDIUM',
      hs_task_status: 'NOT_STARTED',
      hs_task_type: 'TODO',
      hs_timestamp: new Date().toISOString(),
    }
    if (input.body) properties.hs_task_body = input.body
    if (input.dueDate) properties.hs_timestamp = input.dueDate
    if (input.ownerId) properties.hubspot_owner_id = input.ownerId

    const result = await this.post<{ id: string }>(
      `/crm/v3/objects/tasks`,
      { properties },
    )

    const tasks: Promise<unknown>[] = []
    if (input.companyId) {
      tasks.push(
        this.put(
          `/crm/v3/objects/tasks/${result.id}/associations/companies/${input.companyId}/task_to_company`,
        ).catch((err) => console.warn(`[hubspot] task→company assoc failed: ${err}`)),
      )
    }
    if (input.dealId) {
      tasks.push(
        this.put(
          `/crm/v3/objects/tasks/${result.id}/associations/deals/${input.dealId}/task_to_deal`,
        ).catch((err) => console.warn(`[hubspot] task→deal assoc failed: ${err}`)),
      )
    }
    if (input.contactId) {
      tasks.push(
        this.put(
          `/crm/v3/objects/tasks/${result.id}/associations/contacts/${input.contactId}/task_to_contact`,
        ).catch((err) => console.warn(`[hubspot] task→contact assoc failed: ${err}`)),
      )
    }
    await Promise.all(tasks)

    return result.id
  }

  /**
   * Build a HubSpot deep-link URL for a record id. Used by the citation
   * extractor so the citation pill links the rep to the just-written record.
   */
  static buildRecordUrl(
    objectType: 'company' | 'deal' | 'contact' | 'note' | 'task',
    objectId: string,
    portalId?: string,
  ): string {
    const objectIdMap: Record<string, string> = {
      company: '0-2',
      deal: '0-3',
      contact: '0-1',
      note: '0-46',
      task: '0-27',
    }
    const objId = objectIdMap[objectType] ?? '0-2'
    const base = portalId
      ? `https://app.hubspot.com/contacts/${portalId}/record/${objId}/${objectId}`
      : `https://app.hubspot.com/contacts/0/record/${objId}/${objectId}`
    return base
  }

  private async request(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, { ...init, headers })

      if (res.status === 429) {
        const retryAfter =
          parseInt(res.headers.get('Retry-After') ?? '', 10) ||
          INITIAL_BACKOFF_MS / 1000
        const delayMs = Math.min(
          retryAfter * 1000 * Math.pow(2, attempt),
          30_000,
        )
        await sleep(delayMs)
        continue
      }

      return res
    }

    throw new HubSpotError(
      `Rate limited after ${MAX_RETRIES} retries: ${path}`,
      429,
      'RATE_LIMITED',
    )
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.request(path)
    if (!res.ok) {
      const text = await res.text()
      throw new HubSpotError(
        `GET ${path} failed: ${res.status} — ${text}`,
        res.status,
      )
    }
    return res.json() as Promise<T>
  }

  private async post<T>(
    path: string,
    body: unknown,
  ): Promise<T> {
    const res = await this.request(path, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new HubSpotError(
        `POST ${path} failed: ${res.status} — ${text}`,
        res.status,
      )
    }
    return res.json() as Promise<T>
  }

  private async patch(
    path: string,
    body: unknown,
  ): Promise<void> {
    const res = await this.request(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new HubSpotError(
        `PATCH ${path} failed: ${res.status} — ${text}`,
        res.status,
      )
    }
  }

  private async put(
    path: string,
    body?: unknown,
  ): Promise<void> {
    const res = await this.request(path, {
      method: 'PUT',
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new HubSpotError(
        `PUT ${path} failed: ${res.status} — ${text}`,
        res.status,
      )
    }
  }

  private async searchRead(
    objectType: string,
    query: ConnectorQuery,
  ): Promise<ConnectorResult> {
    const filters: HubSpotFilter[] = (query.filters ?? []).map(
      (f) => ({
        propertyName: f.field,
        operator: FILTER_OP_MAP[f.operator] ?? 'EQ',
        value: String(f.value),
      }),
    )

    const searchBody: HubSpotSearchBody = {
      filterGroups: [{ filters }],
      limit: query.limit ?? 100,
      ...(query.offset ? { after: String(query.offset) } : {}),
      ...(query.fields?.length
        ? { properties: query.fields }
        : {}),
      ...(query.sort
        ? {
            sorts: [
              {
                propertyName: query.sort.field,
                direction:
                  query.sort.direction === 'asc'
                    ? 'ASCENDING'
                    : 'DESCENDING',
              },
            ],
          }
        : {}),
    }

    const body = await this.post<HubSpotListResponse>(
      `/crm/v3/objects/${objectType}/search`,
      searchBody,
    )

    return {
      data: body.results.map((r) => ({
        id: r.id,
        ...r.properties,
      })),
      total: body.total ?? undefined,
      has_more: !!body.paging?.next,
      cursor: body.paging?.next?.after,
    }
  }

  private async resolveAppId(): Promise<string> {
    const res = await this.get<{ appId?: number; portalId?: number }>(
      '/integrations/v1/me',
    )
    if (!res.appId) {
      throw new HubSpotError(
        'Could not resolve appId — webhook setup requires a HubSpot app token',
        400,
      )
    }
    return String(res.appId)
  }
}

// ── Mappers ─────────────────────────────────────────────────────────────

function mapCompany(r: HubSpotRecord): Partial<Company> {
  const p = r.properties
  return {
    crm_id: r.id,
    crm_source: 'hubspot' as const,
    name: p.name ?? '',
    domain: p.domain ?? null,
    website: p.website ?? null,
    industry: p.industry ?? null,
    employee_count: toNumberOrNull(p.numberofemployees),
    annual_revenue: toNumberOrNull(p.annualrevenue),
    hq_city: p.city ?? null,
    hq_country: p.country ?? null,
    owner_crm_id: p.hubspot_owner_id ?? null,
    icp_score: toNumberOrNull(p.icp_score) ?? 0,
    icp_tier: (p.icp_tier as Company['icp_tier']) ?? 'D',
    priority_tier:
      (p.priority_tier as Company['priority_tier']) ?? 'MONITOR',
    priority_reason: p.priority_reason ?? null,
    last_activity_date: p.notes_last_updated ?? null,
  }
}

function mapDeal(r: HubSpotRecord): Partial<Opportunity> {
  const p = r.properties
  return {
    crm_id: r.id,
    name: p.dealname ?? '',
    value: toNumberOrNull(p.amount),
    stage: p.dealstage ?? '',
    probability: toNumberOrNull(p.hs_deal_stage_probability),
    expected_close_date: p.closedate ?? null,
    is_closed: p.hs_is_closed === 'true',
    is_won: p.hs_is_closed_won === 'true',
    closed_at:
      p.hs_is_closed === 'true' ? (p.closedate ?? null) : null,
    lost_reason: p.closed_lost_reason ?? null,
    days_in_stage: toNumberOrNull(p.days_in_stage) ?? 0,
    stage_entered_at: p.stage_entered_at ?? null,
    is_stalled: p.is_stalled === 'true',
    stall_reason: p.stall_reason ?? null,
    owner_crm_id: p.hubspot_owner_id ?? null,
  }
}

function mapContact(r: HubSpotRecord): Partial<Contact> {
  const p = r.properties
  return {
    crm_id: r.id,
    first_name: p.firstname ?? '',
    last_name: p.lastname ?? '',
    email: p.email ?? null,
    title: p.jobtitle ?? null,
    phone: p.phone ?? null,
    department: p.department ?? null,
  }
}

function mapActivity(
  r: HubSpotRecord,
  accountId: string,
): CRMActivity {
  const p = r.properties
  return {
    id: r.id,
    type: mapEngagementType(p.hs_engagement_type ?? ''),
    contact_id: null,
    account_id: accountId,
    subject:
      p.hs_call_title ?? p.hs_email_subject ?? null,
    duration_minutes: p.hs_call_duration
      ? Math.round(Number(p.hs_call_duration) / 1000 / 60)
      : null,
    occurred_at: p.hs_createdate ?? new Date().toISOString(),
  }
}

function mapEngagementType(type: string): ActivityType {
  switch (type?.toUpperCase()) {
    case 'CALL':
      return 'call_connected'
    case 'EMAIL':
      return 'email_reply_received'
    case 'MEETING':
      return 'meeting_one_on_one'
    case 'NOTE':
    case 'TASK':
      return 'call_attempted'
    default:
      return 'call_attempted'
  }
}

function parseWebhookEvent(event: string): {
  objectType: string | null
  propertyName: string | null
  eventType: string
} {
  const parts = event.split('.')
  if (parts.length === 2) {
    return {
      objectType: parts[0],
      propertyName: null,
      eventType: `${parts[0]}.${parts[1]}`,
    }
  }
  if (parts.length >= 3) {
    return {
      objectType: parts[0],
      propertyName: parts[2],
      eventType: `${parts[0]}.${parts[1]}`,
    }
  }
  return { objectType: null, propertyName: null, eventType: event }
}

// ── Utilities ───────────────────────────────────────────────────────────

function toNumberOrNull(val: string | null | undefined): number | null {
  if (val == null || val === '') return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── HubSpot API types ───────────────────────────────────────────────────

interface HubSpotRecord {
  id: string
  properties: Record<string, string | null>
  associations?: Record<
    string,
    { results: { id: string; type: string }[] }
  >
}

interface HubSpotListResponse {
  results: HubSpotRecord[]
  total?: number
  paging?: {
    next?: { after: string }
  }
}

interface HubSpotFilter {
  propertyName: string
  operator: string
  value?: string
  values?: string[]
}

interface HubSpotSearchBody {
  filterGroups: { filters: HubSpotFilter[] }[]
  properties?: string[]
  sorts?: { propertyName: string; direction: string }[]
  limit?: number
  after?: string
}
