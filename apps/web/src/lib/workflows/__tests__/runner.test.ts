import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyError, StepShapeError, startWorkflow } from '../runner'

describe('classifyError', () => {
  it('classifies 401 / 403 / unauthorized / invalid_token as fatal', () => {
    expect(classifyError(new Error('401 Unauthorized'))).toBe('fatal')
    expect(classifyError(new Error('403 Forbidden'))).toBe('fatal')
    expect(classifyError(new Error('Authentication failed'))).toBe('fatal')
    expect(classifyError(new Error('invalid_token'))).toBe('fatal')
    expect(classifyError(new Error('Permission denied'))).toBe('fatal')
    expect(classifyError(new Error('Apollo credit balance exhausted'))).toBe('fatal')
  })

  it('classifies 429 / 5xx / network errors as transient', () => {
    expect(classifyError(new Error('429 Too Many Requests'))).toBe('transient')
    expect(classifyError(new Error('502 Bad Gateway'))).toBe('transient')
    expect(classifyError(new Error('503 Service Unavailable'))).toBe('transient')
    expect(classifyError(new Error('504 Gateway Timeout'))).toBe('transient')
    expect(classifyError(new Error('Request timeout'))).toBe('transient')
    expect(classifyError(new Error('ECONNRESET'))).toBe('transient')
    expect(classifyError(new Error('Network error'))).toBe('transient')
  })

  it('treats StepShapeError as fatal regardless of message', () => {
    expect(
      classifyError(new StepShapeError('my_step', [], 'unexpected shape')),
    ).toBe('fatal')
  })

  it('falls back to unknown for unrecognised errors', () => {
    expect(classifyError(new Error('Some random failure'))).toBe('unknown')
    expect(classifyError('a string')).toBe('unknown')
    expect(classifyError(null)).toBe('unknown')
  })

  it('FATAL wins when both fatal and transient patterns match', () => {
    // "401 ... timeout" — auth issue + timeout. Should be FATAL because
    // retry on auth issue is pointless.
    expect(classifyError(new Error('401 timeout while authenticating'))).toBe('fatal')
  })
})

// Builds a minimal chain-able Supabase mock for the .from(...).select(...).
// .eq(...).eq(...).maybeSingle() pattern used by startWorkflow's dedupe
// lookup, plus a passing insert path. We capture every .eq() and .is()
// call so the test can assert tenant_id was scoped correctly.
function makeSupabaseMock(opts: {
  existingRow: Record<string, unknown> | null
  insertResult?: Record<string, unknown>
}) {
  const eqCalls: { col: string; val: unknown }[] = []
  const isCalls: { col: string; val: unknown }[] = []
  const fromCalls: string[] = []

  const insertResultRow = opts.insertResult ?? {
    id: 'new-run',
    tenant_id: 'tenant-A',
    workflow_name: 'test',
    idempotency_key: 'k',
    status: 'pending',
  }

  const insertChain = {
    select: () => ({
      single: () => Promise.resolve({ data: insertResultRow, error: null }),
    }),
  }

  const lookupChain = {
    eq: (col: string, val: unknown) => {
      eqCalls.push({ col, val })
      return lookupChain
    },
    is: (col: string, val: unknown) => {
      isCalls.push({ col, val })
      return lookupChain
    },
    maybeSingle: () => Promise.resolve({ data: opts.existingRow, error: null }),
  }

  const fromMock = (name: string) => {
    fromCalls.push(name)
    return {
      select: () => lookupChain,
      insert: () => insertChain,
    }
  }

  return {
    supabase: { from: vi.fn(fromMock) } as unknown as SupabaseClient,
    eqCalls,
    isCalls,
    fromCalls,
  }
}

describe('startWorkflow tenant-scoped idempotency', () => {
  it('scopes the dedupe lookup to the calling tenant_id', async () => {
    const { supabase, eqCalls } = makeSupabaseMock({ existingRow: null })

    await startWorkflow(supabase, {
      tenantId: 'tenant-A',
      workflowName: 'test_wf',
      idempotencyKey: 'shared-key',
    })

    expect(eqCalls).toContainEqual({ col: 'workflow_name', val: 'test_wf' })
    expect(eqCalls).toContainEqual({ col: 'idempotency_key', val: 'shared-key' })
    // The critical assertion: the dedupe lookup must include tenant_id,
    // otherwise a key collision in another tenant returns the wrong row.
    expect(eqCalls).toContainEqual({ col: 'tenant_id', val: 'tenant-A' })
  })

  it('returns the existing row only when tenant_id matches', async () => {
    const existing = {
      id: 'run-A',
      tenant_id: 'tenant-A',
      workflow_name: 'test_wf',
      idempotency_key: 'shared-key',
      status: 'pending',
    }
    const { supabase, eqCalls } = makeSupabaseMock({ existingRow: existing })

    const result = await startWorkflow(supabase, {
      tenantId: 'tenant-A',
      workflowName: 'test_wf',
      idempotencyKey: 'shared-key',
    })

    expect(result.id).toBe('run-A')
    // Tenant scope present on the lookup, so a same-key run in tenant-B
    // would not have matched in the first place.
    expect(eqCalls).toContainEqual({ col: 'tenant_id', val: 'tenant-A' })
  })

  it('uses .is(tenant_id, null) when called with a null tenant', async () => {
    const { supabase, isCalls, eqCalls } = makeSupabaseMock({ existingRow: null })

    await startWorkflow(supabase, {
      tenantId: null,
      workflowName: 'platform_wf',
      idempotencyKey: 'admin-key',
    })

    expect(isCalls).toContainEqual({ col: 'tenant_id', val: null })
    // And we must NOT have done .eq('tenant_id', null) which would
    // silently return zero rows because Postgres treats NULL = NULL as
    // unknown, not true.
    expect(eqCalls.find((c) => c.col === 'tenant_id')).toBeUndefined()
  })

  it('skips the dedupe lookup entirely when no idempotency key is given', async () => {
    const { supabase, eqCalls, isCalls, fromCalls } = makeSupabaseMock({ existingRow: null })

    await startWorkflow(supabase, {
      tenantId: 'tenant-A',
      workflowName: 'test_wf',
    })

    // Only the insert path runs — no .eq/.is calls on a select chain.
    expect(eqCalls).toEqual([])
    expect(isCalls).toEqual([])
    expect(fromCalls.filter((n) => n === 'workflow_runs').length).toBeGreaterThan(0)
  })
})
