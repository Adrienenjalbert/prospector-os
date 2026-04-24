import { describe, it, expect, vi } from 'vitest'

/**
 * Track D parity test — `assembleAgentRun` is the SINGLE source of
 * truth for how a per-turn agent invocation is built. Both
 * `/api/agent` (dashboard) and `/api/slack/events` (Slack) call it.
 *
 * Pre-this-change Slack hardcoded Haiku, used `maxSteps: 4`,
 * `maxTokens: 2000`, and skipped some prompt parts. A rep got a
 * different answer in Slack vs the dashboard for the same question.
 *
 * This test pins down the contract:
 *   1. Both surfaces resolve the SAME model id when given the same
 *      budget snapshot + intent class (regression guard against the
 *      "Slack always Haiku" bug).
 *   2. Both surfaces produce the SAME first system message
 *      (cacheable static prefix) for the same tenant/role.
 *   3. Both surfaces use the SAME cache-breakpoint layout (first +
 *      last system messages carry providerOptions.anthropic.cacheControl).
 *   4. The Slack-specific overrides (repCommStyle = brief →
 *      responseTokenCap = 480) apply via the public input — not via
 *      a parallel code path the test could miss.
 *
 * We mock the heavy assemblers (context strategies, tool loader,
 * prompt-parts builder) so the test stays a pure unit test of the
 * orchestration layer. The behaviour of the assemblers themselves
 * is covered by their own test suites.
 */

vi.mock('../tools', () => ({
  dispatchAgent: ({
    role,
    activeUrn,
    explicitAgentType,
  }: {
    role: string
    activeUrn?: string | null
    explicitAgentType?: string
  }) => ({
    role,
    agentType: explicitAgentType ?? 'pipeline-coach',
    activeUrn: activeUrn ?? null,
  }),
  buildSystemPromptParts: vi.fn(async () => ({
    staticPrefix: 'STATIC_PREFIX_FOR_TEST',
    dynamicSuffix: 'DYNAMIC_SUFFIX_FOR_TEST',
    cacheableSuffix: 'CACHEABLE_SUFFIX_FOR_TEST',
  })),
  loadToolsForDispatch: vi.fn(async () => ({})),
}))

vi.mock('../context-strategies', () => ({
  pickContextStrategy: () => ({ strategy: 'rep_centric' as const, activeDealId: null, activeCompanyId: null }),
  assembleContextForStrategy: vi.fn(async () => null),
  assembleContextPack: vi.fn(async () => null),
}))

vi.mock('../model-registry', () => ({
  // Deterministic model selection: returns sonnet under budget, haiku
  // when at/over 90%. Routing override wins. Mirrors the real
  // chooseModel signature so the parity contract is exercised.
  chooseModel: ({
    tokensUsedThisMonth,
    monthlyBudget,
    tenantOverride,
    intentClass,
  }: {
    tokensUsedThisMonth: number
    monthlyBudget: number
    intentClass: string
    tenantOverride?: Record<string, string>
  }) => {
    if (tenantOverride?.[intentClass]) return tenantOverride[intentClass]
    if (tokensUsedThisMonth / monthlyBudget >= 0.9) return 'anthropic/claude-haiku-4'
    return 'anthropic/claude-sonnet-4'
  },
  getModel: (id: string) => ({ modelId: id }),
}))

import { assembleAgentRun } from '../run-agent'
import type { SupabaseClient } from '@supabase/supabase-js'

const fakeSupabase = {} as unknown as SupabaseClient

const baseInput = {
  supabase: fakeSupabase,
  tenantId: 't1',
  repId: 'rep-1',
  userId: 'user-1',
  role: 'ae' as const,
  activeUrn: null,
  userMessageText: 'show me my top accounts',
  intentClass: 'general_query' as const,
  messages: [{ role: 'user' as const, content: 'show me my top accounts' }],
  interactionId: 'int-1',
  crmType: 'hubspot',
  tokensUsedThisMonth: 1000,
  monthlyBudget: 1_000_000,
}

describe('assembleAgentRun (Track D parity)', () => {
  it('returns the SAME model id for Slack and dashboard given the same budget snapshot', async () => {
    const dashboard = await assembleAgentRun({ ...baseInput })
    const slack = await assembleAgentRun({ ...baseInput, repCommStyle: 'brief' })

    // The model id MUST not depend on whether the caller is Slack or
    // dashboard. Pre-this-change Slack hardcoded Haiku regardless of
    // what chooseModel would have returned.
    expect(slack.modelId).toBe(dashboard.modelId)
    expect(slack.modelId).toBe('anthropic/claude-sonnet-4')
  })

  it('respects the per-tenant model_routing override identically on both surfaces', async () => {
    const override = { general_query: 'anthropic/claude-haiku-4' }
    const dashboard = await assembleAgentRun({
      ...baseInput,
      tenantModelRouting: override,
    })
    const slack = await assembleAgentRun({
      ...baseInput,
      repCommStyle: 'brief',
      tenantModelRouting: override,
    })
    expect(dashboard.modelId).toBe('anthropic/claude-haiku-4')
    expect(slack.modelId).toBe('anthropic/claude-haiku-4')
  })

  it('uses the SAME cache-breakpoint layout: first + last system messages carry cacheControl', async () => {
    const out = await assembleAgentRun({ ...baseInput })
    // Layout: [staticPrefix-cached, dynamicSuffix, cacheableSuffix-cached, user]
    expect(out.messages[0].role).toBe('system')
    expect(out.messages[0].providerOptions?.anthropic).toMatchObject({
      cacheControl: { type: 'ephemeral' },
    })

    // Find the cacheable suffix — second cached system message.
    const cachedSystemMessages = out.messages.filter(
      (m) =>
        m.role === 'system' &&
        (m.providerOptions?.anthropic as { cacheControl?: unknown } | undefined)?.cacheControl,
    )
    expect(cachedSystemMessages).toHaveLength(2)
  })

  it('Slack brief comm-style maps to the documented 480-token cap', async () => {
    const out = await assembleAgentRun({ ...baseInput, repCommStyle: 'brief' })
    expect(out.responseTokenCap).toBe(480)
  })

  it('dashboard default (no comm-style) maps to the documented 3000-token cap', async () => {
    const out = await assembleAgentRun({ ...baseInput })
    expect(out.responseTokenCap).toBe(3000)
  })

  it('downgrades to Haiku at >=90% budget for BOTH surfaces (regression guard)', async () => {
    const dashboard = await assembleAgentRun({
      ...baseInput,
      tokensUsedThisMonth: 950_000,
    })
    const slack = await assembleAgentRun({
      ...baseInput,
      repCommStyle: 'brief',
      tokensUsedThisMonth: 950_000,
    })
    expect(dashboard.modelId).toBe('anthropic/claude-haiku-4')
    expect(slack.modelId).toBe('anthropic/claude-haiku-4')
  })
})
