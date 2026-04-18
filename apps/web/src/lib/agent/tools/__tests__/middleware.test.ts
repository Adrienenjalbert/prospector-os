import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  citationEnforcer,
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
      },
    })
    const decision = await writeApprovalGate.preToolUse!(writeCtx, { config: {} })
    expect(decision.allow).toBe(false)
    expect((decision.result as { awaiting_approval?: boolean }).awaiting_approval).toBe(true)
  })

  it('lets a write tool through when approval_token is present', async () => {
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
      },
    })
    const decision = await writeApprovalGate.preToolUse!(writeCtx, {
      config: {},
      approval_token: 'tok_abc',
    })
    expect(decision.allow).toBe(true)
  })
})
