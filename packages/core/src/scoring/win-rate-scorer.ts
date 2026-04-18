import type { ScoringResult } from '../types/scoring'

export interface WinRateScorerInput {
  similar_won: number
  similar_lost: number
  company_win_rate: number
  blend_threshold: number
}

export function computeProfileWinRate(input: WinRateScorerInput): ScoringResult {
  const { similar_won, similar_lost, blend_threshold } = input
  // Guard against NaN / undefined `company_win_rate` — bad config or a
  // tenant with zero closed deals can pass NaN here, which would
  // propagate through `computePropensity` and yield a NaN priority
  // score. Default to the same 15% the cron route uses when no closed
  // deals exist.
  const company_win_rate =
    typeof input.company_win_rate === 'number' && Number.isFinite(input.company_win_rate)
      ? input.company_win_rate
      : 15
  const sampleSize = similar_won + similar_lost

  let score: number

  if (sampleSize === 0) {
    score = company_win_rate
  } else {
    const rawWinRate = (similar_won / sampleSize) * 100

    if (sampleSize >= blend_threshold) {
      score = rawWinRate
    } else {
      score =
        (rawWinRate * sampleSize + company_win_rate * blend_threshold) /
        (sampleSize + blend_threshold)
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score * 100) / 100))

  return {
    score,
    dimensions: [
      {
        name: 'profile_win_rate',
        score,
        weight: 1,
        weighted_score: score,
        label: sampleSize === 0
          ? `Company average (${company_win_rate}%)`
          : `${similar_won}W / ${similar_lost}L from ${sampleSize} similar deals`,
      },
    ],
    top_reason:
      sampleSize < blend_threshold
        ? `Blended with company average (small sample: ${sampleSize})`
        : `Based on ${sampleSize} similar deals`,
    computed_at: new Date().toISOString(),
    config_version: '',
  }
}
