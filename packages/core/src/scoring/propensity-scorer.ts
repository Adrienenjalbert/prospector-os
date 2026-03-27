import type { PropensityWeights } from '../types/config'
import type { SubScoreSet } from '../types/scoring'

export function computePropensity(
  subScores: SubScoreSet,
  weights: PropensityWeights
): number {
  const raw =
    subScores.icp_fit * weights.icp_fit +
    subScores.signal_momentum * weights.signal_momentum +
    subScores.engagement_depth * weights.engagement_depth +
    subScores.contact_coverage * weights.contact_coverage +
    subScores.stage_velocity * weights.stage_velocity +
    subScores.profile_win_rate * weights.profile_win_rate

  return Math.max(0, Math.min(100, Math.round(raw * 100) / 100))
}
