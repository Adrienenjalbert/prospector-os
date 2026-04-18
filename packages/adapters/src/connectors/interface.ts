export interface ConnectorHealth {
  status: 'healthy' | 'degraded' | 'error'
  latency_ms: number
  message?: string
  checked_at: string
}

export interface QueryFilter {
  field: string
  operator:
    | 'eq'
    | 'neq'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'in'
    | 'like'
    | 'contains'
  value: unknown
}

export interface ConnectorQuery {
  entity: string
  fields?: string[]
  filters?: QueryFilter[]
  sort?: { field: string; direction: 'asc' | 'desc' }
  limit?: number
  offset?: number
}

export interface ConnectorResult {
  data: Record<string, unknown>[]
  total?: number
  has_more?: boolean
  cursor?: string
}

export interface SyncOptions {
  entity: string
  since?: string
  batch_size?: number
  full_sync?: boolean
}

export interface SyncError {
  record_id: string
  error: string
}

export interface SyncResult {
  records_synced: number
  records_created: number
  records_updated: number
  errors: SyncError[]
  completed_at: string
}

export interface ConnectorInterface {
  readonly type: string
  readonly provider: string

  connect(credentials: Record<string, unknown>): Promise<void>
  disconnect(): Promise<void>
  healthCheck(): Promise<ConnectorHealth>

  read(query: ConnectorQuery): Promise<ConnectorResult>
  write?(entity: string, data: Record<string, unknown>): Promise<string>

  setupWebhook?(events: string[], callbackUrl: string): Promise<void>
  sync?(options: SyncOptions): Promise<SyncResult>
}

export class ConnectorRegistry {
  private connectors: Map<string, ConnectorInterface> = new Map()

  register(key: string, connector: ConnectorInterface): void {
    this.connectors.set(key, connector)
  }

  get(key: string): ConnectorInterface | undefined {
    return this.connectors.get(key)
  }

  getByType(type: string): ConnectorInterface[] {
    const matches: ConnectorInterface[] = []
    for (const connector of this.connectors.values()) {
      if (connector.type === type) matches.push(connector)
    }
    return matches
  }

  list(): { key: string; type: string; provider: string }[] {
    const entries: { key: string; type: string; provider: string }[] = []
    for (const [key, connector] of this.connectors) {
      entries.push({ key, type: connector.type, provider: connector.provider })
    }
    return entries
  }

  async healthCheckAll(): Promise<Map<string, ConnectorHealth>> {
    const results = new Map<string, ConnectorHealth>()
    const checks = Array.from(this.connectors.entries()).map(
      async ([key, connector]) => {
        try {
          const health = await connector.healthCheck()
          results.set(key, health)
        } catch (err) {
          results.set(key, {
            status: 'error',
            latency_ms: -1,
            message: err instanceof Error ? err.message : String(err),
            checked_at: new Date().toISOString(),
          })
        }
      }
    )
    await Promise.all(checks)
    return results
  }
}
