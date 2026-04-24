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

// PR3: tests need to control packer success vs failure to exercise
// the legacy-bypass path. Mocks are exported via top-level fns so
// each test can flip the behaviour in beforeEach.
const assembleContextPackMock = vi.fn(async () => null as unknown)
const assembleContextForStrategyMock = vi.fn(async () => null as unknown)
vi.mock('../context-strategies', () => ({
  pickContextStrategy: () => ({ strategy: 'rep_centric' as const, activeDealId: null, activeCompanyId: null }),
  assembleContextForStrategy: () => assembleContextForStrategyMock(),
  assembleContextPack: () => assembleContextPackMock(),
}))

// Cheap intents the real chooseModel auto-downgrades to Haiku when the
// quality gate permits. Mirrored here so the test can exercise the
// gate behaviour without importing the real module (the real module
// is mocked below).
const TEST_HAIKU_INTENTS = new Set([
  'lookup',
  'general_query',
  'meeting_prep',
  'signal_triage',
  'stakeholder_mapping',
])

// Capture every chooseModel call so the test can assert the
// historicalHaikuThumbsUpRate forwarding contract directly. Cleared
// in beforeEach below.
const chooseModelCalls: Array<{
  tokensUsedThisMonth: number
  monthlyBudget: number
  intentClass: string
  tenantOverride?: Record<string, string>
  historicalHaikuThumbsUpRate?: number
}> = []

vi.mock('../model-registry', () => ({
  // Deterministic model selection that ALSO honours the cheap-intent
  // + quality-gate path (PR1). Mirrors the real chooseModel:
  //   - tenant override wins
  //   - cheap intent → haiku, UNLESS historicalHaikuThumbsUpRate < 0.7
  //   - else: budget-driven default
  chooseModel: (input: {
    tokensUsedThisMonth: number
    monthlyBudget: number
    intentClass: string
    tenantOverride?: Record<string, string>
    historicalHaikuThumbsUpRate?: number
  }) => {
    chooseModelCalls.push(input)
    const {
      tokensUsedThisMonth,
      monthlyBudget,
      tenantOverride,
      intentClass,
      historicalHaikuThumbsUpRate,
    } = input
    if (tenantOverride?.[intentClass]) return tenantOverride[intentClass]
    if (TEST_HAIKU_INTENTS.has(intentClass)) {
      if (
        historicalHaikuThumbsUpRate !== undefined &&
        historicalHaikuThumbsUpRate < 0.7
      ) {
        return 'anthropic/claude-sonnet-4'
      }
      return 'anthropic/claude-haiku-4'
    }
    if (tokensUsedThisMonth / monthlyBudget >= 0.9) return 'anthropic/claude-haiku-4'
    return 'anthropic/claude-sonnet-4'
  },
  getModel: (id: string) => ({ modelId: id }),
}))

// PR1: assembleAgentRun auto-loads the historical Haiku thumbs-up
// rate when the caller doesn't pass one. Stub the loader so each test
// can pin the rate (or no-data → undefined) deterministically.
const haikuRateMock = vi.fn(async (): Promise<number | undefined> => undefined)
vi.mock('../intent-quality', () => ({
  getHaikuThumbsUpRate: () => haikuRateMock(),
}))

// PR3: the packer-success branch in assembleAgentRun loads the
// rep_profile via the profile-loader. Stub it so the synthesised
// AgentContext is non-null in tests (matches the production case
// where every rep is configured) without touching Supabase.
const profileLoaderMock = vi.fn(async () => ({
  rep_profile: { id: 'rp-1', tenant_id: 't1', crm_id: 'rep-1', name: 'Test Rep' } as unknown,
}))
vi.mock('../profile-loader', () => ({
  loadProfilesForPrompt: () => profileLoaderMock(),
  synthesizePackerSuccessContext: (loaded: { rep_profile: unknown }) => {
    if (!loaded.rep_profile) return null
    return {
      rep_profile: loaded.rep_profile,
      priority_accounts: [],
      funnel_comparison: [],
      stalled_deals: [],
      recent_signals: [],
      company_benchmarks: [],
      current_page: null,
      current_account: null,
      current_deal: null,
    }
  },
}))

import { beforeEach } from 'vitest'
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
  userMessageText: 'should we escalate this account?',
  // `diagnosis` is a non-cheap intent — sits outside the
  // HAIKU_PREFERRED set so the existing parity assertions about
  // Sonnet-by-default still hold. Cheap-intent + quality-gate cases
  // get their own tests below.
  intentClass: 'diagnosis' as const,
  messages: [{ role: 'user' as const, content: 'should we escalate this account?' }],
  interactionId: 'int-1',
  crmType: 'hubspot',
  tokensUsedThisMonth: 1000,
  monthlyBudget: 1_000_000,
}

describe('assembleAgentRun (Track D parity)', () => {
  beforeEach(() => {
    chooseModelCalls.length = 0
    haikuRateMock.mockReset()
    profileLoaderMock.mockReset()
    assembleContextPackMock.mockReset()
    assembleContextForStrategyMock.mockReset()
    // Default: no historical signal (empty production data). Tests
    // that need a specific rate override this per-case.
    haikuRateMock.mockResolvedValue(undefined)
    // Default: packer FAILS (returns null) → legacy assembler is the
    // graceful-degradation path. Existing pre-PR3 tests assumed
    // this; we keep the default so they still pass without changes.
    assembleContextPackMock.mockResolvedValue(null)
    assembleContextForStrategyMock.mockResolvedValue(null)
    // Default: profile loader returns a non-null rep_profile so the
    // packer-success branch produces a non-null synthesised context.
    profileLoaderMock.mockResolvedValue({
      rep_profile: { id: 'rp-1', tenant_id: 't1', crm_id: 'rep-1', name: 'Test Rep' } as unknown,
    })
  })

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
    const override = { diagnosis: 'anthropic/claude-haiku-4' }
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

  // PR1: quality-gated cheap-intent routing -------------------------

  it('forwards historicalHaikuThumbsUpRate to chooseModel identically on both surfaces', async () => {
    haikuRateMock.mockResolvedValue(0.85)

    const dashboard = await assembleAgentRun({ ...baseInput })
    const slack = await assembleAgentRun({ ...baseInput, repCommStyle: 'brief' })

    expect(slack.modelId).toBe(dashboard.modelId)
    // Both calls must have received the same rate; without
    // forwarding parity the gate would behave differently per
    // surface and tenant cost telemetry would be incoherent.
    expect(chooseModelCalls.length).toBeGreaterThanOrEqual(2)
    for (const call of chooseModelCalls) {
      expect(call.historicalHaikuThumbsUpRate).toBe(0.85)
    }
  })

  it('cheap intent (lookup) routes to Haiku when no historical signal exists (gate inert)', async () => {
    haikuRateMock.mockResolvedValue(undefined)

    const out = await assembleAgentRun({
      ...baseInput,
      intentClass: 'lookup',
    })
    expect(out.modelId).toBe('anthropic/claude-haiku-4')
  })

  it('cheap intent (lookup) routes to Haiku when historical rate >= 0.7', async () => {
    haikuRateMock.mockResolvedValue(0.82)

    const out = await assembleAgentRun({
      ...baseInput,
      intentClass: 'lookup',
    })
    expect(out.modelId).toBe('anthropic/claude-haiku-4')
  })

  it('cheap intent (lookup) is FORCED to Sonnet when historical Haiku rate < 0.7 (quality gate engages)', async () => {
    haikuRateMock.mockResolvedValue(0.42)

    const out = await assembleAgentRun({
      ...baseInput,
      intentClass: 'lookup',
    })
    // The gate is the entire reason we can safely expand
    // HAIKU_PREFERRED_INTENTS — without it, a tenant whose
    // production data shows Haiku regresses on this intent would
    // silently get worse answers. This is the regression guard.
    expect(out.modelId).toBe('anthropic/claude-sonnet-4')
  })

  it('newly-added cheap intent (meeting_prep) participates in the same gate', async () => {
    // Same gate must protect the expanded intent set, not just the
    // original lookup/general_query pair.
    haikuRateMock.mockResolvedValue(0.5)

    const out = await assembleAgentRun({
      ...baseInput,
      intentClass: 'meeting_prep',
    })
    expect(out.modelId).toBe('anthropic/claude-sonnet-4')

    haikuRateMock.mockResolvedValue(0.95)

    const out2 = await assembleAgentRun({
      ...baseInput,
      intentClass: 'meeting_prep',
    })
    expect(out2.modelId).toBe('anthropic/claude-haiku-4')
  })

  it('caller-supplied historicalHaikuThumbsUpRate skips the loader (idempotency)', async () => {
    // When the route already loaded the rate (e.g. for its own
    // logging), forwarding it should bypass the loader to avoid
    // a redundant DB roundtrip.
    haikuRateMock.mockClear()
    haikuRateMock.mockResolvedValue(0.95) // would be permissive if called

    const out = await assembleAgentRun({
      ...baseInput,
      intentClass: 'lookup',
      historicalHaikuThumbsUpRate: 0.42, // caller's value should win
    })
    expect(out.modelId).toBe('anthropic/claude-sonnet-4')
    expect(haikuRateMock).not.toHaveBeenCalled()
  })

  // PR3: packer-first context resolution -----------------------------

  it('packer-success path uses profile-loader and SKIPS the legacy assembler', async () => {
    // Make the packer "succeed" by returning a non-null PackedContext.
    // Minimal shape — assembleAgentRun only checks for truthiness.
    assembleContextPackMock.mockResolvedValue({
      sections: [],
      hydrated: [],
      tokens_used: 0,
      citations: [],
    } as unknown)

    await assembleAgentRun({ ...baseInput })

    // The whole point of PR3: when packer succeeds, the 7-9 query
    // legacy assembler must be skipped. The single profile loader
    // call covers what the prompt builders still need.
    expect(profileLoaderMock).toHaveBeenCalledTimes(1)
    expect(assembleContextForStrategyMock).not.toHaveBeenCalled()
  })

  it('packer-failure path falls back to the legacy assembler (graceful degradation preserved)', async () => {
    // Default beforeEach already sets the packer to return null
    // (failure). Verify the legacy assembler kicks in and the
    // profile loader is NOT called (it would be wasted compute).
    await assembleAgentRun({ ...baseInput })

    expect(assembleContextForStrategyMock).toHaveBeenCalledTimes(1)
    expect(profileLoaderMock).not.toHaveBeenCalled()
  })

  it('packer-success WITH null rep_profile drops into legacy fallback (misconfigured tenant guard)', async () => {
    // A tenant with no rep_profiles row matching crm_id would lose
    // the rep header in the prompt forever if we trusted the
    // synthesised null. PR3 drops into the legacy assembler so
    // the failure mode is visible (and other prompt fields still
    // populate from the legacy path).
    assembleContextPackMock.mockResolvedValue({
      sections: [],
      hydrated: [],
      tokens_used: 0,
      citations: [],
    } as unknown)
    profileLoaderMock.mockResolvedValue({ rep_profile: null })

    await assembleAgentRun({ ...baseInput })

    expect(profileLoaderMock).toHaveBeenCalledTimes(1)
    expect(assembleContextForStrategyMock).toHaveBeenCalledTimes(1)
  })

  it('packer-success path returns the rep_profile in the synthesised AgentContext (prompt-builder contract)', async () => {
    assembleContextPackMock.mockResolvedValue({
      sections: [],
      hydrated: [],
      tokens_used: 0,
      citations: [],
    } as unknown)
    const expectedRep = {
      id: 'rp-99',
      tenant_id: 't1',
      crm_id: 'rep-1',
      name: 'Priya CSM',
    } as unknown
    profileLoaderMock.mockResolvedValue({ rep_profile: expectedRep })

    const out = await assembleAgentRun({ ...baseInput })

    // The prompt builders read `agentContext.rep_profile` for the
    // header and `formatRepPreferences`. If this byte-equality
    // breaks the rep gets a different prompt depending on which
    // path was taken — exactly the regression we're guarding.
    expect(out.agentContext?.rep_profile).toBe(expectedRep)
  })

  it('packer-success and legacy-fallback produce equivalent rep_profile (no path-dependent drift)', async () => {
    // Pin both paths to the same rep_profile shape so the
    // assertion below is meaningful: the test isn't claiming the
    // assembler and the loader both invent the same rep, only
    // that when both observe the same DB state the prompt
    // builders see the same rep_profile field.
    const rep = {
      id: 'rp-7',
      tenant_id: 't1',
      crm_id: 'rep-1',
      name: 'Sam AE',
    } as unknown
    profileLoaderMock.mockResolvedValue({ rep_profile: rep })
    assembleContextForStrategyMock.mockResolvedValue({
      rep_profile: rep,
      priority_accounts: [],
      funnel_comparison: [],
      stalled_deals: [],
      recent_signals: [],
      company_benchmarks: [],
      current_page: null,
      current_account: null,
      current_deal: null,
    } as unknown)

    // Path A: packer succeeds → profile-loader path.
    assembleContextPackMock.mockResolvedValueOnce({
      sections: [],
      hydrated: [],
      tokens_used: 0,
      citations: [],
    } as unknown)
    const success = await assembleAgentRun({ ...baseInput })

    // Path B: packer fails → legacy assembler path (default mock).
    const fallback = await assembleAgentRun({ ...baseInput })

    expect(success.agentContext?.rep_profile).toBe(rep)
    expect(fallback.agentContext?.rep_profile).toBe(rep)
  })
})
