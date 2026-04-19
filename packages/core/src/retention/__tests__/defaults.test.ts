import { describe, expect, it } from 'vitest'
import {
  RETENTION_DEFAULT_DAYS,
  RETENTION_MAX_DAYS,
  RETENTION_TABLE_NAMES,
  defaultRetentionDays,
  isRetentionTableName,
  validateRetentionOverride,
} from '../defaults'

/**
 * The retention defaults are a security/compliance contract — every change
 * needs a deliberate decision and (per OQ-4) a paired migration update so
 * the DB CHECK constraint and the TS map stay in sync. These tests pin
 * the contract.
 */
describe('retention defaults', () => {
  it('every default is a positive integer day count', () => {
    for (const [table, days] of Object.entries(RETENTION_DEFAULT_DAYS)) {
      expect(Number.isInteger(days), `${table} must be an integer`).toBe(true)
      expect(days, `${table} must be > 0`).toBeGreaterThan(0)
    }
  })

  it('no default exceeds the 7-year ceiling', () => {
    for (const [table, days] of Object.entries(RETENTION_DEFAULT_DAYS)) {
      expect(days, `${table} must respect 7-year ceiling`).toBeLessThanOrEqual(
        RETENTION_MAX_DAYS,
      )
    }
  })

  it('agent_events is 730 days (Cursor disagreement with OQ-4 — see defaults.ts)', () => {
    // This case pins the deliberate disagreement with the OQ-4 owner
    // answer. If a future PR shortens this to 365 (matching OQ-4
    // verbatim), it must ALSO ship the T7.7 derived-state snapshot
    // workflow — otherwise the bandit + champion-alumni starve.
    expect(RETENTION_DEFAULT_DAYS.agent_events).toBe(730)
  })

  it('ai_conversation_notes <= transcripts_raw_text (OQ-4 backdoor rule)', () => {
    // Per OQ-4 owner: notes that quote transcripts must not outlive the
    // source. Pin the relationship.
    expect(RETENTION_DEFAULT_DAYS.ai_conversation_notes).toBeLessThanOrEqual(
      RETENTION_DEFAULT_DAYS.transcripts_raw_text,
    )
  })

  it('agent_citations matches agent_events horizon (don\'t orphan citations)', () => {
    expect(RETENTION_DEFAULT_DAYS.agent_citations).toBe(
      RETENTION_DEFAULT_DAYS.agent_events,
    )
  })

  it('attributions matches outcome_events horizon (don\'t orphan attributions)', () => {
    expect(RETENTION_DEFAULT_DAYS.attributions).toBe(
      RETENTION_DEFAULT_DAYS.outcome_events,
    )
  })

  it('RETENTION_TABLE_NAMES enumerates exactly the keys of the default map', () => {
    const fromMap = Object.keys(RETENTION_DEFAULT_DAYS).sort()
    const fromList = [...RETENTION_TABLE_NAMES].sort()
    expect(fromList).toEqual(fromMap)
  })
})

describe('isRetentionTableName', () => {
  it('accepts every known table name', () => {
    for (const name of RETENTION_TABLE_NAMES) {
      expect(isRetentionTableName(name)).toBe(true)
    }
  })

  it('rejects unknown table names', () => {
    expect(isRetentionTableName('companies')).toBe(false) // not a retention target
    expect(isRetentionTableName('tenants')).toBe(false)
    expect(isRetentionTableName('signals')).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isRetentionTableName(null)).toBe(false)
    expect(isRetentionTableName(undefined)).toBe(false)
    expect(isRetentionTableName(42)).toBe(false)
    expect(isRetentionTableName({})).toBe(false)
  })
})

describe('defaultRetentionDays', () => {
  it('returns the platform default for each known table', () => {
    expect(defaultRetentionDays('agent_events')).toBe(730)
    expect(defaultRetentionDays('webhook_deliveries')).toBe(30)
    expect(defaultRetentionDays('outcome_events')).toBe(1095)
  })
})

describe('validateRetentionOverride', () => {
  it('accepts the platform default unchanged', () => {
    const r = validateRetentionOverride('agent_events', 730)
    expect(r.ok).toBe(true)
  })

  it('accepts a longer override', () => {
    const r = validateRetentionOverride('agent_events', 1000)
    expect(r.ok).toBe(true)
  })

  it('rejects a shorter override (longer-only rule per OQ-4)', () => {
    const r = validateRetentionOverride('agent_events', 365)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/may only lengthen/i)
      expect(r.reason).toContain('730')
      expect(r.reason).toContain('365')
    }
  })

  it('rejects an override above the 7-year ceiling', () => {
    const r = validateRetentionOverride(
      'agent_events',
      RETENTION_MAX_DAYS + 1,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/cannot exceed/i)
      expect(r.reason).toContain('2555')
    }
  })

  it('rejects zero / negative / non-integer values', () => {
    expect(validateRetentionOverride('agent_events', 0).ok).toBe(false)
    expect(validateRetentionOverride('agent_events', -1).ok).toBe(false)
    expect(validateRetentionOverride('agent_events', 1.5).ok).toBe(false)
    expect(
      validateRetentionOverride('agent_events', Number.NaN).ok,
    ).toBe(false)
    expect(
      validateRetentionOverride('agent_events', Number.POSITIVE_INFINITY)
        .ok,
    ).toBe(false)
  })

  it('accepts the 7-year ceiling exactly', () => {
    const r = validateRetentionOverride('agent_events', RETENTION_MAX_DAYS)
    expect(r.ok).toBe(true)
  })

  it('table-specific min applies (webhook_deliveries default is much lower)', () => {
    // webhook_deliveries default is 30. A 100-day override is a valid
    // lengthening for that table even though it'd be a SHORTENING for
    // agent_events.
    expect(validateRetentionOverride('webhook_deliveries', 100).ok).toBe(true)
    expect(validateRetentionOverride('agent_events', 100).ok).toBe(false)
  })
})
