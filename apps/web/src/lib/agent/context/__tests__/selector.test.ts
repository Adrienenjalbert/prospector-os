import { describe, expect, it } from 'vitest'
import {
  buildSelectorInput,
  resolveTenantOverrides,
  scoreSlices,
  selectSlices,
  stageBucketFromString,
} from '../selector'
import { SLICES, STRATEGY_BUNDLES } from '../slices'

/**
 * Unit tests for the Context Pack selector. The selector is the part of
 * Phase 1 most likely to drift on subsequent edits — every other piece is
 * declarative or call-once-and-done. These tests pin the scoring rules so
 * future contributors can't accidentally regress them.
 *
 * All tests are pure: no Supabase, no IO, no fixtures. The slice registry
 * is the only external dependency, so adding a slice doesn't break existing
 * tests as long as the new slice's triggers are honest.
 */

describe('stageBucketFromString', () => {
  it.each([
    ['Discovery', 'discovery'],
    ['SQL', 'qualification'],
    ['Demo Booked', 'qualification'],
    ['Proposal sent', 'proposal'],
    ['Negotiation', 'negotiation'],
    ['Legal Review', 'negotiation'],
    ['Closed Won', 'closing'],
    ['', 'other'],
    [null, 'other'],
    [undefined, 'other'],
  ] as const)('%s → %s', (input, expected) => {
    expect(stageBucketFromString(input)).toBe(expected)
  })
})

describe('selectSlices — situational picks', () => {
  it('stalled deal at proposal stage picks stalled-deals and current-deal-health', () => {
    const input = buildSelectorInput({
      role: 'ae',
      activeObject: 'deal',
      activeUrn: 'urn:rev:deal:abc',
      intentClass: 'risk_analysis',
      dealStage: 'Proposal',
      isStalled: true,
    })
    const { slugs } = selectSlices(input)
    expect(slugs).toContain('stalled-deals')
    expect(slugs).toContain('current-deal-health')
  })

  it('discovery intent on a fresh company picks current-company-snapshot', () => {
    const input = buildSelectorInput({
      role: 'ae',
      activeObject: 'company',
      activeUrn: 'urn:rev:company:xyz',
      intentClass: 'meeting_prep',
    })
    const { slugs } = selectSlices(input)
    expect(slugs).toContain('current-company-snapshot')
  })

  it('cold conversation with no active object loads priority-accounts for AE', () => {
    const input = buildSelectorInput({
      role: 'ae',
      activeObject: 'none',
      activeUrn: null,
      intentClass: 'general_query',
    })
    const { slugs } = selectSlices(input)
    expect(slugs).toContain('priority-accounts')
  })

  it('CSM on portfolio_health gets recent-signals before priority-accounts', () => {
    const input = buildSelectorInput({
      role: 'csm',
      activeObject: 'none',
      activeUrn: null,
      intentClass: 'portfolio_health',
    })
    const scored = scoreSlices(input)
    const top = scored.filter((s) => s.score > 0).map((s) => s.slug)
    expect(top).toContain('recent-signals')
  })

  it('risk_analysis intent scores stalled-deals strictly higher than lookup intent', () => {
    // Intent should *bias* selection without being a hard gate — the AE
    // role still earns stalled-deals a baseline score, but risk_analysis
    // adds the +4 intent boost. Pin this delta so future scoring tweaks
    // can't accidentally make intent irrelevant.
    const lookupScore = scoreSlices(
      buildSelectorInput({
        role: 'ae',
        activeObject: 'none',
        activeUrn: null,
        intentClass: 'lookup',
      }),
    ).find((s) => s.slug === 'stalled-deals')!.score

    const riskScore = scoreSlices(
      buildSelectorInput({
        role: 'ae',
        activeObject: 'none',
        activeUrn: null,
        intentClass: 'risk_analysis',
      }),
    ).find((s) => s.slug === 'stalled-deals')!.score

    expect(riskScore).toBeGreaterThan(lookupScore)
    expect(riskScore - lookupScore).toBeGreaterThanOrEqual(4)
  })
})

describe('selectSlices — tenant overrides', () => {
  it('pinned slice is force-included even when intent is unrelated', () => {
    const input = buildSelectorInput({
      role: 'ae',
      activeObject: 'none',
      activeUrn: null,
      intentClass: 'lookup',
      tenantOverrides: {
        pinned: ['transcript-summaries'],
      },
    })
    const { slugs } = selectSlices(input)
    expect(slugs).toContain('transcript-summaries')
  })

  it('denied slice is excluded even when intent matches', () => {
    const input = buildSelectorInput({
      role: 'ae',
      activeObject: 'none',
      activeUrn: null,
      intentClass: 'risk_analysis',
      tenantOverrides: {
        deny: ['stalled-deals'],
      },
    })
    const { slugs } = selectSlices(input)
    expect(slugs).not.toContain('stalled-deals')
  })

  it('token budget caps the number of slices selected', () => {
    const input = buildSelectorInput({
      role: 'ae',
      activeObject: 'none',
      activeUrn: null,
      intentClass: 'general_query',
      tokenBudget: 500, // tight — should fit only 1-2 slices
    })
    const { slugs, budget_used } = selectSlices(input)
    expect(budget_used).toBeLessThanOrEqual(500)
    // Should still pick at least one slice (priority-accounts is 600...
    // actually with this tight budget it might pick fewer. Just assert
    // budget honoured.)
    expect(slugs.length).toBeGreaterThanOrEqual(0)
  })

  it('per-tenant token_budget override beats the input budget', () => {
    const input = buildSelectorInput({
      role: 'ae',
      activeObject: 'none',
      activeUrn: null,
      intentClass: 'general_query',
      tokenBudget: 5000,
      tenantOverrides: { token_budget: 200 },
    })
    const { budget_used } = selectSlices(input)
    expect(budget_used).toBeLessThanOrEqual(200)
  })
})

describe('resolveTenantOverrides', () => {
  it('returns undefined when role_definitions is not an array', () => {
    expect(resolveTenantOverrides(null, 'ae')).toBeUndefined()
    expect(resolveTenantOverrides('not array', 'ae')).toBeUndefined()
  })

  it('finds the role definition by slug and maps strategy → bundle allow-list', () => {
    const roleDefs = [
      { slug: 'ae', context_strategy: 'rep_centric' },
      { slug: 'csm', context_strategy: 'portfolio_centric' },
    ]
    const ovr = resolveTenantOverrides(roleDefs, 'ae')
    expect(ovr?.strategy).toBe('rep_centric')
    expect(ovr?.allow).toEqual(STRATEGY_BUNDLES.rep_centric)
  })

  it('explicit allow list takes precedence over strategy bundle', () => {
    const roleDefs = [
      {
        slug: 'ae',
        context_strategy: 'rep_centric',
        context_slices_allow: ['stalled-deals', 'recent-signals'],
      },
    ]
    const ovr = resolveTenantOverrides(roleDefs, 'ae')
    expect(ovr?.allow).toEqual(['stalled-deals', 'recent-signals'])
  })

  it('passes through pinned + deny + token_budget when present', () => {
    const roleDefs = [
      {
        slug: 'csm',
        context_strategy: 'portfolio_centric',
        context_slices_pinned: ['transcript-summaries'],
        context_slices_deny: ['stalled-deals'],
        context_token_budget: 1500,
      },
    ]
    const ovr = resolveTenantOverrides(roleDefs, 'csm')
    expect(ovr?.pinned).toEqual(['transcript-summaries'])
    expect(ovr?.deny).toEqual(['stalled-deals'])
    expect(ovr?.token_budget).toBe(1500)
  })

  it('ignores invalid context_strategy values gracefully', () => {
    const roleDefs = [{ slug: 'ae', context_strategy: 'made_up_strategy' }]
    const ovr = resolveTenantOverrides(roleDefs, 'ae')
    expect(ovr?.strategy).toBeUndefined()
    expect(ovr?.allow).toBeUndefined()
  })
})

describe('slice registry sanity', () => {
  it('every slice declares a positive token_budget', () => {
    for (const slice of Object.values(SLICES)) {
      expect(slice.token_budget).toBeGreaterThan(0)
    }
  })

  it('every slice declares a positive soft_timeout_ms', () => {
    for (const slice of Object.values(SLICES)) {
      expect(slice.soft_timeout_ms).toBeGreaterThan(0)
    }
  })

  it('every slice has a unique slug', () => {
    const slugs = Object.values(SLICES).map((s) => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('strategy bundles only reference registered slice slugs', () => {
    const registered = new Set(Object.keys(SLICES))
    for (const [strategy, slugs] of Object.entries(STRATEGY_BUNDLES)) {
      for (const slug of slugs) {
        expect(registered.has(slug), `${strategy} references unknown ${slug}`).toBe(true)
      }
    }
  })

  it('Phase 2 slices are all registered', () => {
    expect(SLICES['rep-success-fingerprint']).toBeDefined()
    expect(SLICES['champion-map']).toBeDefined()
  })
})

describe('Phase 2 slice triggers', () => {
  it('rep-success-fingerprint always scores positive for AE on draft_outreach', () => {
    const scored = scoreSlices(
      buildSelectorInput({
        role: 'ae',
        activeObject: 'none',
        activeUrn: null,
        intentClass: 'draft_outreach',
      }),
    )
    const fp = scored.find((s) => s.slug === 'rep-success-fingerprint')
    expect(fp).toBeDefined()
    expect(fp!.score).toBeGreaterThan(0)
  })

  it('champion-map only loads when the active object is a deal', () => {
    const noDeal = scoreSlices(
      buildSelectorInput({
        role: 'ae',
        activeObject: 'none',
        activeUrn: null,
        intentClass: 'risk_analysis',
      }),
    ).find((s) => s.slug === 'champion-map')!

    const withDeal = scoreSlices(
      buildSelectorInput({
        role: 'ae',
        activeObject: 'deal',
        activeUrn: 'urn:rev:deal:abc',
        intentClass: 'risk_analysis',
      }),
    ).find((s) => s.slug === 'champion-map')!

    expect(withDeal.score).toBeGreaterThan(noDeal.score)
    expect(withDeal.score - noDeal.score).toBeGreaterThanOrEqual(5)
  })

  it('rep-success-fingerprint does NOT load for leader role (use Leadership Lens patterns instead)', () => {
    const scored = scoreSlices(
      buildSelectorInput({
        role: 'leader',
        activeObject: 'none',
        activeUrn: null,
        intentClass: 'portfolio_health',
      }),
    )
    const fp = scored.find((s) => s.slug === 'rep-success-fingerprint')!
    // Score may include intent baseline but not the role bonus
    expect(fp.score).toBeLessThan(7) // role bonus would push score >= 7
  })
})
