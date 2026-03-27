import type { Contact } from '../types/ontology'
import type { ContactCoverageConfig } from '../types/config'
import type { ScoringResult } from '../types/scoring'

export function computeContactCoverage(
  contacts: Contact[],
  config: ContactCoverageConfig
): ScoringResult {
  const breadth = computeBreadth(contacts.length, config.breadth_tiers)
  const depth = computeDepth(contacts, config.seniority_points)
  const engagementRatio = computeEngagementRatio(contacts, config)
  const roleCoverage = computeRoleCoverage(contacts, config.key_roles)

  const score = Math.round(
    breadth * 0.25 + depth * 0.25 + engagementRatio * 0.30 + roleCoverage * 0.20
  )
  const clamped = Math.max(0, Math.min(100, score))

  const champion = contacts.find((c) => c.is_champion)
  const topReason = contacts.length === 0
    ? 'No contacts identified'
    : contacts.length === 1
      ? 'Single-threaded — high risk'
      : champion
        ? `${contacts.length} contacts, champion: ${champion.first_name} ${champion.last_name}`
        : `${contacts.length} contacts, no champion identified`

  return {
    score: clamped,
    dimensions: [
      { name: 'breadth', score: breadth, weight: 0.25, weighted_score: breadth * 0.25, label: breadthLabel(contacts.length) },
      { name: 'depth', score: depth, weight: 0.25, weighted_score: depth * 0.25, label: depthLabel(depth) },
      { name: 'engagement_ratio', score: engagementRatio, weight: 0.30, weighted_score: engagementRatio * 0.30, label: engagementLabel(engagementRatio) },
      { name: 'role_coverage', score: roleCoverage, weight: 0.20, weighted_score: roleCoverage * 0.20, label: roleLabel(roleCoverage) },
    ],
    top_reason: topReason,
    computed_at: new Date().toISOString(),
    config_version: '',
  }
}

function computeBreadth(
  count: number,
  tiers: { min_contacts: number; score: number; label: string }[]
): number {
  const sorted = [...tiers].sort((a, b) => b.min_contacts - a.min_contacts)
  for (const tier of sorted) {
    if (count >= tier.min_contacts) return tier.score
  }
  return 0
}

function computeDepth(
  contacts: Contact[],
  seniorityPoints: Record<string, number>
): number {
  const seniorityMap: Record<string, string> = {
    c_level: 'c_level',
    vp: 'vp_director',
    director: 'vp_director',
    manager: 'manager',
    individual: 'individual',
  }

  const coveredLevels = new Set<string>()
  let total = 0

  for (const contact of contacts) {
    if (!contact.seniority) continue
    const level = seniorityMap[contact.seniority] ?? contact.seniority
    if (!coveredLevels.has(level)) {
      coveredLevels.add(level)
      total += seniorityPoints[level] ?? 15
    }
  }

  return Math.min(100, total)
}

function computeEngagementRatio(
  contacts: Contact[],
  config: ContactCoverageConfig
): number {
  if (contacts.length === 0) return 0

  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const engaged = contacts.filter(
    (c) =>
      c.last_activity_date &&
      new Date(c.last_activity_date) >= thirtyDaysAgo
  )

  const ratio = engaged.length / contacts.length
  let baseScore = ratio * 70

  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

  const championEngaged = contacts.some(
    (c) =>
      c.is_champion &&
      c.last_activity_date &&
      new Date(c.last_activity_date) >= fourteenDaysAgo
  )
  if (championEngaged) baseScore += config.champion_engaged_bonus

  const buyerEngaged = contacts.some(
    (c) =>
      c.is_economic_buyer &&
      c.last_activity_date &&
      new Date(c.last_activity_date) >= fourteenDaysAgo
  )
  if (buyerEngaged) baseScore += config.economic_buyer_engaged_bonus

  return Math.min(100, Math.round(baseScore))
}

function computeRoleCoverage(
  contacts: Contact[],
  keyRoles: { role: string; identified_pts: number; engaged_pts: number }[]
): number {
  const now = new Date()
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

  let total = 0

  for (const roleSpec of keyRoles) {
    const match = contacts.find((c) => c.role_tag === roleSpec.role)
    if (match) {
      total += roleSpec.identified_pts
      const isEngaged =
        match.last_activity_date &&
        new Date(match.last_activity_date) >= fourteenDaysAgo
      if (isEngaged) total += roleSpec.engaged_pts
    }
  }

  return Math.min(100, total)
}

function breadthLabel(count: number): string {
  if (count >= 7) return 'Deep map'
  if (count >= 5) return 'Well-mapped'
  if (count >= 3) return 'Developing'
  if (count >= 2) return 'Thin'
  if (count === 1) return 'Single-threaded'
  return 'Blind'
}
function depthLabel(score: number): string {
  if (score >= 80) return 'Multi-level coverage'
  if (score >= 50) return 'Partial coverage'
  return 'Limited seniority access'
}
function engagementLabel(score: number): string {
  if (score >= 70) return 'Highly engaged'
  if (score >= 40) return 'Moderately engaged'
  return 'Low engagement'
}
function roleLabel(score: number): string {
  if (score >= 70) return 'Key roles covered'
  if (score >= 40) return 'Some roles covered'
  return 'Missing key roles'
}
