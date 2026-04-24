import { describe, it, expect } from 'vitest'

import {
  buildCacheableSystem,
  buildIterationUser,
} from '../churn-escalation'

/**
 * PR2 — prompt-cache contract for `runChurnEscalation`'s draft loop.
 *
 * The Anthropic ephemeral cache only saves money when the cached
 * portion is byte-identical across iterations. The whole point of
 * splitting the legacy `buildDraftPrompt` into:
 *
 *   - `buildCacheableSystem(evidence, guidance)`   ← cached
 *   - `buildIterationUser(previousReasons, iter)`  ← per-iteration
 *
 * is that the system block is deterministic given (evidence, guidance)
 * regardless of which iteration of the loop we're on. If anything
 * iteration-dependent leaks into the system block, the cache misses
 * on every iteration and PR2 is worth nothing.
 *
 * These tests pin down both halves of the contract: the cacheable
 * half is iteration-independent; the per-iteration half is where the
 * variability actually lives.
 */

const baseEvidence = {
  tenant_id: 't1',
  company_id: 'c1',
  company_name: 'Acme',
  owner_name: 'Sam Rep',
  metrics: [
    { label: 'Churn risk score', value: '0.84', urn: 'urn:rev:t1:company:c1' },
    { label: 'Health score', value: '23', urn: 'urn:rev:t1:company:c1' },
    { label: 'MRR', value: '£12,400', urn: 'urn:rev:t1:company:c1' },
  ],
  open_signals: [
    { title: 'Champion went silent 14 days', urn: 'urn:rev:t1:signal:s1' },
    { title: 'Pricing concern raised on call', urn: 'urn:rev:t1:signal:s2' },
  ],
  recent_transcript_excerpts: [
    { snippet: 'Discussed renewal pushback', urn: 'urn:rev:t1:transcript:tr1' },
  ],
  loss_theme_memories: [
    {
      title: 'Late-quarter price negotiations stall renewals',
      body: 'Comparable accounts that surfaced pricing concerns inside the last 30 days of the contract slipped out of renewal 60% of the time...',
      urn: 'urn:rev:t1:memory:m1',
    },
  ],
}

describe('churn-escalation prompt-cache contract (PR2)', () => {
  it('buildCacheableSystem is deterministic for the same (evidence, guidance) — cache key stays stable', () => {
    const a = buildCacheableSystem(baseEvidence, 'lean on the fulfillment drop')
    const b = buildCacheableSystem(baseEvidence, 'lean on the fulfillment drop')
    expect(a).toBe(b)
  })

  it('buildCacheableSystem does NOT include any iteration-specific text', () => {
    // The whole reason this helper exists separately from the
    // per-iteration user message is that nothing iteration-state
    // leaks into the cached block. If any of these strings appeared
    // in the cacheable portion, the cache would miss on every
    // retry and PR2's saving would evaporate.
    const sys = buildCacheableSystem(baseEvidence, '')

    // Validator failure language lives on the user message, never the system.
    expect(sys).not.toContain('PREVIOUS ATTEMPT FAILED')
    expect(sys).not.toContain('Fix every reason above')
    // Iteration index never bleeds into the cached portion either.
    expect(sys).not.toContain('iteration')
    expect(sys).not.toContain('retry')
  })

  it('buildCacheableSystem carries the evidence the validator will check', () => {
    const sys = buildCacheableSystem(baseEvidence, '')

    // Every metric URN must be in the cached system so the model
    // can cite it. If we accidentally moved evidence to the user
    // message the cache would still hit but the validator would
    // fail every iteration.
    for (const m of baseEvidence.metrics) {
      expect(sys).toContain(m.urn)
      expect(sys).toContain(m.value)
    }
    for (const s of baseEvidence.open_signals) {
      expect(sys).toContain(s.urn)
    }
    expect(sys).toContain(baseEvidence.company_name)
    expect(sys).toContain(baseEvidence.owner_name)
  })

  it('buildCacheableSystem includes loss-theme memories when present', () => {
    const sys = buildCacheableSystem(baseEvidence, '')
    expect(sys).toContain(baseEvidence.loss_theme_memories[0].urn)
    expect(sys).toContain('Patterns from comparable lost accounts')
  })

  it('buildCacheableSystem omits the loss-theme block when none exist (compact for cold-start tenants)', () => {
    const sys = buildCacheableSystem(
      { ...baseEvidence, loss_theme_memories: [] },
      '',
    )
    expect(sys).not.toContain('Patterns from comparable lost accounts')
  })

  it('buildIterationUser returns the canonical first-iteration prompt when no failures', () => {
    expect(buildIterationUser([], 0)).toContain('Draft the escalation now')
  })

  it('buildIterationUser folds validator failure reasons into the per-iteration message', () => {
    const reasons = [
      'Cites 2 URNs; at least 3 required.',
      'Number "84%" in body doesn\'t appear in evidence metrics.',
    ]
    const msg = buildIterationUser(reasons, 1)
    expect(msg).toContain('PREVIOUS ATTEMPT FAILED')
    for (const r of reasons) {
      expect(msg).toContain(r)
    }
  })

  it('buildIterationUser changes per iteration; buildCacheableSystem does NOT — proves the cache breakpoint sits in the right place', () => {
    const sys0 = buildCacheableSystem(baseEvidence, '')
    const sys1 = buildCacheableSystem(baseEvidence, '')
    const sys2 = buildCacheableSystem(baseEvidence, '')

    const user0 = buildIterationUser([], 0)
    const user1 = buildIterationUser(['Cites 1 URN; at least 3 required.'], 1)
    const user2 = buildIterationUser(['Letter is 412 words, must be <= 400.'], 2)

    // Cached half is identical across iterations.
    expect(sys0).toBe(sys1)
    expect(sys1).toBe(sys2)

    // Per-iteration half varies — exactly the inverse of the cached
    // half. Without this asymmetry the loop wouldn't actually be
    // self-correcting.
    expect(user0).not.toBe(user1)
    expect(user1).not.toBe(user2)
  })
})
