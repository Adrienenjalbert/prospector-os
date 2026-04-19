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

describe('writeApprovalGate middleware (Phase 3 T3.1 — repurposed)', () => {
  /**
   * Contract change in T3.1:
   *
   *   - `mutates_crm` is no longer the gate. The crm-write tools
   *     (log_crm_activity / update_crm_property / create_crm_task)
   *     now STAGE rows in `pending_crm_writes` and let the
   *     /api/agent/approve endpoint perform the actual mutation.
   *     They do NOT need a pre-flight gate anymore.
   *
   *   - The middleware is REPURPOSED to opt-in: a tool whose
   *     execution_config has `requires_staging: true` (or the older
   *     alias `legacy_approval_gate: true`) gets blocked with the
   *     `awaiting_approval` shape. New tier-2 tools that haven't
   *     adopted staging yet land in this bucket.
   *
   *   - `mutates_crm: true` alone is no longer enough to gate. A tool
   *     that ships with `mutates_crm: true` but no `requires_staging`
   *     runs through the gate as if it were any other tool. (The
   *     intent is that the tool author HAS implemented staging in
   *     the handler — we trust the handler.)
   */

  it('allows non-write tools through unconditionally', async () => {
    const decision = await writeApprovalGate.preToolUse!(
      ctx('research_account'),
      { account_name: 'Acme' },
    )
    expect(decision.allow).toBe(true)
  })

  it('allows a tool with mutates_crm: true but no staging gate (post-T3.1 default)', async () => {
    // The crm-write tools land here after T3.1: their handlers
    // self-stage. The middleware no longer blocks them.
    const writeCtx = ctx('log_crm_activity', {
      registryRow: {
        slug: 'log_crm_activity',
        display_name: 'Log CRM Activity',
        description: '',
        available_to_roles: [],
        enabled: true,
        is_builtin: true,
        tool_type: 'builtin',
        execution_config: { stages_crm: true } as Record<string, unknown>,
        citation_config: null,
        deprecated_at: null,
        deprecation_replacement: null,
      },
    })
    const decision = await writeApprovalGate.preToolUse!(writeCtx, {
      target_urn: 'urn:rev:deal:abc',
      activity_type: 'note',
      body: 'test',
    })
    expect(decision.allow).toBe(true)
  })

  it('blocks a tool with requires_staging: true (legacy gate opt-in)', async () => {
    const writeCtx = ctx('future_tier2_tool', {
      registryRow: {
        slug: 'future_tier2_tool',
        display_name: 'Future Tier 2',
        description: '',
        available_to_roles: [],
        enabled: true,
        is_builtin: true,
        tool_type: 'builtin',
        execution_config: { requires_staging: true } as Record<string, unknown>,
        citation_config: null,
        deprecated_at: null,
        deprecation_replacement: null,
      },
    })
    const decision = await writeApprovalGate.preToolUse!(writeCtx, {})
    expect(decision.allow).toBe(false)
    expect((decision.result as { awaiting_approval?: boolean }).awaiting_approval).toBe(true)
    expect(decision.reason).toBe('write_requires_staging')
  })

  it('blocks a tool with the legacy_approval_gate alias', async () => {
    const writeCtx = ctx('legacy_tool', {
      registryRow: {
        slug: 'legacy_tool',
        display_name: 'Legacy Tool',
        description: '',
        available_to_roles: [],
        enabled: true,
        is_builtin: true,
        tool_type: 'builtin',
        execution_config: { legacy_approval_gate: true } as Record<string, unknown>,
        citation_config: null,
        deprecated_at: null,
        deprecation_replacement: null,
      },
    })
    const decision = await writeApprovalGate.preToolUse!(writeCtx, {})
    expect(decision.allow).toBe(false)
  })

  it('ignores approval_token entirely (it is no longer the auth surface)', async () => {
    // T3.1 explicitly removes the approval_token mechanism.
    // Passing one to a non-staging-aware tool with the legacy gate
    // does NOT bypass the gate — the staging table is the only
    // approval surface.
    const writeCtx = ctx('legacy_tool', {
      registryRow: {
        slug: 'legacy_tool',
        display_name: 'Legacy Tool',
        description: '',
        available_to_roles: [],
        enabled: true,
        is_builtin: true,
        tool_type: 'builtin',
        execution_config: { requires_staging: true } as Record<string, unknown>,
        citation_config: null,
        deprecated_at: null,
        deprecation_replacement: null,
      },
    })
    const decision = await writeApprovalGate.preToolUse!(writeCtx, {
      approval_token: 'tok_abc_forged',
    })
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
