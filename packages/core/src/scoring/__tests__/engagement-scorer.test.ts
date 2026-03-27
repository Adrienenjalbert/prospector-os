import { describe, it, expect } from 'vitest'
import { computeEngagementDepth } from '../engagement-scorer'
import type { CRMActivity } from '../../types/ontology'
import type { ScoringConfig } from '../../types/config'

const daysAgo = (d: number) =>
  new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString()

const mockConfig = {
  engagement_activity_points: {
    proposal_sent: 25,
    meeting_multi_party: 20,
    meeting_one_on_one: 15,
    call_connected: 10,
    email_reply_received: 8,
    call_attempted: 3,
    email_opened_multiple: 2,
    email_opened_once: 1,
  },
  engagement_recency: [
    { max_days: 3, score: 100 },
    { max_days: 7, score: 80 },
    { max_days: 14, score: 60 },
    { max_days: 30, score: 40 },
    { max_days: 60, score: 20 },
    { max_days: 9999, score: 5 },
  ],
} as unknown as ScoringConfig

function makeActivity(type: string, daysOld: number): CRMActivity {
  return {
    id: `a-${Math.random()}`,
    type: type as CRMActivity['type'],
    contact_id: null,
    account_id: 'acc-1',
    subject: null,
    duration_minutes: null,
    occurred_at: daysAgo(daysOld),
  }
}

describe('computeEngagementDepth', () => {
  it('scores 0-area for no activities', () => {
    const result = computeEngagementDepth(
      { activities: [], tenant_median_activities_30d: 5 },
      mockConfig
    )
    expect(result.score).toBeLessThan(30)
  })

  it('scores high for recent high-quality activities', () => {
    const activities = [
      makeActivity('proposal_sent', 2),
      makeActivity('meeting_multi_party', 5),
      makeActivity('call_connected', 7),
      makeActivity('email_reply_received', 10),
    ]
    const result = computeEngagementDepth(
      { activities, tenant_median_activities_30d: 3 },
      mockConfig
    )
    expect(result.score).toBeGreaterThan(60)
  })

  it('has four dimensions', () => {
    const result = computeEngagementDepth(
      { activities: [makeActivity('call_connected', 1)], tenant_median_activities_30d: 5 },
      mockConfig
    )
    expect(result.dimensions).toHaveLength(4)
    expect(result.dimensions.map(d => d.name)).toEqual([
      'activity_volume', 'activity_quality', 'engagement_trend', 'recency_factor',
    ])
  })
})
