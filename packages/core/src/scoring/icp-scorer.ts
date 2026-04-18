import type { ICPConfig, ICPDimension } from '../types/config'
import type { DimensionResult, ICPTier, CompanyLocation } from '../types/ontology'
import type { ScoringResult } from '../types/scoring'
import { matchScoringTier, type TierMatchContext } from './tier-matcher'

export interface ICPScorerInput {
  industry?: string | null
  employee_count?: number | null
  hq_city?: string | null
  hq_country?: string | null
  locations?: CompanyLocation[]
  tech_stack?: string[]
  [key: string]: unknown
}

export function computeICPScore(
  company: ICPScorerInput,
  config: ICPConfig
): ScoringResult {
  const dimensions: DimensionResult[] = []
  let totalWeightedScore = 0
  let isDisqualified = false

  for (const dim of config.dimensions) {
    const value = resolveDataSource(company, dim.data_source)

    const context: TierMatchContext = {
      operating_regions: dim.operating_regions,
      job_postings: company.job_postings as { is_temp_flex: boolean }[] | undefined,
      hq_country: company.hq_country as string | undefined,
      locations: company.locations as CompanyLocation[] | undefined,
      high_turnover_industries: (dim as ICPDimension & { high_turnover_industries?: string[] }).high_turnover_industries,
    }

    const match = matchScoringTier(value, dim.scoring_tiers, context)

    if (dim.disqualify_below != null && typeof value === 'number' && value < dim.disqualify_below) {
      isDisqualified = true
    }

    const weightedScore = match.score * dim.weight
    totalWeightedScore += weightedScore

    dimensions.push({
      name: dim.name,
      score: match.score,
      weight: dim.weight,
      weighted_score: weightedScore,
      label: match.label,
    })
  }

  let finalScore = Math.round(totalWeightedScore * 100) / 100

  if (isDisqualified) {
    finalScore = Math.min(finalScore, 25)
  }

  finalScore = Math.max(0, Math.min(100, finalScore))

  const tier = assignTier(finalScore, config.tier_thresholds)

  const topDimension = dimensions.length > 0
    ? dimensions.reduce(
        (max, d) => (d.weighted_score > max.weighted_score ? d : max),
        dimensions[0]
      )
    : null

  return {
    score: finalScore,
    tier,
    dimensions,
    top_reason: topDimension
      ? `${topDimension.name}: ${topDimension.label} (${topDimension.score}pts × ${topDimension.weight}w)`
      : 'No dimensions evaluated',
    computed_at: new Date().toISOString(),
    config_version: config.version,
  }
}

function assignTier(
  score: number,
  thresholds: Record<string, number>
): ICPTier {
  const sorted = Object.entries(thresholds).sort(([, a], [, b]) => b - a)

  for (const [tier, min] of sorted) {
    if (score >= min) return tier as ICPTier
  }

  return 'D'
}

function resolveDataSource(
  company: ICPScorerInput,
  dataSource: string
): unknown {
  const key = dataSource.replace(/^apollo\./, '').replace(/\s*\+\s*.+$/, '')

  if (key === 'hq_location') return company.hq_city
  if (key === 'technologies') return company.tech_stack

  return company[key] ?? null
}
