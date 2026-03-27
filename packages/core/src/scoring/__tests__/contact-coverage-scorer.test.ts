import { describe, it, expect } from 'vitest'
import { computeContactCoverage } from '../contact-coverage-scorer'
import type { Contact } from '../../types/ontology'
import type { ContactCoverageConfig } from '../../types/config'

const daysAgo = (d: number) =>
  new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString()

const testConfig: ContactCoverageConfig = {
  breadth_tiers: [
    { min_contacts: 7, score: 100, label: 'Deep' },
    { min_contacts: 5, score: 80, label: 'Good' },
    { min_contacts: 3, score: 60, label: 'Dev' },
    { min_contacts: 2, score: 35, label: 'Thin' },
    { min_contacts: 1, score: 15, label: 'Single' },
    { min_contacts: 0, score: 0, label: 'Blind' },
  ],
  seniority_points: { c_level: 35, vp_director: 30, manager: 20, individual: 15 },
  key_roles: [
    { role: 'champion', identified_pts: 10, engaged_pts: 15 },
    { role: 'economic_buyer', identified_pts: 10, engaged_pts: 15 },
    { role: 'technical_evaluator', identified_pts: 5, engaged_pts: 10 },
  ],
  champion_engaged_bonus: 15,
  economic_buyer_engaged_bonus: 15,
}

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: `c-${Math.random()}`, tenant_id: 't1', company_id: 'co1',
    crm_id: null, apollo_id: null,
    email: 'test@test.com', first_name: 'Test', last_name: 'User',
    title: 'Manager', seniority: 'manager', department: 'Operations',
    phone: null, linkedin_url: null,
    engagement_score: 0, relevance_score: 0,
    is_champion: false, is_decision_maker: false, is_economic_buyer: false,
    role_tag: null,
    last_activity_date: daysAgo(5),
    enriched_at: null, created_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('computeContactCoverage', () => {
  it('returns 0 for no contacts', () => {
    const result = computeContactCoverage([], testConfig)
    expect(result.score).toBe(0)
    expect(result.top_reason).toBe('No contacts identified')
  })

  it('flags single-threaded risk', () => {
    const result = computeContactCoverage([makeContact()], testConfig)
    expect(result.score).toBeLessThan(50)
    expect(result.top_reason).toContain('Single-threaded')
  })

  it('scores higher with diverse contacts', () => {
    const contacts = [
      makeContact({ seniority: 'c_level', is_champion: true, role_tag: 'champion' }),
      makeContact({ seniority: 'director', is_economic_buyer: true, role_tag: 'economic_buyer' }),
      makeContact({ seniority: 'manager', role_tag: 'technical_evaluator' }),
      makeContact({ seniority: 'individual' }),
      makeContact({ seniority: 'manager', last_name: 'Smith' }),
    ]
    const result = computeContactCoverage(contacts, testConfig)
    expect(result.score).toBeGreaterThan(60)
  })

  it('gives champion bonus when champion is engaged', () => {
    const withChampion = [
      makeContact({ is_champion: true, last_activity_date: daysAgo(3) }),
      makeContact(),
      makeContact(),
    ]
    const withoutChampion = [
      makeContact(),
      makeContact(),
      makeContact(),
    ]
    const a = computeContactCoverage(withChampion, testConfig)
    const b = computeContactCoverage(withoutChampion, testConfig)
    expect(a.score).toBeGreaterThan(b.score)
  })
})
