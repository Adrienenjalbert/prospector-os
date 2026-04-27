import { describe, it, expect } from 'vitest'
import { selectSlices } from '../selector'
import type { ContextSelectorInput } from '../types'

/**
 * Pin the contract: `tenant_overrides.allow` is a HARD whitelist.
 *
 * Pre-fix, a tenant with `allow: ['priority-accounts']` still saw every
 * other matching slice load — the override only added a +1 score bump,
 * so high-scoring slices like `funnel-comparison` snuck in. The
 * documented behaviour ("ignores any slug not in the list") was a lie.
 *
 * These tests would have caught the regression: with `allow` set to a
 * single slug, the selector must return at most that slug + any pinned
 * slugs, regardless of how many other slices score positively.
 */

function makeInput(
  overrides: Partial<ContextSelectorInput> = {},
): ContextSelectorInput {
  return {
    role: 'ae',
    activeObject: 'none',
    activeUrn: null,
    dealStage: 'discovery',
    isStalled: false,
    signalTypes: [],
    intentClass: 'diagnosis',
    urgencyScore: 0,
    token_budget: 5000,
    ...overrides,
  }
}

describe('selectSlices — tenant_overrides.allow', () => {
  it('without overrides loads many slices', () => {
    const result = selectSlices(makeInput())
    expect(result.slugs.length).toBeGreaterThan(2)
  })

  it('with allow=[one-slug] loads at most that slug', () => {
    const result = selectSlices(
      makeInput({
        tenant_overrides: { allow: ['priority-accounts'] },
      }),
    )
    expect(result.slugs).toEqual(['priority-accounts'])
  })

  it('allow + pinned both pass through', () => {
    const result = selectSlices(
      makeInput({
        tenant_overrides: {
          allow: ['priority-accounts'],
          pinned: ['conversation-memory'],
        },
      }),
    )
    expect(result.slugs).toContain('priority-accounts')
    expect(result.slugs).toContain('conversation-memory')
  })

  it('allow=[] excludes everything (degenerate but explicit)', () => {
    const result = selectSlices(
      makeInput({
        tenant_overrides: { allow: [] },
      }),
    )
    expect(result.slugs).toEqual([])
  })

  it('non-matching allow slug yields empty selection (no fallthrough)', () => {
    const result = selectSlices(
      makeInput({
        tenant_overrides: { allow: ['does-not-exist'] },
      }),
    )
    expect(result.slugs).toEqual([])
  })
})
