import type { TriggerType, CooldownEntry } from '../types/notifications'

export class CooldownManager {
  private entries: Map<string, CooldownEntry> = new Map()

  constructor(existingEntries: CooldownEntry[] = []) {
    for (const entry of existingEntries) {
      this.entries.set(this.key(entry.trigger_type, entry.entity_id, entry.rep_id), entry)
    }
  }

  canFire(
    triggerType: TriggerType,
    entityId: string,
    repId: string,
    cooldownDays: number
  ): boolean {
    const entry = this.entries.get(this.key(triggerType, entityId, repId))
    if (!entry) return true

    const lastFired = new Date(entry.last_fired_at)
    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000
    return Date.now() - lastFired.getTime() >= cooldownMs
  }

  record(triggerType: TriggerType, entityId: string, repId: string, cooldownDays: number): void {
    const k = this.key(triggerType, entityId, repId)
    this.entries.set(k, {
      trigger_type: triggerType,
      entity_id: entityId,
      rep_id: repId,
      last_fired_at: new Date().toISOString(),
      cooldown_days: cooldownDays,
    })
  }

  getAll(): CooldownEntry[] {
    return Array.from(this.entries.values())
  }

  private key(type: TriggerType, entityId: string, repId: string): string {
    return `${type}:${entityId}:${repId}`
  }
}

export const TRIGGER_COOLDOWNS: Record<TriggerType, number> = {
  deal_stall: 7,
  signal_detected: 2,
  priority_shift: 1,
  funnel_gap: 7,
  win_loss_insight: 0,
  daily_briefing: 1,
}
