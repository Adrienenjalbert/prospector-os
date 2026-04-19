import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  citationEnforcer,
  resultSizeGuard,
  writeApprovalGate,
  type ToolMiddlewareCtx,
} from '../middleware'
import type { ToolRegistryRow } from '../../tool-loader'

function noopSupabase(): SupabaseClient {
  return {
    from() {
      return {
        insert() {
          return Promise.resolve({ data: null, error: null }).then(
            (v) => v,
            (v) => v,
          )
        },
      }
    },
  } as unknown as SupabaseClient
}

function ctx(slug: string, override: Partial<ToolMiddlewareCtx> = {}): ToolMiddlewareCtx {
  const row: ToolRegistryRow = {
    slug,
    display_name: slug,
    description: '',
    available_to_roles: [],
    enabled: true,
    is_builtin: true,
    tool_type: 'builtin',
    execution_config: null,
    citation_config: null,
    deprecated_at: null,
    deprecation_replacement: null,
  }
  return {
    slug,
    tenantId: 't1',
    repId: 'r1',
    userId: 'u1',
    role: 'ae',
    activeUrn: null,
    supabase: noopSupabase(),
    registryRow: row,
    interactionId: 'i1',
    ...override,
  }
}

describe('citationEnforcer middleware', () => {
  it('passes results that do NOT use the { data, citations } shape', async () => {
    const result = { foo: 'bar' }
    const out = await citationEnforcer.postToolUse!(ctx('research_account'), null, result)
    expect(out.result).toEqual(result)
    expect(out.warnings ?? []).toHaveLength(0)
  })

  it('passes { data, citations } when citations is non-empty', async () => {
    const result = { data: [{ id: '1' }], citations: [{ source_type: 'company' }] }
    const out = await citationEnforcer.postToolUse!(ctx('research_account'), null, result)
    expect(out.result).toEqual(result)
    expect(out.warnings ?? []).toHaveLength(0)
  })

  it('annotates the result with __warning when citations is empty', async () => {
    const result = { data: [{ id: '1' }], citations: [] }
    const out = await citationEnforcer.postToolUse!(ctx('research_account'), null, result)
    expect(out.warnings).toHaveLength(1)
    expect((out.result as { __warning?: string }).__warning).toMatch(/citations/i)
  })

  it('skips enforcement for tools on the NO_CITATION_REQUIRED list', async () => {
    const result = { data: [{ id: '1' }], citations: [] }
    const out = await citationEnforcer.postToolUse!(ctx('draft_outreach'), null, result)
    expect(out.warnings ?? []).toHaveLength(0)
    expect((out.result as { __warning?: string }).__warning).toBeUndefined()
  })
})

describe('writeApprovalGate middleware', () => {
  it('allows non-write tools through unconditionally', async () => {
    const decision = await writeApprovalGate.preToolUse!(
      ctx('research_account'),
      { account_name: 'Acme' },
    )
    expect(decision.allow).toBe(true)
  })

  it('blocks a write tool without an approval_token', async () => {
    const writeCtx = ctx('apply_icp_config', {
      registryRow: {
        slug: 'apply_icp_config',
        display_name: 'Apply ICP',
        description: '',
        available_to_roles: [],
        enabled: true,
        is_builtin: true,
        tool_type: 'builtin',
        execution_config: { mutates_crm: true } as Record<string, unknown>,
        citation_config: null,
        deprecated_at: null,
        deprecation_replacement: null,
      },
    })
    const decision = await writeApprovalGate.preToolUse!(writeCtx, { config: {} })
    expect(decision.allow).toBe(false)
    expect((decision.result as { awaiting_approval?: boolean }).awaiting_approval).toBe(true)
  })

  // Phase 3 T1.1 — fail-closed regression cases.
  //
  // The previous middleware implementation accepted ANY non-empty
  // `approval_token` string as a valid approval. The handlers never
  // validated the token and the nonce table that was supposed to back
  // it was never built (audit area C, P0). The middleware now denies
  // write tools unconditionally; the staging-table flow ships in T3.1.
  // These cases pin the new contract so a future refactor cannot
  // silently restore the bypass.

  it('still denies a write tool when an approval_token is provided (T1.1)', async () => {
    const writeCtx = ctx('apply_icp_config', {
      registryRow: {
        slug: 'apply_icp_config',
        display_name: 'Apply ICP',
        description: '',
        available_to_roles: [],
        enabled: true,
        is_builtin: true,
        tool_type: 'builtin',
        execution_config: { mutates_crm: true } as Record<string, unknown>,
        citation_config: null,
        deprecated_at: null,
        deprecation_replacement: null,
      },
    })
    const decision = await writeApprovalGate.preToolUse!(writeCtx, {
      config: {},
      approval_token: 'tok_abc', // would have bypassed under the old gate
    })
    expect(decision.allow).toBe(false)
    expect(decision.reason).toBe('write_temporarily_disabled')
    expect(
      (decision.result as { awaiting_approval?: boolean }).awaiting_approval,
    ).toBe(true)
  })

  it('still denies even with a long, structured-looking token (T1.1)', async () => {
    const writeCtx = ctx('log_crm_activity', {
      registryRow: {
        slug: 'log_crm_activity',
        display_name: 'Log CRM Activity',
        description: '',
        available_to_roles: [],
        enabled: true,
        is_builtin: true,
        tool_type: 'builtin',
        execution_config: { mutates_crm: true } as Record<string, unknown>,
        citation_config: null,
        deprecated_at: null,
        deprecation_replacement: null,
      },
    })
    const decision = await writeApprovalGate.preToolUse!(writeCtx, {
      target_urn: 'urn:rev:deal:abc',
      activity_type: 'note',
      body: 'Hello',
      approval_token:
        'pending_write_3f9d2c1a-7b4e-4a8f-9c3d-1e2f3a4b5c6d-signed-by-user-uuid',
    })
    expect(decision.allow).toBe(false)
    expect(decision.reason).toBe('write_temporarily_disabled')
  })

  it('exposes the proposed_args back to the agent so the [DO] chip is informative', async () => {
    const writeCtx = ctx('update_crm_property', {
      registryRow: {
        slug: 'update_crm_property',
        display_name: 'Update CRM Property',
        description: '',
        available_to_roles: [],
        enabled: true,
        is_builtin: true,
        tool_type: 'builtin',
        execution_config: { mutates_crm: true } as Record<string, unknown>,
        citation_config: null,
        deprecated_at: null,
        deprecation_replacement: null,
      },
    })
    const args = {
      target_urn: 'urn:rev:deal:abc',
      property: 'dealstage',
      value: 'Negotiation',
    }
    const decision = await writeApprovalGate.preToolUse!(writeCtx, args)
    expect(decision.allow).toBe(false)
    expect(
      (decision.result as { proposed_args?: unknown }).proposed_args,
    ).toEqual(args)
    // The agent should be told to surface this as a [DO] chip and that
    // CRM write-back is platform-disabled — not to fake an approval token.
    expect(decision.additionalContext).toMatch(/temporarily DISABLED/i)
    expect(decision.additionalContext).toMatch(/Do NOT.*fabricated approval_token/i)
  })

  it('also denies when execution_config marks is_write instead of mutates_crm', async () => {
    const writeCtx = ctx('apply_funnel_config', {
      registryRow: {
        slug: 'apply_funnel_config',
        display_name: 'Apply Funnel',
        description: '',
        available_to_roles: [],
        enabled: true,
        is_builtin: true,
        tool_type: 'builtin',
        execution_config: { is_write: true } as Record<string, unknown>,
        citation_config: null,
        deprecated_at: null,
        deprecation_replacement: null,
      },
    })
    const decision = await writeApprovalGate.preToolUse!(writeCtx, { config: {} })
    expect(decision.allow).toBe(false)
  })
})

/**
 * The resultSizeGuard middleware is the framework-level cap on tool
 * output size. It exists because per-tool authors keep forgetting to
 * cap their list returns, and a 250-row response from one tool can
 * bury the agent's reasoning + push the behaviour rules out of the
 * model's high-attention slot. These tests pin the contract so a
 * future refactor of `findArrayField` doesn't silently widen the cap.
 */
describe('resultSizeGuard middleware', () => {
  it('passes results that have no array field unchanged', async () => {
    const result = { foo: 'bar', count: 7 }
    const out = await resultSizeGuard.postToolUse!(ctx('research_account'), null, result)
    expect(out.result).toEqual(result)
    expect(out.warnings ?? []).toHaveLength(0)
  })

  it('passes arrays at or below the cap unchanged', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `c-${i}` }))
    const result = { contacts: rows }
    const out = await resultSizeGuard.postToolUse!(ctx('find_contacts'), null, result)
    expect(out.result).toEqual(result)
    expect(out.warnings ?? []).toHaveLength(0)
  })

  it('truncates arrays over the cap and adds a quotable warning', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: `c-${i}` }))
    const result = { contacts: rows, company: 'Acme' }
    const out = await resultSizeGuard.postToolUse!(ctx('find_contacts'), null, result)
    const next = out.result as {
      contacts: unknown[]
      company: string
      _truncated_from?: number
      _truncation_warning?: string
    }
    expect(next.contacts).toHaveLength(50)
    expect(next.company).toBe('Acme')
    expect(next._truncated_from).toBe(250)
    expect(next._truncation_warning).toContain('250')
    expect(next._truncation_warning).toContain('contacts')
    expect(out.warnings).toHaveLength(1)
  })

  it('discovers the array field by common convention (rows / signals / etc.)', async () => {
    const big = Array.from({ length: 80 }, (_, i) => ({ s: i }))
    const out = await resultSizeGuard.postToolUse!(
      ctx('get_active_signals'),
      null,
      { signals: big },
    )
    const next = out.result as { signals: unknown[]; _truncated_from?: number }
    expect(next.signals).toHaveLength(50)
    expect(next._truncated_from).toBe(80)
  })

  it('does not double-truncate on a re-pass (idempotent)', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }))
    const first = await resultSizeGuard.postToolUse!(
      ctx('find_contacts'),
      null,
      { rows },
    )
    const second = await resultSizeGuard.postToolUse!(
      ctx('find_contacts'),
      null,
      first.result,
    )
    expect((second.result as { rows: unknown[] }).rows).toHaveLength(50)
  })
})
