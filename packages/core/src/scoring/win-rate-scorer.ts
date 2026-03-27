import type { ScoringResult } from '../types/scoring'

export interface WinRateScorerInput {
  similar_won: number
  similar_lost: number
  company_win_rate: number
  blend_threshold: number
}

export function computeProfileWinRate(input: WinRateScorerInput): ScoringResult {
  const { similar_won, similar_lost, company_win_rate, blend_threshold } = input
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
