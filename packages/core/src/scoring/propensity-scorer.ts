import type { PropensityWeights } from '../types/config'
import type { SubScoreSet } from '../types/scoring'

/**
 * Compute the composite propensity score from the six sub-scores and the
 * tenant's `propensity_weights` config.
 *
 * The function normalises the weights to sum to 1.0 before applying them.
 * Without this, a misconfigured tenant whose weights sum to e.g. 0.8 (a
 * common admin error — see the default config which has
 * `engagement_depth: 0.00`) would have its propensity systematically
 * understated, biasing every priority queue + ROI calculation. The
 * cron-side scoring config validation in `app/api/admin/config/route.ts`
 * is the FIRST line of defense; this normalisation is the second so the
 * scorer is honest about the maths even if drifted config sneaks in.
 *
 * If every weight is zero (pathological config), the function returns 0
 * so we don't divide by zero — the caller's `computeExpectedRevenue` then
 * produces zero expected revenue, which is the right "I have no signal"
 * answer.
 */
export function computePropensity(
  subScores: SubScoreSet,
  weights: PropensityWeights
): number {
  const sum =
    weights.icp_fit +
    weights.signal_momentum +
    weights.engagement_depth +
    weights.contact_coverage +
    weights.stage_velocity +
    weights.profile_win_rate

  if (sum <= 0) return 0

  // Sentinel for the "weights are already normalised" hot path —
  // avoids redundant divisions for the 99% case.
  const factor = Math.abs(sum - 1) < 0.0005 ? 1 : 1 / sum

  const raw =
    subScores.icp_fit * weights.icp_fit * factor +
    subScores.signal_momentum * weights.signal_momentum * factor +
    subScores.engagement_depth * weights.engagement_depth * factor +
    subScores.contact_coverage * weights.contact_coverage * factor +
    subScores.stage_velocity * weights.stage_velocity * factor +
    subScores.profile_win_rate * weights.profile_win_rate * factor

  // NaN guard — if any sub-score is NaN (corrupt DB, bad migration), the
  // multiplication yields NaN which propagates through the priority
  // queue and breaks the inbox. Treat NaN as "no signal" → 0.
  if (Number.isNaN(raw)) return 0

  return Math.max(0, Math.min(100, Math.round(raw * 100) / 100))
}
