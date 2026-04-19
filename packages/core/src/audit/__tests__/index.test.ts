import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AUDIT_MAX_JSONB_BYTES, recordAdminAction } from '../index'

/**
 * Phase 3 T2.1 — admin audit log helper. The contract is:
 *
 *   - Successful insert returns the new row id.
 *   - Failed insert returns null (warn-and-continue; never throws).
 *   - JSONB blobs over 256KB are replaced with a sentinel object
 *     so the auditor sees "we tried to record this but it was too
 *     large" rather than silent data loss.
 *
 * The helper is tiny by design — these tests pin the contract so a
 * future refactor (e.g. moving to a different audit substrate)
 * doesn't accidentally swallow errors or drop the size cap.
 */

interface CapturedInsert {
  body: Record<string, unknown>
}

function makeFakeSupabase(opts: {
  insertedId?: string
  insertError?: { message: string }
  throwOnInsert?: boolean
}): { client: SupabaseClient; capture: CapturedInsert[] } {
  const capture: CapturedInsert[] = []
  const client = {
    from(_table: string) {
      return {
        insert(body: Record<string, unknown>) {
          if (opts.throwOnInsert) {
            return {
              select() {
                return {
                  single() {
                    return Promise.reject(new Error('connection refused'))
                  },
                }
              },
            }
          }
          capture.push({ body })
          return {
            select() {
              return {
                single() {
                  if (opts.insertError) {
                    return Promise.resolve({
                      data: null,
                      error: opts.insertError,
                    })
                  }
                  return Promise.resolve({
                    data: { id: opts.insertedId ?? 'new-audit-row' },
                    error: null,
                  })
                },
              }
            },
          }
        },
      }
    },
  } as unknown as SupabaseClient
  return { client, capture }
}

describe('recordAdminAction', () => {
  it('writes the expected row shape and returns the new id', async () => {
    const { client, capture } = makeFakeSupabase({
      insertedId: 'audit-123',
    })
    const id = await recordAdminAction(client, {
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      action: 'config.upsert',
      target: 'tenants.icp_config',
      before: { dimensions: [{ name: 'industry', weight: 0.2 }] },
      after: { dimensions: [{ name: 'industry', weight: 0.3 }] },
      metadata: { request_id: 'req-abc' },
    })
    expect(id).toBe('audit-123')
    expect(capture).toHaveLength(1)
    expect(capture[0].body).toMatchObject({
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      action: 'config.upsert',
      target: 'tenants.icp_config',
    })
    // before/after preserved untouched (under cap).
    expect(capture[0].body.before).toEqual({
      dimensions: [{ name: 'industry', weight: 0.2 }],
    })
    expect(capture[0].body.after).toEqual({
      dimensions: [{ name: 'industry', weight: 0.3 }],
    })
    expect(capture[0].body.metadata).toEqual({ request_id: 'req-abc' })
  })

  it('defaults user_id to null when caller passes null (system actions)', async () => {
    const { client, capture } = makeFakeSupabase({})
    await recordAdminAction(client, {
      tenant_id: 'tenant-1',
      user_id: null,
      action: 'config.upsert',
      target: 'tenants.icp_config',
    })
    expect(capture[0].body.user_id).toBeNull()
  })

  it('defaults metadata to empty object when omitted', async () => {
    const { client, capture } = makeFakeSupabase({})
    await recordAdminAction(client, {
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      action: 'calibration.reject',
      target: 'calibration_proposals[uuid:abc]',
    })
    expect(capture[0].body.metadata).toEqual({})
  })

  it('preserves null before (insert-shaped action)', async () => {
    const { client, capture } = makeFakeSupabase({})
    await recordAdminAction(client, {
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      action: 'onboarding.apply_icp',
      target: 'tenants.icp_config',
      before: null,
      after: { fresh: 'config' },
    })
    expect(capture[0].body.before).toBeNull()
    expect(capture[0].body.after).toEqual({ fresh: 'config' })
  })

  it('preserves null after (delete- or reject-shaped action)', async () => {
    const { client, capture } = makeFakeSupabase({})
    await recordAdminAction(client, {
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      action: 'calibration.reject',
      target: 'calibration_proposals[uuid:abc]',
      before: { proposal: 'state' },
      after: null,
    })
    expect(capture[0].body.before).toEqual({ proposal: 'state' })
    expect(capture[0].body.after).toBeNull()
  })

  it('truncates oversized before/after to a sentinel object', async () => {
    const { client, capture } = makeFakeSupabase({})
    // Construct a payload comfortably over the 256KB cap.
    const huge = { blob: 'x'.repeat(AUDIT_MAX_JSONB_BYTES + 100) }
    await recordAdminAction(client, {
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      action: 'config.upsert',
      target: 'tenants.scoring_config',
      before: huge,
      after: { small: 'enough' },
    })
    expect(capture[0].body.before).toEqual({
      __truncated: true,
      __original_size_bytes: expect.any(Number),
      __cap_bytes: AUDIT_MAX_JSONB_BYTES,
    })
    // after stays intact (small).
    expect(capture[0].body.after).toEqual({ small: 'enough' })
  })

  it('returns null on supabase error (warn-and-continue contract)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client } = makeFakeSupabase({
      insertError: { message: 'permission denied' },
    })
    const id = await recordAdminAction(client, {
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      action: 'config.upsert',
      target: 'tenants.icp_config',
    })
    expect(id).toBeNull()
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls[0][0]).toMatch(/audit.*insert failed/i)
    warn.mockRestore()
  })

  it('returns null on supabase throw (no propagation up the stack)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client } = makeFakeSupabase({ throwOnInsert: true })
    const id = await recordAdminAction(client, {
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      action: 'config.upsert',
      target: 'tenants.icp_config',
    })
    expect(id).toBeNull()
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls[0][0]).toMatch(/audit.*insert threw/i)
    warn.mockRestore()
  })

  it('handles unserialisable values without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, capture } = makeFakeSupabase({})
    // A circular reference — JSON.stringify throws.
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    await recordAdminAction(client, {
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      action: 'config.upsert',
      target: 'tenants.icp_config',
      before: circular,
      after: { ok: true },
    })
    // capJsonb traps the JSON.stringify error and returns the
    // serialise_error sentinel — the underlying insert still goes
    // through.
    expect(capture).toHaveLength(1)
    expect(capture[0].body.before).toEqual({
      __serialise_error: expect.any(String),
    })
    warn.mockRestore()
  })
})

describe('AUDIT_MAX_JSONB_BYTES', () => {
  it('matches the admin-config payload cap (256KB)', () => {
    expect(AUDIT_MAX_JSONB_BYTES).toBe(256 * 1024)
  })
})
