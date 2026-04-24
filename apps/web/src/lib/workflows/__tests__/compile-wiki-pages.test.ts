import { describe, it, expect } from 'vitest'
import { clusterAtomsToPages, computeClusterHash, renderPageMarkdown } from '../compile-wiki-pages'
import type { MemoryKind } from '@prospector/core'

/**
 * Tests for the deterministic, pure-function pieces of
 * compileWikiPages (Phase 6, Section 2.3):
 *
 *   1. clusterAtomsToPages — atoms route to the right page kind +
 *      slug per the mapping rules in the workflow's docstring.
 *   2. computeClusterHash — same atom set in any order produces the
 *      same hash (idempotency); one updated_at flip flips the hash.
 *   3. renderPageMarkdown — the structured Sonnet output renders to
 *      the expected markdown shape (TL;DR + sections + cross-links).
 *
 * These are the parts that the workflow's idempotency, cost
 * efficiency, and prompt structure depend on. The LLM call itself
 * is mocked at the integration level (separate test file).
 */

interface AtomFixture {
  id: string
  kind: MemoryKind
  scope: Record<string, string | undefined>
  title: string
  body: string
  evidence: { urns?: string[] }
  confidence: number
  updated_at: string
  derived_at: string
}

function makeAtom(over: Partial<AtomFixture>): AtomFixture {
  return {
    id: 'a1',
    kind: 'icp_pattern',
    scope: {},
    title: 'A',
    body: 'body',
    evidence: {},
    confidence: 0.7,
    updated_at: '2026-04-20T00:00:00Z',
    derived_at: '2026-04-20T00:00:00Z',
    ...over,
  }
}

describe('clusterAtomsToPages', () => {
  it('routes icp_pattern with industry → entity_industry', () => {
    const clusters = clusterAtomsToPages([
      makeAtom({ id: 'a1', kind: 'icp_pattern', scope: { industry: 'Manufacturing' } }),
    ])
    expect(clusters.size).toBe(1)
    const cluster = clusters.get('entity_industry:manufacturing')
    expect(cluster).toBeDefined()
    expect(cluster!.pageKind).toBe('entity_industry')
    expect(cluster!.slug).toBe('manufacturing')
    expect(cluster!.scope).toEqual({ industry: 'Manufacturing' })
    expect(cluster!.atoms).toHaveLength(1)
  })

  it('routes icp_pattern without scope → concept_icp/tenant-wide', () => {
    const clusters = clusterAtomsToPages([
      makeAtom({ id: 'a1', kind: 'icp_pattern', scope: {} }),
    ])
    const cluster = clusters.get('concept_icp:tenant-wide')
    expect(cluster).toBeDefined()
    expect(cluster!.pageKind).toBe('concept_icp')
  })

  it('routes persona by role to entity_persona', () => {
    const clusters = clusterAtomsToPages([
      makeAtom({ id: 'a1', kind: 'persona', scope: { persona_role: 'champion' } }),
    ])
    expect(clusters.get('entity_persona:champion')).toBeDefined()
  })

  it('routes competitor_play by competitor name', () => {
    const clusters = clusterAtomsToPages([
      makeAtom({ id: 'a1', kind: 'competitor_play', scope: { competitor: 'Workday Inc.' } }),
    ])
    expect(clusters.get('entity_competitor:workday-inc')).toBeDefined()
  })

  it('routes motion_step → concept_motion/tenant-wide singleton', () => {
    const clusters = clusterAtomsToPages([
      makeAtom({ id: 'a1', kind: 'motion_step', scope: { stage: 'discovery' } }),
      makeAtom({ id: 'a2', kind: 'motion_step', scope: { stage: 'proposal' } }),
    ])
    const cluster = clusters.get('concept_motion:tenant-wide')
    expect(cluster).toBeDefined()
    expect(cluster!.atoms).toHaveLength(2)
  })

  it('folds win_theme + loss_theme + icp_pattern with same industry into one entity_industry page', () => {
    const clusters = clusterAtomsToPages([
      makeAtom({ id: 'a1', kind: 'icp_pattern', scope: { industry: 'Logistics' } }),
      makeAtom({ id: 'a2', kind: 'win_theme', scope: { industry: 'Logistics' } }),
      makeAtom({ id: 'a3', kind: 'loss_theme', scope: { industry: 'Logistics' } }),
    ])
    expect(clusters.size).toBe(1)
    const cluster = clusters.get('entity_industry:logistics')
    expect(cluster!.atoms).toHaveLength(3)
  })

  it('routes glossary_term → concept_glossary/tenant-wide singleton', () => {
    const clusters = clusterAtomsToPages([
      makeAtom({ id: 'a1', kind: 'glossary_term' }),
      makeAtom({ id: 'a2', kind: 'glossary_term' }),
      makeAtom({ id: 'a3', kind: 'glossary_term' }),
    ])
    const cluster = clusters.get('concept_glossary:tenant-wide')
    expect(cluster!.atoms).toHaveLength(3)
  })

  it('routes rep_playbook by rep_id', () => {
    const clusters = clusterAtomsToPages([
      makeAtom({
        id: 'a1',
        kind: 'rep_playbook',
        scope: { rep_id: 'rep-uuid-001' },
      }),
    ])
    expect(clusters.get('playbook_rep:rep-uuid-001')).toBeDefined()
  })

  it('routes stage_best_practice by stage', () => {
    const clusters = clusterAtomsToPages([
      makeAtom({
        id: 'a1',
        kind: 'stage_best_practice',
        scope: { stage: 'closing' },
      }),
    ])
    expect(clusters.get('playbook_stage:closing')).toBeDefined()
  })

  it('skips reflection atoms (handled by reflectMemories directly)', () => {
    const clusters = clusterAtomsToPages([
      makeAtom({ id: 'a1', kind: 'reflection' }),
    ])
    expect(clusters.size).toBe(0)
  })

  it('skips persona without persona_role scope (cannot route)', () => {
    const clusters = clusterAtomsToPages([
      makeAtom({ id: 'a1', kind: 'persona', scope: {} }),
    ])
    expect(clusters.size).toBe(0)
  })
})

describe('computeClusterHash', () => {
  it('produces the same hash for the same atom set in any order', () => {
    const atoms = [
      makeAtom({ id: 'a1', updated_at: '2026-04-20T00:00:00Z' }),
      makeAtom({ id: 'a2', updated_at: '2026-04-21T00:00:00Z' }),
      makeAtom({ id: 'a3', updated_at: '2026-04-19T00:00:00Z' }),
    ]
    const reversed = [...atoms].reverse()
    expect(computeClusterHash(atoms)).toBe(computeClusterHash(reversed))
  })

  it('flips the hash when one atom updated_at changes', () => {
    const baseline = [
      makeAtom({ id: 'a1', updated_at: '2026-04-20T00:00:00Z' }),
      makeAtom({ id: 'a2', updated_at: '2026-04-21T00:00:00Z' }),
    ]
    const updated = [
      makeAtom({ id: 'a1', updated_at: '2026-04-20T00:00:00Z' }),
      makeAtom({ id: 'a2', updated_at: '2026-04-22T00:00:00Z' }), // ← bumped
    ]
    expect(computeClusterHash(baseline)).not.toBe(computeClusterHash(updated))
  })

  it('flips the hash when an atom is added', () => {
    const before = [makeAtom({ id: 'a1' })]
    const after = [makeAtom({ id: 'a1' }), makeAtom({ id: 'a2' })]
    expect(computeClusterHash(before)).not.toBe(computeClusterHash(after))
  })

  it('hash length is bounded (≤32 chars to fit varchar(64))', () => {
    const atoms = [makeAtom({ id: 'a1' }), makeAtom({ id: 'a2' })]
    const h = computeClusterHash(atoms)
    expect(h.length).toBeLessThanOrEqual(32)
    expect(h).toMatch(/^[a-f0-9]+$/)
  })
})

describe('renderPageMarkdown', () => {
  it('renders title, TL;DR, sections, and cross-links in order', () => {
    const md = renderPageMarkdown({
      title: 'Manufacturing — your ICP',
      tldr: 'Two-sentence summary.',
      sections: [
        { heading: 'Evidence', content_md: 'Inline citations here.' },
        { heading: 'Patterns', content_md: 'Recurring themes.' },
      ],
      cross_links: ['logistics', 'champion-vp-rd'],
      citation_urns: ['urn:rev:t:memory:abc'],
    })
    expect(md).toContain('# Manufacturing — your ICP')
    expect(md).toContain('> **TL;DR** — Two-sentence summary.')
    expect(md).toContain('## Evidence')
    expect(md).toContain('Inline citations here.')
    expect(md).toContain('## Patterns')
    expect(md).toContain('Recurring themes.')
    expect(md).toContain('## Cross-links')
    expect(md).toContain('- [[logistics]]')
    expect(md).toContain('- [[champion-vp-rd]]')
  })

  it('omits the cross-links section when empty', () => {
    const md = renderPageMarkdown({
      title: 'X',
      tldr: 'Y',
      sections: [{ heading: 'Z', content_md: 'A' }],
      cross_links: [],
      citation_urns: [],
    })
    expect(md).not.toContain('## Cross-links')
  })
})
