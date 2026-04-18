import { describe, expect, it } from 'vitest'
import {
  logCrmActivitySchema,
  updateCrmPropertySchema,
  createCrmTaskSchema,
  logCrmActivityHandler,
  updateCrmPropertyHandler,
  createCrmTaskHandler,
} from '../handlers/crm-write'

/**
 * Schema + registration tests for the Phase-3.6 CRM write-back tools.
 *
 * Heavy integration testing (actual HubSpot calls, supabase mocking) is
 * out of scope for unit tests — those would belong in an e2e suite
 * against a HubSpot sandbox. Here we pin:
 *
 *   - Each handler exposes the right slug.
 *   - Required Zod parameters reject missing fields.
 *   - Optional fields (approval_token, etc.) are tolerated.
 *
 * The writeApprovalGate gating is verified generically in
 * middleware.test.ts (uses a mutates_crm fixture); these tools inherit
 * that behaviour by setting `execution_config.mutates_crm = true` in
 * the tool_registry seed.
 */

describe('CRM write tool handlers — slug + schema sanity', () => {
  it('log_crm_activity exposes the expected slug', () => {
    expect(logCrmActivityHandler.slug).toBe('log_crm_activity')
  })

  it('update_crm_property exposes the expected slug', () => {
    expect(updateCrmPropertyHandler.slug).toBe('update_crm_property')
  })

  it('create_crm_task exposes the expected slug', () => {
    expect(createCrmTaskHandler.slug).toBe('create_crm_task')
  })
})

describe('logCrmActivitySchema', () => {
  it('requires target_urn, activity_type, and body', () => {
    const partial = logCrmActivitySchema.safeParse({ target_urn: 'urn:rev:deal:abc' })
    expect(partial.success).toBe(false)
  })

  it('accepts a minimal valid payload', () => {
    const ok = logCrmActivitySchema.safeParse({
      target_urn: 'urn:rev:deal:abc',
      activity_type: 'note',
      body: 'Logged from agent.',
    })
    expect(ok.success).toBe(true)
  })

  it('rejects an unknown activity_type', () => {
    const bad = logCrmActivitySchema.safeParse({
      target_urn: 'urn:rev:deal:abc',
      activity_type: 'voicemail',
      body: 'x',
    })
    expect(bad.success).toBe(false)
  })

  it('tolerates an approval_token from the [DO] chip', () => {
    const ok = logCrmActivitySchema.safeParse({
      target_urn: 'urn:rev:deal:abc',
      activity_type: 'call',
      body: 'Discovery call summary.',
      duration_minutes: 25,
      approval_token: 'tok_abc',
    })
    expect(ok.success).toBe(true)
  })
})

describe('updateCrmPropertySchema', () => {
  it('requires target_urn, property, and value', () => {
    expect(updateCrmPropertySchema.safeParse({ target_urn: 'urn:rev:deal:abc' }).success).toBe(false)
    expect(updateCrmPropertySchema.safeParse({ target_urn: 'urn:rev:deal:abc', property: 'amount' }).success).toBe(false)
  })

  it('accepts string / number / boolean / null values', () => {
    for (const v of ['Negotiation', 50000, true, null]) {
      const r = updateCrmPropertySchema.safeParse({
        target_urn: 'urn:rev:deal:abc',
        property: 'dealstage',
        value: v,
      })
      expect(r.success, `value=${JSON.stringify(v)}`).toBe(true)
    }
  })
})

describe('createCrmTaskSchema', () => {
  it('requires only subject', () => {
    expect(createCrmTaskSchema.safeParse({}).success).toBe(false)
    expect(createCrmTaskSchema.safeParse({ subject: 'Send proposal' }).success).toBe(true)
  })

  it('accepts a fully populated task with association', () => {
    const r = createCrmTaskSchema.safeParse({
      subject: 'Send Q4 proposal',
      body: 'Reference the JOLT framing from last call.',
      due_date_iso: new Date().toISOString(),
      priority: 'HIGH',
      related_to_urn: 'urn:rev:deal:abc',
      approval_token: 'tok_xyz',
    })
    expect(r.success).toBe(true)
  })

  it('rejects an invalid priority enum', () => {
    const r = createCrmTaskSchema.safeParse({
      subject: 'x',
      priority: 'CRITICAL',
    })
    expect(r.success).toBe(false)
  })
})
