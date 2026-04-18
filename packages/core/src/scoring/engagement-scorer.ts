import type { CRMActivity } from '../types/ontology'
import type { ScoringConfig } from '../types/config'
import type { ScoringResult } from '../types/scoring'

export interface EngagementScorerInput {
  activities: CRMActivity[]
  tenant_median_activities_30d: number
}

export function computeEngagementDepth(
  input: EngagementScorerInput,
  config: ScoringConfig
): ScoringResult {
  const { activities, tenant_median_activities_30d } = input
  const now = new Date()

  const activities30d = activities.filter(
    (a) => daysSince(a.occurred_at, now) <= 30
  )

  const volume = computeVolume(activities30d.length, tenant_median_activities_30d)
  const quality = computeQuality(activities30d, config.engagement_activity_points)
  const trend = computeTrend(activities, config.engagement_activity_points)
  const recency = computeRecency(activities, config.engagement_recency)

  const score = Math.round(
    volume * 0.25 + quality * 0.30 + trend * 0.25 + recency * 0.20
  )
  const clamped = Math.max(0, Math.min(100, score))

  return {
    score: clamped,
    dimensions: [
      { name: 'activity_volume', score: volume, weight: 0.25, weighted_score: volume * 0.25, label: volumeLabel(volume) },
      { name: 'activity_quality', score: quality, weight: 0.30, weighted_score: quality * 0.30, label: qualityLabel(quality) },
      { name: 'engagement_trend', score: trend, weight: 0.25, weighted_score: trend * 0.25, label: trendLabel(trend) },
      { name: 'recency_factor', score: recency, weight: 0.20, weighted_score: recency * 0.20, label: recencyLabel(recency) },
    ],
    top_reason: activities30d.length > 0
      ? `${activities30d.length} activities in 30 days`
      : 'No recent activity',
    computed_at: new Date().toISOString(),
    config_version: '',
  }
}

function computeVolume(count: number, median: number): number {
  if (median <= 0) return count > 0 ? 75 : 25
  const ratio = count / median
  return Math.min(100, Math.round(ratio * 50 + 25))
}

function computeQuality(
  activities: CRMActivity[],
  pointMap: Record<string, number>
): number {
  let totalPoints = 0
  for (const act of activities) {
    totalPoints += pointMap[act.type] ?? 1
  }
  const maxPointsPerActivity = Math.max(...Object.values(pointMap), 1)
  const normaliser = Math.max(1, activities.length * maxPointsPerActivity)
  return Math.min(100, Math.round((totalPoints / normaliser) * 100))
}

function computeTrend(
  activities: CRMActivity[],
  pointMap: Record<string, number>
): number {
  const now = new Date()

  const last14 = activities.filter(
    (a) => daysSince(a.occurred_at, now) <= 14
  )
  const prior14 = activities.filter((a) => {
    const days = daysSince(a.occurred_at, now)
    return days > 14 && days <= 28
  })

  const last14Score = last14.reduce((s, a) => s + (pointMap[a.type] ?? 1), 0)
  const prior14Score = prior14.reduce((s, a) => s + (pointMap[a.type] ?? 1), 0)

  if (prior14Score === 0) return last14Score > 0 ? 75 : 55

  const ratio = (last14Score - prior14Score) / Math.max(1, prior14Score)

  if (ratio > 0.5) return 95
  if (ratio > 0.1) return 75
  if (ratio >= -0.1) return 55
  if (ratio > -0.3) return 35
  return 10
}

function computeRecency(
  activities: CRMActivity[],
  tiers: { max_days: number; score: number }[]
): number {
  if (activities.length === 0) return 5

  const meaningful = activities.filter(
    (a) => a.type !== 'email_opened_once'
  )
  if (meaningful.length === 0) return 5

  const sorted = meaningful.sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
  )
  const mostRecent = sorted[0]
  const daysAgo = daysSince(mostRecent.occurred_at, new Date())

  for (const tier of tiers) {
    if (daysAgo <= tier.max_days) return tier.score
  }
  return 5
}

function daysSince(dateStr: string, now: Date): number {
  return Math.floor(
    (now.getTime() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  )
}

function volumeLabel(s: number): string {
  if (s >= 80) return 'High volume'
  if (s >= 50) return 'Average volume'
  return 'Low volume'
}
function qualityLabel(s: number): string {
  if (s >= 70) return 'High-quality interactions'
  if (s >= 40) return 'Moderate interactions'
  return 'Low-quality interactions'
}
function trendLabel(s: number): string {
  if (s >= 75) return 'Accelerating'
  if (s >= 55) return 'Stable'
  if (s >= 35) return 'Cooling'
  return 'Going dark'
}
function recencyLabel(s: number): string {
  if (s >= 80) return 'Very recent'
  if (s >= 60) return 'Recent'
  if (s >= 40) return 'Aging'
  return 'Stale'
}
