/**
 * Pure analysis functions for first-run onboarding. These produce the same
 * shape as the onboarding agent's `propose_icp_config` / `propose_funnel_config`
 * tools, so the wizard UI and the chat-based onboarding agent agree.
 *
 * Keeping these pure means we can run them in a server action without
 * spinning up the AI SDK, and we can unit test them later.
 */

export interface CompanyForAnalysis {
  industry?: string | null
  employee_count?: number | null
  annual_revenue?: number | null
  hq_country?: string | null
}

export interface OpportunityForAnalysis {
  stage?: string | null
  days_in_stage?: number | null
  is_won?: boolean | null
  is_closed?: boolean | null
  value?: number | null
  company_id?: string | null
}

export interface IcpProposal {
  source: 'derived' | 'default'
  analysis?: {
    won_deals_analyzed: number
    total_accounts: number
    top_winning_industries: string[]
    top_winning_countries: string[]
    median_winning_company_size: number
  }
  config: IcpConfig
}

export interface IcpConfig {
  version: string
  dimensions: IcpDimension[]
  tier_thresholds: Record<string, number>
}

export interface IcpDimension {
  name: string
  weight: number
  description: string
  scoring_tiers: Array<{
    conditions?: Array<{ field: string; operator: string; value?: unknown }>
    score: number
    label: string
  }>
}

export interface FunnelProposal {
  source: 'derived' | 'default'
  analysis?: {
    total_deals: number
    stages_found: number
    stage_summary: Array<{ stage: string; deal_count: number; median_days: number | null }>
  }
  config: FunnelConfig
}

export interface FunnelConfig {
  stages: FunnelStage[]
  benchmark_config: {
    rolling_window_days: number
    refresh_frequency: string
    min_deals_for_benchmark: number
    scopes: string[]
  }
  stall_config: {
    default_multiplier: number
    check_frequency: string
  }
}

export interface FunnelStage {
  name: string
  order: number
  crm_field_value: string
  stage_type: 'active' | 'closed_won' | 'closed_lost'
  expected_velocity_days: number
  stall_multiplier: number
  description?: string
}

export function buildIcpProposal(
  wonOpps: OpportunityForAnalysis[],
  allCompanies: CompanyForAnalysis[],
  wonCompanies: CompanyForAnalysis[],
): IcpProposal {
  if (wonOpps.length < 3 || wonCompanies.length < 3) {
    return { source: 'default', config: buildDefaultIcpConfig() }
  }

  const wonIndustries: Record<string, number> = {}
  const wonCountries: Record<string, number> = {}
  const wonSizes: number[] = []

  for (const c of wonCompanies) {
    if (c.industry) wonIndustries[c.industry] = (wonIndustries[c.industry] ?? 0) + 1
    if (c.hq_country) wonCountries[c.hq_country] = (wonCountries[c.hq_country] ?? 0) + 1
    if (c.employee_count) wonSizes.push(c.employee_count)
  }

  const topIndustries = Object.entries(wonIndustries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([n]) => n)

  const topCountries = Object.entries(wonCountries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([n]) => n)

  const sortedSizes = [...wonSizes].sort((a, b) => a - b)
  const medianSize = sortedSizes.length > 0
    ? sortedSizes[Math.floor(sortedSizes.length / 2)]
    : 500

  return {
    source: 'derived',
    analysis: {
      won_deals_analyzed: wonCompanies.length,
      total_accounts: allCompanies.length,
      top_winning_industries: topIndustries,
      top_winning_countries: topCountries,
      median_winning_company_size: medianSize,
    },
    config: {
      version: '1.0',
      dimensions: [
        {
          name: 'industry',
          weight: 0.30,
          description: 'Industry alignment with winning patterns',
          scoring_tiers: [
            { conditions: [{ field: 'industry', operator: 'in', value: topIndustries }], score: 90, label: 'Core industry' },
            { conditions: [{ field: 'industry', operator: 'not_null' }], score: 50, label: 'Other industry' },
            { score: 20, label: 'Unknown' },
          ],
        },
        {
          name: 'company_size',
          weight: 0.25,
          description: `Employee count fit (target ~${medianSize})`,
          scoring_tiers: [
            { conditions: [{ field: 'employee_count', operator: 'between', value: [Math.round(medianSize * 0.3), Math.round(medianSize * 3)] }], score: 90, label: 'Sweet spot' },
            { conditions: [{ field: 'employee_count', operator: 'between', value: [50, Math.round(medianSize * 0.3)] }], score: 60, label: 'Below target' },
            { conditions: [{ field: 'employee_count', operator: 'gte', value: Math.round(medianSize * 3) }], score: 60, label: 'Above target' },
            { score: 30, label: 'Unknown or very small' },
          ],
        },
        {
          name: 'geography',
          weight: 0.20,
          description: 'Geographic fit',
          scoring_tiers: [
            { conditions: [{ field: 'hq_country', operator: 'in', value: topCountries }], score: 90, label: 'Core market' },
            { score: 40, label: 'Other geography' },
          ],
        },
        {
          name: 'revenue',
          weight: 0.15,
          description: 'Annual revenue fit',
          scoring_tiers: [
            { conditions: [{ field: 'annual_revenue', operator: 'gte', value: 5_000_000 }], score: 90, label: 'Strong revenue' },
            { conditions: [{ field: 'annual_revenue', operator: 'gte', value: 1_000_000 }], score: 60, label: 'Moderate revenue' },
            { score: 30, label: 'Small or unknown' },
          ],
        },
        {
          name: 'tech_maturity',
          weight: 0.10,
          description: 'Technology stack maturity indicator',
          scoring_tiers: [
            { conditions: [{ field: 'tech_stack', operator: 'not_empty' }], score: 80, label: 'Tech-forward' },
            { score: 40, label: 'Unknown tech stack' },
          ],
        },
      ],
      tier_thresholds: { A: 80, B: 60, C: 40, D: 0 },
    },
  }
}

export function buildFunnelProposal(
  opps: OpportunityForAnalysis[],
): FunnelProposal {
  if (opps.length === 0) {
    return { source: 'default', config: buildDefaultFunnelConfig() }
  }

  const stages = [...new Set(opps.map((o) => o.stage).filter(Boolean))] as string[]
  if (stages.length === 0) {
    return { source: 'default', config: buildDefaultFunnelConfig() }
  }

  const stageMap: Record<string, { count: number; days: number[] }> = {}
  for (const stage of stages) {
    const stageOpps = opps.filter((o) => o.stage === stage)
    const days = stageOpps.map((o) => o.days_in_stage ?? 0).filter((d) => d > 0)
    stageMap[stage] = { count: stageOpps.length, days }
  }

  const stageConfigs: FunnelStage[] = stages.map((stage, i) => {
    const data = stageMap[stage]
    const sortedDays = [...data.days].sort((a, b) => a - b)
    const medianDays = sortedDays.length > 0 ? sortedDays[Math.floor(sortedDays.length / 2)] : 14
    const stageType: FunnelStage['stage_type'] = stage.toLowerCase().includes('closed')
      ? stage.toLowerCase().includes('won')
        ? 'closed_won'
        : 'closed_lost'
      : 'active'

    return {
      name: stage,
      order: i + 1,
      crm_field_value: stage,
      stage_type: stageType,
      expected_velocity_days: medianDays,
      stall_multiplier: 1.5,
      description: `${data.count} deals observed, median ${medianDays}d`,
    }
  })

  return {
    source: 'derived',
    analysis: {
      total_deals: opps.length,
      stages_found: stages.length,
      stage_summary: Object.entries(stageMap).map(([stage, d]) => ({
        stage,
        deal_count: d.count,
        median_days: d.days.length > 0 ? [...d.days].sort((a, b) => a - b)[Math.floor(d.days.length / 2)] : null,
      })),
    },
    config: {
      stages: stageConfigs,
      benchmark_config: {
        rolling_window_days: 90,
        refresh_frequency: 'weekly',
        min_deals_for_benchmark: 5,
        scopes: ['company', 'rep'],
      },
      stall_config: { default_multiplier: 1.5, check_frequency: 'daily' },
    },
  }
}

function buildDefaultIcpConfig(): IcpConfig {
  return {
    version: '1.0',
    dimensions: [
      { name: 'industry', weight: 0.30, description: 'Industry alignment', scoring_tiers: [{ score: 50, label: 'Default — configure after data analysis' }] },
      { name: 'company_size', weight: 0.25, description: 'Company size fit', scoring_tiers: [{ score: 50, label: 'Default' }] },
      { name: 'geography', weight: 0.20, description: 'Geographic fit', scoring_tiers: [{ score: 50, label: 'Default' }] },
      { name: 'revenue', weight: 0.15, description: 'Revenue fit', scoring_tiers: [{ score: 50, label: 'Default' }] },
      { name: 'tech_maturity', weight: 0.10, description: 'Tech maturity', scoring_tiers: [{ score: 50, label: 'Default' }] },
    ],
    tier_thresholds: { A: 80, B: 60, C: 40, D: 0 },
  }
}

function buildDefaultFunnelConfig(): FunnelConfig {
  return {
    stages: [
      { name: 'Lead', order: 1, crm_field_value: 'Lead', stage_type: 'active', expected_velocity_days: 14, stall_multiplier: 1.5 },
      { name: 'Qualified', order: 2, crm_field_value: 'Qualified', stage_type: 'active', expected_velocity_days: 21, stall_multiplier: 1.5 },
      { name: 'Proposal', order: 3, crm_field_value: 'Proposal', stage_type: 'active', expected_velocity_days: 14, stall_multiplier: 1.5 },
      { name: 'Negotiation', order: 4, crm_field_value: 'Negotiation', stage_type: 'active', expected_velocity_days: 21, stall_multiplier: 1.5 },
    ],
    benchmark_config: { rolling_window_days: 90, refresh_frequency: 'weekly', min_deals_for_benchmark: 5, scopes: ['company', 'rep'] },
    stall_config: { default_multiplier: 1.5, check_frequency: 'daily' },
  }
}
