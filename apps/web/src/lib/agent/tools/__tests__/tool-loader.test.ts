import { describe, it, expect } from 'vitest'

/**
 * Smoke test for the dispatch + agent vocabulary aliases. Heavier loader
 * tests would require a real Supabase mock for the registry query path; the
 * registry-empty fallback path is covered indirectly by middleware.test.ts
 * (the wrapStaticToolsWithMiddleware helper sits between createAgentTools
 * and DEFAULT_MIDDLEWARE).
 */
import {
  AGENT_SURFACES,
  AGENT_TYPES,
  isAgentSurface,
  isAgentType,
  dispatchAgent,
} from '../index'

describe('agent surface vocabulary', () => {
  it('AGENT_TYPES is an alias for AGENT_SURFACES', () => {
    expect(AGENT_TYPES).toBe(AGENT_SURFACES)
  })

  it('isAgentType matches isAgentSurface (deprecated alias)', () => {
    expect(isAgentType).toBe(isAgentSurface)
  })

  it('isAgentSurface accepts the four shipped surfaces', () => {
    for (const s of AGENT_SURFACES) {
      expect(isAgentSurface(s)).toBe(true)
    }
  })

  it('isAgentSurface rejects unknown strings', () => {
    expect(isAgentSurface('something-else')).toBe(false)
    expect(isAgentSurface(null)).toBe(false)
    expect(isAgentSurface(123)).toBe(false)
  })
})

describe('dispatchAgent', () => {
  it('routes deal/opportunity URNs to pipeline-coach', () => {
    const d = dispatchAgent({ role: 'ae', activeUrn: 'urn:rev:deal:123' })
    expect(d.agentType).toBe('pipeline-coach')
    const d2 = dispatchAgent({ role: 'ae', activeUrn: 'urn:rev:opportunity:abc' })
    expect(d2.agentType).toBe('pipeline-coach')
  })

  it('routes company URNs to account-strategist', () => {
    const d = dispatchAgent({ role: 'ae', activeUrn: 'urn:rev:company:456' })
    expect(d.agentType).toBe('account-strategist')
  })

  it('falls back to role default when no activeUrn', () => {
    expect(dispatchAgent({ role: 'leader' }).agentType).toBe('leadership-lens')
    expect(dispatchAgent({ role: 'csm' }).agentType).toBe('pipeline-coach')
  })

  it('an explicit agent type wins over role/URN dispatch', () => {
    const d = dispatchAgent({
      role: 'ae',
      activeUrn: 'urn:rev:company:456',
      explicitAgentType: 'leadership-lens',
    })
    expect(d.agentType).toBe('leadership-lens')
  })
})
