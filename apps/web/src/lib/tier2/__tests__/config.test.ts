import { describe, expect, it } from 'vitest'
import {
  applyTier2Update,
  decodeTier2Config,
  DEFAULT_TIER2_CONFIG,
  disabledTier2Slugs,
  isCrmWriteEnabled,
  TIER2_WRITE_TOOL_KEY,
  TIER2_WRITE_TOOL_SLUGS,
  type Tier2WriteConfig,
} from '../config'

/**
 * Phase 3 T3.2 — pure helpers for tier-2 enablement.
 *
 * These tests pin the contract that gates whether the agent sees a
 * write tool at all (`isCrmWriteEnabled`) and whether an enable
 * action is allowed (`applyTier2Update`'s acknowledgement check).
 *
 * Two bug classes worth pinning:
 *
 *   1. A refactor that flips `decodeTier2Config`'s default for an
 *      unknown blob from "everything OFF" to "everything ON" silently
 *      enables the agent for every tenant. The fail-safe-OFF tests
 *      catch this.
 *
 *   2. A refactor that lets `applyTier2Update` accept an enable
 *      without the acknowledgement breaks the procurement story.
 *      The ack-required tests pin it.
 */

const NOW = new Date('2026-04-18T12:00:00Z')

describe('decodeTier2Config', () => {
  it('returns DEFAULT for null / undefined', () => {
    expect(decodeTier2Config(null)).toEqual(DEFAULT_TIER2_CONFIG)
    expect(decodeTier2Config(undefined)).toEqual(DEFAULT_TIER2_CONFIG)
  })

  it('returns DEFAULT for non-objects', () => {
    expect(decodeTier2Config('demo')).toEqual(DEFAULT_TIER2_CONFIG)
    expect(decodeTier2Config(42)).toEqual(DEFAULT_TIER2_CONFIG)
  })

  it('returns DEFAULT for objects with all keys missing', () => {
    expect(decodeTier2Config({})).toEqual(DEFAULT_TIER2_CONFIG)
  })

  it('preserves boolean toggles when present', () => {
    const decoded = decodeTier2Config({
      log_activity: true,
      update_property: false,
      create_task: true,
    })
    expect(decoded.log_activity).toBe(true)
    expect(decoded.update_property).toBe(false)
    expect(decoded.create_task).toBe(true)
  })

  it('coerces non-boolean toggles to false (fail-safe)', () => {
    const decoded = decodeTier2Config({
      log_activity: 'yes',
      update_property: 1,
      create_task: null,
    })
    expect(decoded.log_activity).toBe(false)
    expect(decoded.update_property).toBe(false)
    expect(decoded.create_task).toBe(false)
  })

  it('preserves the acknowledgement marker when set', () => {
    const decoded = decodeTier2Config({
      log_activity: true,
      _acknowledgement_signed: true,
      _acknowledgement_signed_at: '2026-01-01T00:00:00Z',
      _acknowledgement_signed_by: 'user-uuid-1',
    })
    expect(decoded._acknowledgement_signed).toBe(true)
    expect(decoded._acknowledgement_signed_at).toBe('2026-01-01T00:00:00Z')
    expect(decoded._acknowledgement_signed_by).toBe('user-uuid-1')
  })

  it('preserves the _enabled_at / _enabled_by markers', () => {
    const decoded = decodeTier2Config({
      _enabled_at: '2026-02-01T00:00:00Z',
      _enabled_by: 'user-uuid-2',
    })
    expect(decoded._enabled_at).toBe('2026-02-01T00:00:00Z')
    expect(decoded._enabled_by).toBe('user-uuid-2')
  })
})

describe('isCrmWriteEnabled', () => {
  const cfgAllOff: Tier2WriteConfig = { ...DEFAULT_TIER2_CONFIG }
  const cfgLogOn: Tier2WriteConfig = {
    ...DEFAULT_TIER2_CONFIG,
    log_activity: true,
  }

  it('returns false for tier-2 slugs when the toggle is false (default)', () => {
    expect(isCrmWriteEnabled('log_crm_activity', cfgAllOff)).toBe(false)
    expect(isCrmWriteEnabled('update_crm_property', cfgAllOff)).toBe(false)
    expect(isCrmWriteEnabled('create_crm_task', cfgAllOff)).toBe(false)
  })

  it('returns true for the matching slug when the toggle is true', () => {
    expect(isCrmWriteEnabled('log_crm_activity', cfgLogOn)).toBe(true)
    expect(isCrmWriteEnabled('update_crm_property', cfgLogOn)).toBe(false)
    expect(isCrmWriteEnabled('create_crm_task', cfgLogOn)).toBe(false)
  })

  it('returns true for slugs NOT in the tier-2 list (gate doesn\'t apply)', () => {
    expect(isCrmWriteEnabled('research_account', cfgAllOff)).toBe(true)
    expect(isCrmWriteEnabled('detect_stalls', cfgAllOff)).toBe(true)
    expect(isCrmWriteEnabled('record_conversation_note', cfgAllOff)).toBe(true)
  })
})

describe('disabledTier2Slugs', () => {
  it('returns all three slugs when nothing is enabled (default state)', () => {
    expect(disabledTier2Slugs(DEFAULT_TIER2_CONFIG).sort()).toEqual(
      [...TIER2_WRITE_TOOL_SLUGS].sort(),
    )
  })

  it('returns only the disabled subset when one tool is on', () => {
    const cfg: Tier2WriteConfig = {
      ...DEFAULT_TIER2_CONFIG,
      log_activity: true,
    }
    expect(disabledTier2Slugs(cfg).sort()).toEqual(
      ['create_crm_task', 'update_crm_property'].sort(),
    )
  })

  it('returns [] when all three are on', () => {
    const cfg: Tier2WriteConfig = {
      log_activity: true,
      update_property: true,
      create_task: true,
      _enabled_at: '2026-04-01T00:00:00Z',
      _enabled_by: 'user-uuid',
      _acknowledgement_signed: true,
      _acknowledgement_signed_at: '2026-04-01T00:00:00Z',
      _acknowledgement_signed_by: 'user-uuid',
    }
    expect(disabledTier2Slugs(cfg)).toEqual([])
  })
})

describe('applyTier2Update', () => {
  it('refuses to enable a tool when the ack is unsigned and not provided', () => {
    const result = applyTier2Update(DEFAULT_TIER2_CONFIG, {
      next: { log_activity: true, update_property: false, create_task: false },
      acknowledged: false,
      userId: 'admin-1',
      now: NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/acknowledgement/i)
    }
  })

  it('allows enabling when the ack is provided in this request', () => {
    const result = applyTier2Update(DEFAULT_TIER2_CONFIG, {
      next: { log_activity: true, update_property: false, create_task: false },
      acknowledged: true,
      userId: 'admin-1',
      now: NOW,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.log_activity).toBe(true)
      expect(result.config._acknowledgement_signed).toBe(true)
      expect(result.config._acknowledgement_signed_at).toBe(NOW.toISOString())
      expect(result.config._acknowledgement_signed_by).toBe('admin-1')
      expect(result.config._enabled_at).toBe(NOW.toISOString())
      expect(result.config._enabled_by).toBe('admin-1')
    }
  })

  it('allows enabling without the ack being re-provided once the prior config has it signed', () => {
    const prev: Tier2WriteConfig = {
      ...DEFAULT_TIER2_CONFIG,
      _acknowledgement_signed: true,
      _acknowledgement_signed_at: '2026-01-01T00:00:00Z',
      _acknowledgement_signed_by: 'admin-x',
    }
    const result = applyTier2Update(prev, {
      next: { log_activity: true, update_property: false, create_task: false },
      acknowledged: false,
      userId: 'admin-2',
      now: NOW,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.log_activity).toBe(true)
      // Ack stays sticky from the prior config.
      expect(result.config._acknowledgement_signed_at).toBe(
        '2026-01-01T00:00:00Z',
      )
      expect(result.config._acknowledgement_signed_by).toBe('admin-x')
    }
  })

  it('allows toggling OFF without the acknowledgement', () => {
    const prev: Tier2WriteConfig = {
      ...DEFAULT_TIER2_CONFIG,
      log_activity: true,
      _acknowledgement_signed: true,
      _acknowledgement_signed_at: '2026-01-01T00:00:00Z',
      _acknowledgement_signed_by: 'admin-x',
    }
    const result = applyTier2Update(prev, {
      next: { log_activity: false, update_property: false, create_task: false },
      acknowledged: false,
      userId: 'admin-2',
      now: NOW,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.log_activity).toBe(false)
      expect(result.config._acknowledgement_signed).toBe(true)
    }
  })

  it('preserves _enabled_at when no toggle is moving ON', () => {
    const prev: Tier2WriteConfig = {
      ...DEFAULT_TIER2_CONFIG,
      log_activity: true,
      _enabled_at: '2026-01-15T10:00:00Z',
      _enabled_by: 'admin-original',
      _acknowledgement_signed: true,
      _acknowledgement_signed_at: '2026-01-15T10:00:00Z',
      _acknowledgement_signed_by: 'admin-original',
    }
    // Toggle log_activity OFF.
    const result = applyTier2Update(prev, {
      next: { log_activity: false, update_property: false, create_task: false },
      acknowledged: false,
      userId: 'admin-2',
      now: NOW,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // _enabled_at stays — it's a record of the most recent
      // activation, not the most recent change.
      expect(result.config._enabled_at).toBe('2026-01-15T10:00:00Z')
      expect(result.config._enabled_by).toBe('admin-original')
    }
  })

  it('updates _enabled_at when ANY toggle moves ON', () => {
    const prev: Tier2WriteConfig = {
      ...DEFAULT_TIER2_CONFIG,
      log_activity: true,
      _acknowledgement_signed: true,
      _acknowledgement_signed_at: '2026-01-01T00:00:00Z',
      _acknowledgement_signed_by: 'admin-x',
      _enabled_at: '2026-01-01T00:00:00Z',
      _enabled_by: 'admin-x',
    }
    // Enable a second tool.
    const result = applyTier2Update(prev, {
      next: { log_activity: true, update_property: true, create_task: false },
      acknowledged: false,
      userId: 'admin-2',
      now: NOW,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config._enabled_at).toBe(NOW.toISOString())
      expect(result.config._enabled_by).toBe('admin-2')
    }
  })

  it('TIER2_WRITE_TOOL_KEY maps every slug to a config key', () => {
    // Pin the mapping so a future tool addition (or a typo'd slug)
    // surfaces in CI.
    expect(TIER2_WRITE_TOOL_KEY).toEqual({
      log_crm_activity: 'log_activity',
      update_crm_property: 'update_property',
      create_crm_task: 'create_task',
    })
  })
})
