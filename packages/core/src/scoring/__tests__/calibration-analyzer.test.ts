import { describe, expect, it } from 'vitest'
import {
  analyzeCalibration,
  shouldAutoApply,
  type DealOutcomeRecord,
  type PropensityWeights,
} from '../calibration-analyzer'

/**
 * Tests for the scoring calibration analyser. These pin the behaviours
 * the production workflow (`apps/web/src/lib/workflows/scoring-calibration.ts`)
 * and the admin approve flow rely on.
 */

const DEFAULT_WEIGHTS: PropensityWeights = {
  icp_fit: 0.2,
  signal_momentum: 0.15,
  engagement_depth: 0.15,
  contact_coverage: 0.1,
  stage_velocity: 0.2,
  profile_win_rate: 0.2,
}

function makeDeal(overrides: Partial<DealOutcomeRecord>): DealOutcomeRecord {
  return {
    icp_score_at_entry: 50,
    signal_score_at_entry: 50,
    engagement_score_at_entry: 50,
    contact_coverage_at_entry: 50,
    velocity_at_entry: 50,
    win_rate_at_entry: 50,
    propensity_at_entry: 50,
    outcome: 'won',
    ...overrides,
  }
}

describe('analyzeCalibration — sample-size gates', () => {
  it('returns null below the default min sample size (30)', () => {
    const deals = Array.from({ length: 20 }, (_, i) =>
      makeDeal({ outcome: i % 2 === 0 ? 'won' : 'lost' }),
    )
    expect(analyzeCalibration(deals, DEFAULT_WEIGHTS)).toBeNull()
  })

  it('respects a custom min sample size', () => {
    const deals = Array.from({ length: 15 }, (_, i) =>
      makeDeal({ outcome: i % 2 === 0 ? 'won' : 'lost' }),
    )
    // 15 deals, min 10 → analysis runs.
    expect(analyzeCalibration(deals, DEFAULT_WEIGHTS, 10)).not.toBeNull()
  })

  it('returns null when fewer than 5 wins or 5 losses', () => {
    // 30 deals total but only 4 wins → too few to compare distributions.
    const deals: DealOutcomeRecord[] = [
      ...Array.from({ length: 4 }, () => makeDeal({ outcome: 'won' })),
      ...Array.from({ length: 26 }, () => makeDeal({ outcome: 'lost' })),
    ]
    expect(analyzeCalibration(deals, DEFAULT_WEIGHTS)).toBeNull()
  })

  it('drops rows whose propensity_at_entry is null', () => {
    const deals = Array.from({ length: 40 }, (_, i) =>
      makeDeal({
        outcome: i % 2 === 0 ? 'won' : 'lost',
        propensity_at_entry: i < 20 ? null : 50,
      }),
    )
    // After dropping 20 nulls → 20 valid → still under min sample 30.
    expect(analyzeCalibration(deals, DEFAULT_WEIGHTS)).toBeNull()
  })
})

describe('analyzeCalibration — discrimination', () => {
  it('proposes higher weight for the dimension that best discriminates wins from losses', () => {
    // ICP discriminates strongly (won ~90, lost ~30); other dimensions are
    // flat with small noise. We need non-zero variance in every dimension
    // (otherwise pooledStd = 0 → discrimination = 0 across the board) and
    // a clear signal in ICP for it to outrank the others.
    const wins = Array.from({ length: 20 }, (_, i) =>
      makeDeal({
        outcome: 'won',
        icp_score_at_entry: 85 + (i % 5),
        signal_score_at_entry: 48 + (i % 5),
        engagement_score_at_entry: 48 + (i % 5),
        contact_coverage_at_entry: 48 + (i % 5),
        velocity_at_entry: 48 + (i % 5),
        win_rate_at_entry: 48 + (i % 5),
      }),
    )
    const losses = Array.from({ length: 20 }, (_, i) =>
      makeDeal({
        outcome: 'lost',
        icp_score_at_entry: 25 + (i % 5),
        signal_score_at_entry: 48 + (i % 5),
        engagement_score_at_entry: 48 + (i % 5),
        contact_coverage_at_entry: 48 + (i % 5),
        velocity_at_entry: 48 + (i % 5),
        win_rate_at_entry: 48 + (i % 5),
      }),
    )
    const result = analyzeCalibration([...wins, ...losses], DEFAULT_WEIGHTS)
    expect(result).not.toBeNull()
    if (!result) return

    const icp = result.dimension_analysis.find((d) => d.dimension === 'icp_fit')
    expect(icp).toBeDefined()
    expect(icp!.proposed_weight).toBeGreaterThan(icp!.current_weight)
    // Flat dimensions (no won/lost separation) should drop weight.
    const signal = result.dimension_analysis.find((d) => d.dimension === 'signal_momentum')
    expect(signal!.proposed_weight).toBeLessThan(signal!.current_weight)
  })

  it('proposes equal weights when no dimension discriminates at all', () => {
    const flatDeals: DealOutcomeRecord[] = [
      ...Array.from({ length: 20 }, () => makeDeal({ outcome: 'won' })),
      ...Array.from({ length: 20 }, () => makeDeal({ outcome: 'lost' })),
    ]
    const result = analyzeCalibration(flatDeals, DEFAULT_WEIGHTS)
    expect(result).not.toBeNull()
    if (!result) return
    // Every proposed weight should be ~1/6 ≈ 0.167.
    for (const d of result.dimension_analysis) {
      expect(Math.abs(d.proposed_weight - 1 / 6)).toBeLessThan(0.01)
    }
  })

  it('proposed weights always sum to 1.0', () => {
    const deals: DealOutcomeRecord[] = [
      ...Array.from({ length: 30 }, () =>
        makeDeal({ outcome: 'won', icp_score_at_entry: 70 + Math.random() * 20 }),
      ),
      ...Array.from({ length: 30 }, () =>
        makeDeal({ outcome: 'lost', icp_score_at_entry: 20 + Math.random() * 20 }),
      ),
    ]
    const result = analyzeCalibration(deals, DEFAULT_WEIGHTS)
    expect(result).not.toBeNull()
    if (!result) return
    const sum = Object.values(result.proposed_weights).reduce((a, b) => a + b, 0)
    // Allow a slightly looser tolerance — `normalizeWeights` distributes
    // rounding remainder to the first dimension, so the float drift can
    // reach ~0.003 in extreme cases.
    expect(Math.abs(sum - 1)).toBeLessThan(0.005)
  })

  it('reports a confidence level based on sample size', () => {
    const small = [
      ...Array.from({ length: 25 }, () => makeDeal({ outcome: 'won' })),
      ...Array.from({ length: 25 }, () => makeDeal({ outcome: 'lost' })),
    ]
    const big = [
      ...Array.from({ length: 60 }, () =>
        makeDeal({ outcome: 'won', icp_score_at_entry: 80 }),
      ),
      ...Array.from({ length: 60 }, () =>
        makeDeal({ outcome: 'lost', icp_score_at_entry: 30 }),
      ),
    ]
    expect(analyzeCalibration(small, DEFAULT_WEIGHTS)?.confidence).toBe('medium')
    expect(analyzeCalibration(big, DEFAULT_WEIGHTS)?.confidence).toBe('high')
  })
})

describe('shouldAutoApply', () => {
  it('refuses to auto-apply when proposed AUC is not better than current', () => {
    const deals = [
      ...Array.from({ length: 30 }, () => makeDeal({ outcome: 'won' })),
      ...Array.from({ length: 30 }, () => makeDeal({ outcome: 'lost' })),
    ]
    const result = analyzeCalibration(deals, DEFAULT_WEIGHTS)!
    // Force proposed AUC ≤ model AUC.
    const tweaked = { ...result, proposed_auc: result.model_auc - 0.01 }
    expect(shouldAutoApply(tweaked)).toBe(false)
  })

  it('refuses to auto-apply on low confidence', () => {
    const result = analyzeCalibration(
      [
        ...Array.from({ length: 5 }, () => makeDeal({ outcome: 'won' })),
        ...Array.from({ length: 5 }, () => makeDeal({ outcome: 'lost' })),
      ],
      DEFAULT_WEIGHTS,
      10,
    )!
    expect(result.confidence).toBe('low')
    expect(shouldAutoApply(result)).toBe(false)
  })

  it('refuses to auto-apply when any dimension change exceeds maxChangePct', () => {
    // We test the per-dimension cap in isolation — synthesising input
    // data that simultaneously (a) produces a non-zero discrimination
    // pattern, (b) yields proposed_auc > model_auc, and (c) keeps each
    // change within a tight cap is fragile. The other gates
    // (AUC improvement, low confidence) are tested above.
    //
    // Construct a result where every other gate passes, then verify
    // the cap is the deciding factor.
    const result = {
      current_weights: {
        icp_fit: 0.2, signal_momentum: 0.15, engagement_depth: 0.15,
        contact_coverage: 0.1, stage_velocity: 0.2, profile_win_rate: 0.2,
      },
      proposed_weights: {
        icp_fit: 0.5, signal_momentum: 0.05, engagement_depth: 0.05,
        contact_coverage: 0.1, stage_velocity: 0.15, profile_win_rate: 0.15,
      },
      dimension_analysis: [
        { dimension: 'icp_fit', won_avg: 80, lost_avg: 30, won_std: 5, lost_std: 5,
          discrimination: 1.5, current_weight: 0.2, proposed_weight: 0.5, change_pct: 150 },
        { dimension: 'signal_momentum', won_avg: 50, lost_avg: 50, won_std: 5, lost_std: 5,
          discrimination: 0, current_weight: 0.15, proposed_weight: 0.05, change_pct: -66.7 },
        { dimension: 'engagement_depth', won_avg: 50, lost_avg: 50, won_std: 5, lost_std: 5,
          discrimination: 0, current_weight: 0.15, proposed_weight: 0.05, change_pct: -66.7 },
        { dimension: 'contact_coverage', won_avg: 50, lost_avg: 50, won_std: 5, lost_std: 5,
          discrimination: 0, current_weight: 0.1, proposed_weight: 0.1, change_pct: 0 },
        { dimension: 'stage_velocity', won_avg: 60, lost_avg: 50, won_std: 5, lost_std: 5,
          discrimination: 0.3, current_weight: 0.2, proposed_weight: 0.15, change_pct: -25 },
        { dimension: 'profile_win_rate', won_avg: 60, lost_avg: 50, won_std: 5, lost_std: 5,
          discrimination: 0.3, current_weight: 0.2, proposed_weight: 0.15, change_pct: -25 },
      ],
      model_auc: 0.62,
      proposed_auc: 0.71,
      sample_size: 80,
      won_count: 40,
      lost_count: 40,
      confidence: 'medium' as const,
    }
    // Cap of 10% — ICP exceeds it (150%) so auto-apply rejects.
    expect(shouldAutoApply(result, 10)).toBe(false)
    // Cap of 200% — every dimension change is within bounds and the
    // other gates pass, so auto-apply opens.
    expect(shouldAutoApply(result, 200)).toBe(true)
  })
})
