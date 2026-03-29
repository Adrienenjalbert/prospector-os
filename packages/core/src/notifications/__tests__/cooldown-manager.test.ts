import { describe, it, expect } from 'vitest'
import { CooldownManager } from '../cooldown-manager'

describe('CooldownManager', () => {
  it('allows first fire for a new trigger', () => {
    const cm = new CooldownManager()
    expect(cm.canFire('deal_stall', 'entity-1', 'rep-1', 7)).toBe(true)
  })

  it('blocks fire within cooldown period', () => {
    const cm = new CooldownManager()
    cm.record('deal_stall', 'entity-1', 'rep-1', 7)
    expect(cm.canFire('deal_stall', 'entity-1', 'rep-1', 7)).toBe(false)
  })

  it('allows fire after cooldown expires', () => {
    const pastDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const cm = new CooldownManager([
      { trigger_type: 'deal_stall', entity_id: 'entity-1', rep_id: 'rep-1', last_fired_at: pastDate, cooldown_days: 7 },
    ])
    expect(cm.canFire('deal_stall', 'entity-1', 'rep-1', 7)).toBe(true)
  })

  it('tracks different entities independently', () => {
    const cm = new CooldownManager()
    cm.record('deal_stall', 'entity-1', 'rep-1', 7)
    expect(cm.canFire('deal_stall', 'entity-1', 'rep-1', 7)).toBe(false)
    expect(cm.canFire('deal_stall', 'entity-2', 'rep-1', 7)).toBe(true)
  })

  it('persists and restores entries', () => {
    const cm = new CooldownManager()
    cm.record('signal_detected', 'e1', 'r1', 2)
    cm.record('deal_stall', 'e2', 'r1', 7)
    const entries = cm.getAll()
    expect(entries).toHaveLength(2)

    const restored = new CooldownManager(entries)
    expect(restored.canFire('signal_detected', 'e1', 'r1', 2)).toBe(false)
    expect(restored.canFire('deal_stall', 'e2', 'r1', 7)).toBe(false)
  })
})
