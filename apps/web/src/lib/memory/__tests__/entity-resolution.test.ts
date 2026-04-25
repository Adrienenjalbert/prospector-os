import { describe, it, expect } from 'vitest'
import {
  normaliseCompanyName,
  stripDomainSuffix,
  resolveCompanyString,
  type CompanyResolutionIndex,
} from '../entity-resolution'

/**
 * Inline entity resolution (Phase 7, Section 3.3) — pure function
 * tests. The connection miners depend on these to bridge "Apollo
 * Inc." ↔ "apollo.io" ↔ "Apollo" without writing fake bridges.
 *
 * Recall vs precision: we LEAN PRECISION. Tests confirm we don't
 * over-match.
 */

describe('normaliseCompanyName', () => {
  it('lowercases and strips trademark suffixes', () => {
    expect(normaliseCompanyName('Apollo Inc.')).toBe('apollo')
    expect(normaliseCompanyName('Acme LLC')).toBe('acme')
    expect(normaliseCompanyName('Foo Ltd.')).toBe('foo')
    expect(normaliseCompanyName('Bar GmbH')).toBe('bar')
    expect(normaliseCompanyName('Salesforce.com')).toBe('salesforce.com') // dotted name kept
  })

  it('collapses whitespace', () => {
    expect(normaliseCompanyName('  Apollo   Inc  ')).toBe('apollo')
  })

  it('preserves multi-word names', () => {
    expect(normaliseCompanyName('Goldman Sachs')).toBe('goldman sachs')
  })
})

describe('stripDomainSuffix', () => {
  it('strips common single-segment TLDs', () => {
    expect(stripDomainSuffix('apollo.io')).toBe('apollo')
    expect(stripDomainSuffix('acme.com')).toBe('acme')
    expect(stripDomainSuffix('zinc.ai')).toBe('zinc')
  })

  it('preserves multi-segment suffixes', () => {
    expect(stripDomainSuffix('foo.co.uk')).toBe('foo.co.uk')
    expect(stripDomainSuffix('bar.com.au')).toBe('bar.com.au')
  })

  it('lowercases', () => {
    expect(stripDomainSuffix('APOLLO.IO')).toBe('apollo')
  })
})

describe('resolveCompanyString', () => {
  function buildIndex(): CompanyResolutionIndex {
    return {
      byName: new Map([
        ['apollo', 'co-1'],
        ['salesforce', 'co-2'],
        ['goldman sachs', 'co-3'],
      ]),
      byDomain: new Map([
        ['apollo.io', 'co-1'],
        ['salesforce.com', 'co-2'],
      ]),
      byDomainStripped: new Map([['apollo', 'co-1']]),
      candidates: [
        { id: 'co-1', normalisedName: 'apollo' },
        { id: 'co-2', normalisedName: 'salesforce' },
        { id: 'co-3', normalisedName: 'goldman sachs' },
      ],
    }
  }

  it('returns null for empty / non-string input', () => {
    const index = buildIndex()
    expect(resolveCompanyString('', index)).toBeNull()
    // @ts-expect-error — testing runtime guard
    expect(resolveCompanyString(null, index)).toBeNull()
    expect(resolveCompanyString('   ', index)).toBeNull()
  })

  it('matches by exact normalised name', () => {
    const index = buildIndex()
    expect(resolveCompanyString('Apollo Inc.', index)).toBe('co-1')
    expect(resolveCompanyString('SALESFORCE', index)).toBe('co-2')
    expect(resolveCompanyString('Goldman Sachs', index)).toBe('co-3')
  })

  it('matches by exact domain', () => {
    const index = buildIndex()
    expect(resolveCompanyString('apollo.io', index)).toBe('co-1')
    expect(resolveCompanyString('salesforce.com', index)).toBe('co-2')
  })

  it('matches by suffix-stripped domain', () => {
    const index = buildIndex()
    // "apollo.com" doesn't match byDomain directly but the stripped
    // form ("apollo") matches byDomainStripped.
    expect(resolveCompanyString('apollo.com', index)).toBe('co-1')
  })

  it('returns null for unknown strings (precision-biased)', () => {
    const index = buildIndex()
    expect(resolveCompanyString('Microsoft', index)).toBeNull()
    expect(resolveCompanyString('xyz.tld', index)).toBeNull()
    expect(resolveCompanyString('Apollo Travel Services', index)).toBeNull() // stricter match
  })
})
