import { describe, it, expect } from 'vitest'
import type { RepProfile } from '@prospector/core'
import { formatRepPreferences } from '../_shared'

/**
 * The agent route now reads `rep_profiles.comm_style/outreach_tone/
 * focus_stage/alert_frequency` and splices them into the prompt via
 * `formatRepPreferences`. These tests pin the contract:
 *
 *   1. Every supported preference produces a recognisable, action-driving
 *      line (e.g. "Brief" → mentions ≤ 80 words, "Direct" → ≤ 5 sentences).
 *   2. Missing rep profile returns an empty string (no orphan header in the
 *      prompt window).
 *   3. The output stays compact (≤ ~120 tokens ≈ ~600 chars) so it doesn't
 *      crowd out live data.
 *
 * Without these tests, a refactor that broke the prompt copy would
 * silently revert the agent to the pre-personalisation behaviour and
 * nothing in CI would notice.
 */

function profile(overrides: Partial<RepProfile>): RepProfile {
  return {
    id: 'rep-1',
    tenant_id: 't1',
    user_id: 'u1',
    crm_id: 'crm-1',
    name: 'Test Rep',
    email: null,
    slack_user_id: null,
    market: 'us',
    team: null,
    comm_style: 'casual',
    alert_frequency: 'medium',
    focus_stage: null,
    outreach_tone: 'professional',
    kpi_meetings_monthly: null,
    kpi_proposals_monthly: null,
    kpi_pipeline_value: null,
    kpi_win_rate: null,
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('formatRepPreferences', () => {
  it('returns empty string for null profile (no spurious header)', () => {
    expect(formatRepPreferences(null)).toBe('')
  })

  it('always opens with a recognisable section header', () => {
    const out = formatRepPreferences(profile({}))
    expect(out.startsWith('## Rep Preferences')).toBe(true)
  })

  it('brief comm_style mentions the tighter ≤ 80-word override', () => {
    const out = formatRepPreferences(profile({ comm_style: 'brief' }))
    expect(out).toMatch(/≤\s*80\s*words/i)
  })

  it('formal comm_style mentions formal tone explicitly', () => {
    const out = formatRepPreferences(profile({ comm_style: 'formal' }))
    expect(out).toMatch(/Formal/)
    expect(out).not.toMatch(/Casual/)
  })

  it('direct outreach tone mentions ≤ 5 sentences', () => {
    const out = formatRepPreferences(profile({ outreach_tone: 'direct' }))
    expect(out).toMatch(/≤\s*5\s*sentences/i)
  })

  it('consultative outreach tone mentions cited signal lead-in', () => {
    const out = formatRepPreferences(
      profile({ outreach_tone: 'consultative' }),
    )
    expect(out).toMatch(/cited signal/i)
  })

  it('focus_stage line shows up when set', () => {
    const out = formatRepPreferences(
      profile({ focus_stage: 'Discovery' }),
    )
    expect(out).toMatch(/Focus stage:\*?\*?\s*Discovery/)
  })

  it('focus_stage line is omitted when null', () => {
    const out = formatRepPreferences(profile({ focus_stage: null }))
    expect(out).not.toMatch(/Focus stage:/)
  })

  it('alert_frequency=low surfaces the bundling guidance', () => {
    const out = formatRepPreferences(profile({ alert_frequency: 'low' }))
    expect(out).toMatch(/Low/)
    expect(out).toMatch(/single most-important/i)
  })

  it('alert_frequency=high surfaces the more-liberal cap', () => {
    const out = formatRepPreferences(profile({ alert_frequency: 'high' }))
    expect(out).toMatch(/High/)
    expect(out).toMatch(/3 proactive/i)
  })

  it('output stays compact (< 700 chars) so it does not crowd out live data', () => {
    const allFieldsSet = profile({
      comm_style: 'brief',
      outreach_tone: 'consultative',
      focus_stage: 'Negotiation',
      alert_frequency: 'high',
    })
    const out = formatRepPreferences(allFieldsSet)
    expect(out.length).toBeLessThan(700)
  })
})
