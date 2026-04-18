import type { Company, Contact, Signal, Opportunity, CRMActivity, FunnelBenchmark } from '../types/ontology'
import type { ICPConfig, ScoringConfig, SignalConfig } from '../types/config'
import type { SubScoreSet, UrgencyComponents } from '../types/scoring'

import { computeICPScore, type ICPScorerInput } from './icp-scorer'
import { computeSignalMomentum } from './signal-scorer'
import { computeEngagementDepth } from './engagement-scorer'
import { computeContactCoverage } from './contact-coverage-scorer'
import { computeStageVelocity } from './velocity-scorer'
import { computeProfileWinRate } from './win-rate-scorer'
import { computePropensity } from './propensity-scorer'
import { computeExpectedRevenue, type ExpectedRevenueResult } from './expected-revenue'

export interface HistoricalDealOutcome {
  industry_group: string | null
  employee_range: string | null
  market: string | null
  is_won: boolean
}

export interface CompositeScoreInput {
  company: Partial<Company>
  contacts: Contact[]
  signals: Signal[]
  opportunities: Opportunity[]
  activities: CRMActivity[]
  benchmarks: FunnelBenchmark[]
  previousSignalScore: number | null
  companyWinRate: number
  historicalDeals?: HistoricalDealOutcome[]
  /**
   * Pre-computed tenant-wide median of per-company 30d activity counts.
   * Callers scoring many companies in one pass (e.g. nightly cron) MUST
   * compute this once across the tenant's companies and pass it in —
   * otherwise `estimateTenantMedian` only sees one company's activities
   * and collapses to a meaningless value.
   */
  tenantMedianActivities30d?: number
}

export interface CompositeScoreResult {
  icp_score: number
  icp_tier: string
  /**
   * Per-dimension breakdown of the ICP score (industry / size / geography
   * / etc.) with score, weight, weighted contribution, and label. Persisted
   * onto `companies.icp_dimensions` (JSONB) so the explain_score tool and
   * /admin/adaptation can show "why this ICP tier" beyond the single
   * top-line reason. The shape mirrors `ScoringResult.dimensions` from
   * the ICP scorer.
   */
  icp_dimensions: { name: string; score: number; weight: number; weighted_score: number; label: string }[]
  signal_score: number
  engagement_score: number
  contact_coverage_score: number
  velocity_score: number
  win_rate_score: number
  propensity: number
  expected_revenue: number
  priority_score: number
  urgency_multiplier: number
  priority_tier: string
  priority_reason: string
}

export interface CompositeScoreConfig {
  icpConfig: ICPConfig
  scoringConfig: ScoringConfig
  signalConfig: SignalConfig
  activeStageCount?: number
}

export function computeCompositeScore(
  input: CompositeScoreInput,
  config: CompositeScoreConfig
): CompositeScoreResult {
  const { company, contacts, signals, opportunities, activities, benchmarks } = input
  const { icpConfig, scoringConfig, signalConfig } = config

  const icpResult = computeICPScore(company as ICPScorerInput, icpConfig)

  const signalResult = computeSignalMomentum(
    { signals, previous_signal_score: input.previousSignalScore },
    signalConfig,
  )

  const tenantMedian =
    input.tenantMedianActivities30d ?? estimateTenantMedian(activities)
  const engagementResult = computeEngagementDepth(
    { activities, tenant_median_activities_30d: tenantMedian },
    scoringConfig,
  )

  const contactResult = computeContactCoverage(
    contacts,
    scoringConfig.contact_coverage,
  )

  const topOpportunity = pickTopOpportunity(opportunities)
  const totalActiveStages = config.activeStageCount ?? 4
  const velocityResult = computeStageVelocity(
    { opportunity: topOpportunity, benchmarks, total_active_stages: totalActiveStages },
    scoringConfig.velocity_ratio_tiers,
  )

  const { similarWon, similarLost } = input.historicalDeals
    ? countSimilarFromHistorical(input.historicalDeals, company)
    : countSimilarOutcomes(opportunities)
  const winRateResult = computeProfileWinRate({
    similar_won: similarWon,
    similar_lost: similarLost,
    company_win_rate: input.companyWinRate,
    blend_threshold: scoringConfig.profile_match.blend_threshold,
  })

  const subScores: SubScoreSet = {
    icp_fit: icpResult.score,
    signal_momentum: signalResult.score,
    engagement_depth: engagementResult.score,
    contact_coverage: contactResult.score,
    stage_velocity: velocityResult.score,
    profile_win_rate: winRateResult.score,
  }

  const propensity = computePropensity(subScores, scoringConfig.propensity_weights)

  const dealValue = resolveDealValue(topOpportunity, icpResult.tier, scoringConfig)
  const urgencyComponents = deriveUrgency(signals, topOpportunity, velocityResult.score)

  const revenueResult: ExpectedRevenueResult = computeExpectedRevenue(
    {
      deal_value: dealValue,
      propensity,
      urgency_components: urgencyComponents,
      // Pass the sub-scores + tenant weights so the priority_reason
      // surfaces the top-3 dimension drivers, not just urgency
      // triggers (per the MISSION's "score AND its reason — top 3
      // only" promise).
      sub_scores: subScores,
      propensity_weights: scoringConfig.propensity_weights,
    },
    scoringConfig,
  )

  return {
    icp_score: icpResult.score,
    icp_tier: icpResult.tier ?? 'D',
    icp_dimensions: icpResult.dimensions,
    signal_score: signalResult.score,
    engagement_score: engagementResult.score,
    contact_coverage_score: contactResult.score,
    velocity_score: velocityResult.score,
    win_rate_score: winRateResult.score,
    propensity,
    expected_revenue: revenueResult.expected_revenue,
    priority_score: revenueResult.priority_score,
    urgency_multiplier: revenueResult.urgency_multiplier,
    priority_tier: revenueResult.priority_tier,
    priority_reason: revenueResult.priority_reason,
  }
}

function pickTopOpportunity(opportunities: Opportunity[]): Opportunity | null {
  const active = opportunities.filter((o) => !o.is_closed)
  if (active.length === 0) return null
  return active.reduce((best, o) =>
    o.stage_order > best.stage_order ? o : best,
    active[0],
  )
}

function countSimilarOutcomes(opportunities: Opportunity[]): {
  similarWon: number
  similarLost: number
} {
  const closed = opportunities.filter((o) => o.is_closed)
  return {
    similarWon: closed.filter((o) => o.is_won).length,
    similarLost: closed.filter((o) => !o.is_won).length,
  }
}

function countSimilarFromHistorical(
  historicalDeals: HistoricalDealOutcome[],
  company: Partial<Company>
): { similarWon: number; similarLost: number } {
  const companyIndustry = (company as Record<string, unknown>).industry_group as string | null
  const companyRange = (company as Record<string, unknown>).employee_range as string | null
  const companyCountry = (company as Record<string, unknown>).hq_country as string | null

  const similar = historicalDeals.filter((deal) => {
    let matches = 0
    let checked = 0

    if (companyIndustry && deal.industry_group) {
      checked++
      if (deal.industry_group.toLowerCase() === companyIndustry.toLowerCase()) matches++
    }
    if (companyRange && deal.employee_range) {
      checked++
      if (deal.employee_range === companyRange) matches++
    }
    if (companyCountry && deal.market) {
      checked++
      if (deal.market.toLowerCase() === companyCountry.toLowerCase()) matches++
    }

    return checked > 0 && matches >= Math.max(1, checked - 1)
  })

  return {
    similarWon: similar.filter((d) => d.is_won).length,
    similarLost: similar.filter((d) => !d.is_won).length,
  }
}

function resolveDealValue(
  opportunity: Opportunity | null,
  icpTier: string | undefined,
  config: ScoringConfig,
): number {
  if (opportunity?.value) return opportunity.value

  const tier = icpTier ?? 'D'
  return config.deal_value_estimation.fallback_values[tier]
    ?? config.deal_value_estimation.fallback_values['C']
    ?? 50000
}

/**
 * Rough median for tenant activity volume when no pre-computed value is
 * available. Uses the input activities themselves — the caller should
 * ideally pass a pre-computed value, but this provides a reasonable
 * fallback so the composite scorer is self-contained.
 */
function estimateTenantMedian(activities: CRMActivity[]): number {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const recent = activities.filter(
    (a) => new Date(a.occurred_at) >= thirtyDaysAgo,
  )
  return Math.max(1, recent.length)
}

function deriveUrgency(
  signals: Signal[],
  opportunity: Opportunity | null,
  velocityScore: number,
): UrgencyComponents {
  const hasImmediateSignal = signals.some((s) => s.urgency === 'immediate')

  const closeWithin30d = opportunity?.expected_close_date
    ? (new Date(opportunity.expected_close_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= 30
    : false

  const competitivePressure = signals.some(
    (s) => s.signal_type === 'competitor_mention',
  )

  const signalSurge = signals.filter(
    (s) => s.recency_days <= 7,
  ).length >= 3

  const stallGoingDark = opportunity?.is_stalled === true || velocityScore <= 15

  return {
    immediate_signal: hasImmediateSignal,
    close_date_within_30d: closeWithin30d,
    competitive_pressure: competitivePressure,
    signal_surge: signalSurge,
    stall_going_dark: stallGoingDark,
  }
}
