import { describe, it, expect } from 'vitest'
import { computePropensity } from '../propensity-scorer'
import type { PropensityWeights } from '../../types/config'
import type { SubScoreSet } from '../../types/scoring'

const defaultWeights: PropensityWeights = {
  icp_fit: 0.15,
  signal_momentum: 0.20,
  engagement_depth: 0.15,
  contact_coverage: 0.20,
  stage_velocity: 0.15,
  profile_win_rate: 0.15,
}

describe('computePropensity', () => {
  it('computes weighted sum of all sub-scores', () => {
    const subScores: SubScoreSet = {
      icp_fit: 80,
      signal_momentum: 60,
      engagement_depth: 50,
      contact_coverage: 70,
      stage_velocity: 40,
      profile_win_rate: 30,
    }
    const result = computePropensity(subScores, defaultWeights)
    // 80*0.15 + 60*0.20 + 50*0.15 + 70*0.20 + 40*0.15 + 30*0.15
    // = 12 + 12 + 7.5 + 14 + 6 + 4.5 = 56
    expect(result).toBe(56)
  })

  it('returns 0 when all sub-scores are 0', () => {
    const subScores: SubScoreSet = {
      icp_fit: 0, signal_momentum: 0, engagement_depth: 0,
      contact_coverage: 0, stage_velocity: 0, profile_win_rate: 0,
    }
    expect(computePropensity(subScores, defaultWeights)).toBe(0)
  })

  it('returns 100 when all sub-scores are 100 and weights sum to 1.0', () => {
    const subScores: SubScoreSet = {
      icp_fit: 100, signal_momentum: 100, engagement_depth: 100,
      contact_coverage: 100, stage_velocity: 100, profile_win_rate: 100,
    }
    expect(computePropensity(subScores, defaultWeights)).toBe(100)
  })

  // ── Weight-normalisation contract ─────────────────────────────────
  //
  // computePropensity normalises weights so a misconfigured tenant whose
  // weights sum to e.g. 0.8 (a common admin error — the default config
  // ships with engagement_depth: 0.00) doesn't have systematically
  // understated propensity. Two earlier tests that pinned the
  // pre-normalisation behaviour have been updated below.
  //
  // The default behaviour above ("weights sum to 1.0") is unchanged
  // because normalisation is a no-op when the factor is already 1.
  // Tests below pin the new contract.

  it('normalises weights that sum to MORE than 1.0 (no double-counting)', () => {
    const heavyWeights: PropensityWeights = {
      icp_fit: 0.5, signal_momentum: 0.5, engagement_depth: 0.5,
      contact_coverage: 0.5, stage_velocity: 0.5, profile_win_rate: 0.5,
    }
    const subScores: SubScoreSet = {
      icp_fit: 80, signal_momentum: 80, engagement_depth: 80,
      contact_coverage: 80, stage_velocity: 80, profile_win_rate: 80,
    }
    // weights sum 3.0; after normalisation each weight is 1/6;
    // 80 * 1/6 * 6 = 80. NOT 100 (clamp), NOT 240 (raw sum).
    expect(computePropensity(subScores, heavyWeights)).toBe(80)
  })

  it('normalises weights that sum to LESS than 1.0 (no understatement)', () => {
    const halfWeights: PropensityWeights = {
      icp_fit: 0.1, signal_momentum: 0.1, engagement_depth: 0.05,
      contact_coverage: 0.1, stage_velocity: 0.1, profile_win_rate: 0.05,
    }
    const subScores: SubScoreSet = {
      icp_fit: 100, signal_momentum: 100, engagement_depth: 100,
      contact_coverage: 100, stage_velocity: 100, profile_win_rate: 100,
    }
    // After normalisation, all sub-scores 100 → propensity 100,
    // not the 50 the unnormalised raw sum would yield.
    expect(computePropensity(subScores, halfWeights)).toBe(100)
  })

  it('handles all-zero weights gracefully', () => {
    const zeroWeights: PropensityWeights = {
      icp_fit: 0, signal_momentum: 0, engagement_depth: 0,
      contact_coverage: 0, stage_velocity: 0, profile_win_rate: 0,
    }
    const subScores: SubScoreSet = {
      icp_fit: 100, signal_momentum: 100, engagement_depth: 100,
      contact_coverage: 100, stage_velocity: 100, profile_win_rate: 100,
    }
    // Pathological config: every weight zero → no signal → 0.
    expect(computePropensity(subScores, zeroWeights)).toBe(0)
  })

  it('returns 0 when any sub-score is NaN (corrupt input)', () => {
    const subScores = {
      icp_fit: 80,
      signal_momentum: Number.NaN,
      engagement_depth: 50,
      contact_coverage: 70,
      stage_velocity: 40,
      profile_win_rate: 30,
    } as SubScoreSet
    // Without the NaN guard this would propagate NaN through the
    // propensity into expected_revenue / priority_score and break the
    // inbox.
    expect(computePropensity(subScores, defaultWeights)).toBe(0)
  })

  it('weighted-sum with normalisation matches a hand-rolled calculation', () => {
    const subScores: SubScoreSet = {
      icp_fit: 80,
      signal_momentum: 60,
      engagement_depth: 50,
      contact_coverage: 70,
      stage_velocity: 40,
      profile_win_rate: 30,
    }
    // defaultWeights sum to exactly 1.0 → normalisation is a no-op:
    // 80*0.15 + 60*0.20 + 50*0.15 + 70*0.20 + 40*0.15 + 30*0.15 = 56
    expect(computePropensity(subScores, defaultWeights)).toBe(56)
  })
})
