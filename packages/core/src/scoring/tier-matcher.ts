import type { ScoringTier, TierCondition } from '../types/config'
import type { CompanyLocation } from '../types/ontology'
import type { TierMatchResult } from '../types/scoring'

export interface TierMatchContext {
  operating_regions?: Record<string, string[]>
  job_postings?: { is_temp_flex: boolean }[]
  high_turnover_industries?: string[]
  hq_country?: string | null
  locations?: { city: string; country: string }[]
}

export function matchScoringTier(
  value: unknown,
  tiers: ScoringTier[],
  context?: TierMatchContext
): TierMatchResult {
  for (const tier of tiers) {
    if (evaluateCondition(tier.condition, value, tier, context)) {
      return {
        score: tier.score,
        label: tier.label,
        matched_condition: tier.condition,
      }
    }
  }

  return { score: 0, label: 'No match', matched_condition: 'none' }
}

function evaluateCondition(
  condition: TierCondition,
  value: unknown,
  tier: ScoringTier,
  context?: TierMatchContext
): boolean {
  switch (condition) {
    case 'in':
      return evaluateIn(value, tier.values)

    case 'between':
      return evaluateBetween(value, tier.min, tier.max)

    case 'uses_any':
      return evaluateUsesAny(value, tier.values)

    case 'locations_in_operating_regions':
      return evaluateLocationsInRegions(
        context?.locations ?? (Array.isArray(value) ? value as CompanyLocation[] : undefined),
        tier.min_count ?? 1,
        context?.operating_regions
      )

    case 'active_temp_postings':
      return evaluateTempPostings(context?.job_postings, tier.min_count ?? 1)

    case 'hq_in_country':
      return evaluateIn(context?.hq_country ?? value, tier.values)

    case 'historical_temp_postings':
      return (context?.job_postings?.length ?? 0) > 0

    case 'high_turnover_industry': {
      const industries = context?.high_turnover_industries ?? []
      return typeof value === 'string' && industries.some(
        (i) => i.toLowerCase() === value.toLowerCase()
      )
    }

    case 'default':
      return true

    default:
      return false
  }
}

function evaluateIn(
  value: unknown,
  candidates: string[] | undefined
): boolean {
  if (!candidates || typeof value !== 'string') return false
  const lower = value.toLowerCase()
  return candidates.some((c) => c.toLowerCase() === lower)
}

function evaluateBetween(
  value: unknown,
  min: number | undefined,
  max: number | undefined
): boolean {
  if (typeof value !== 'number' || min == null || max == null) return false
  return value >= min && value <= max
}

function evaluateUsesAny(
  value: unknown,
  candidates: string[] | undefined
): boolean {
  if (!candidates || !Array.isArray(value)) return false
  const lowerCandidates = candidates.map((c) => c.toLowerCase())
  return value.some(
    (v) => typeof v === 'string' && lowerCandidates.includes(v.toLowerCase())
  )
}

function evaluateLocationsInRegions(
  locations: CompanyLocation[] | undefined,
  minCount: number,
  regions: Record<string, string[]> | undefined
): boolean {
  if (!locations || !regions) return false

  const allCities = Object.values(regions)
    .flat()
    .map((c) => c.toLowerCase())

  const matchCount = locations.filter((loc) =>
    allCities.includes(loc.city.toLowerCase())
  ).length

  return matchCount >= minCount
}

function evaluateTempPostings(
  postings: { is_temp_flex: boolean }[] | undefined,
  minCount: number
): boolean {
  if (!postings) return false
  const tempCount = postings.filter((p) => p.is_temp_flex).length
  return tempCount >= minCount
}
