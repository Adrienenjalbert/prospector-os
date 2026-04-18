import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A persistent cooldown store. Keyed by (tenant_id, trigger_type, subject_key).
 * `subject_key` is typically `${entity_type}:${entity_id}:${rep_id}` — any
 * stable string the caller chooses. The dispatcher uses this to avoid firing
 * the same alert type for the same subject more than once per cooldown window.
 */
export interface CooldownStore {
  shouldFire(
    tenantId: string,
    triggerType: string,
    subjectKey: string,
    cooldownDays: number,
  ): Promise<boolean>

  record(
    tenantId: string,
    triggerType: string,
    subjectKey: string,
    cooldownDays: number,
  ): Promise<void>
}

/**
 * Supabase-backed cooldown store — reads and writes the `cooldowns` table
 * (defined in migration 002). Safe to share across requests and workflows;
 * uniqueness is enforced at the DB level via
 * `UNIQUE(tenant_id, subject_key, trigger_type)`.
 */
export class SupabaseCooldownStore implements CooldownStore {
  private supabase: SupabaseClient

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase
  }

  async shouldFire(
    tenantId: string,
    triggerType: string,
    subjectKey: string,
    cooldownDays: number,
  ): Promise<boolean> {
    if (cooldownDays <= 0) return true

    const { data } = await this.supabase
      .from('cooldowns')
      .select('cooldown_until')
      .eq('tenant_id', tenantId)
      .eq('trigger_type', triggerType)
      .eq('subject_key', subjectKey)
      .maybeSingle()

    if (!data?.cooldown_until) return true
    return new Date(data.cooldown_until).getTime() <= Date.now()
  }

  async record(
    tenantId: string,
    triggerType: string,
    subjectKey: string,
    cooldownDays: number,
  ): Promise<void> {
    const now = new Date()
    const until = new Date(now.getTime() + cooldownDays * 24 * 60 * 60 * 1000)

    await this.supabase.from('cooldowns').upsert(
      {
        tenant_id: tenantId,
        trigger_type: triggerType,
        subject_key: subjectKey,
        last_fired_at: now.toISOString(),
        cooldown_until: until.toISOString(),
      },
      { onConflict: 'tenant_id,subject_key,trigger_type' },
    )
  }
}

/**
 * Default in-memory cooldown store. Useful for tests and for dispatchers that
 * don't want DB writes in the critical path. NOT safe across process restarts
 * — use SupabaseCooldownStore in production.
 */
export class InMemoryCooldownStore implements CooldownStore {
  private entries = new Map<string, number>()

  async shouldFire(
    tenantId: string,
    triggerType: string,
    subjectKey: string,
    cooldownDays: number,
  ): Promise<boolean> {
    if (cooldownDays <= 0) return true
    const k = this.key(tenantId, triggerType, subjectKey)
    const until = this.entries.get(k)
    if (!until) return true
    return until <= Date.now()
  }

  async record(
    tenantId: string,
    triggerType: string,
    subjectKey: string,
    cooldownDays: number,
  ): Promise<void> {
    const until = Date.now() + cooldownDays * 24 * 60 * 60 * 1000
    this.entries.set(this.key(tenantId, triggerType, subjectKey), until)
  }

  private key(tenantId: string, triggerType: string, subjectKey: string): string {
    return `${tenantId}:${triggerType}:${subjectKey}`
  }
}
