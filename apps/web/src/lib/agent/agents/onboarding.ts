import { z } from 'zod'
import { tool } from 'ai'
import { getServiceSupabase } from '../tools/shared'
import { HubSpotAdapter, SalesforceAdapter } from '@prospector/adapters'
import { recordAdminAction } from '@prospector/core'
import { decryptCredentials, isEncryptedString } from '@/lib/crypto'
import {
  loadBusinessProfile,
  formatAgentHeader,
  formatBusinessContext,
  commonBehaviourRules,
} from './_shared'

/**
 * Resolve the CRM credentials column into a plain object.
 *
 * This is a known production failure mode the previous onboarding agent
 * stub silently triggered: `crm_credentials_encrypted` is a string
 * (AES-256-GCM ciphertext from `lib/crypto.ts`) when
 * `CREDENTIALS_ENCRYPTION_KEY` is set — the previous helper just
 * returned `{}` for strings, so every CRM tool call below ("explore
 * fields", "analyze accounts", etc.) ran against `null` adapter and
 * answered "No CRM connected" even after the user had completed the
 * onboarding wizard.
 *
 * Same pattern as `lib/onboarding/hubspot-webhooks.ts` and the cron
 * sync route — single source of truth lives in `lib/crypto.ts`.
 */
function resolveCrmCredentials(raw: unknown): Record<string, string> {
  if (!raw) return {}
  if (isEncryptedString(raw)) {
    return decryptCredentials(raw) as Record<string, string>
  }
  if (typeof raw === 'object') return raw as Record<string, string>
  return {}
}

async function getCrmAdapter(supabase: ReturnType<typeof getServiceSupabase>, tenantId: string) {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('crm_type, crm_credentials_encrypted')
    .eq('id', tenantId)
    .single()

  if (!tenant?.crm_credentials_encrypted) return null

  const creds = resolveCrmCredentials(tenant.crm_credentials_encrypted)

  if (tenant.crm_type === 'hubspot' && creds.private_app_token) {
    return {
      type: 'hubspot' as const,
      adapter: new HubSpotAdapter({ private_app_token: creds.private_app_token }),
    }
  }
  if (tenant.crm_type === 'salesforce' && creds.client_id) {
    return {
      type: 'salesforce' as const,
      adapter: new SalesforceAdapter({
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        instance_url: creds.instance_url,
        refresh_token: creds.refresh_token,
      }),
    }
  }
  return null
}

export function createOnboardingTools(tenantId: string) {
  const supabase = getServiceSupabase()

  const explore_crm_fields = tool({
    description:
      'Explore what data is available in the connected CRM. Lists object types, key fields, and sample values to understand the data landscape.',
    parameters: z.object({
      object_type: z
        .enum(['accounts', 'deals', 'contacts', 'all'])
        .default('all')
        .describe('Which CRM object to explore'),
      sample_count: z.number().default(10).describe('Number of sample records to pull'),
    }),
    execute: async ({ object_type, sample_count }) => {
      const crm = await getCrmAdapter(supabase, tenantId)
      if (!crm) return { error: 'No CRM connected. Please connect your CRM first.' }

      const results: Record<string, unknown> = {}

      if (object_type === 'all' || object_type === 'accounts') {
        const accounts = await crm.adapter.getAccounts({ limit: sample_count })
        results.accounts = {
          count: accounts.length,
          sample_fields: accounts.length > 0 ? Object.keys(accounts[0]).filter(k => accounts[0][k as keyof typeof accounts[0]] != null) : [],
          samples: accounts.slice(0, 3).map(a => ({
            name: a.name,
            industry: a.industry,
            employee_count: a.employee_count,
            annual_revenue: a.annual_revenue,
            hq_city: a.hq_city,
            hq_country: a.hq_country,
          })),
        }
      }

      if (object_type === 'all' || object_type === 'deals') {
        const deals = await crm.adapter.getOpportunities({})
        results.deals = {
          count: deals.length,
          sample_fields: deals.length > 0 ? Object.keys(deals[0]).filter(k => deals[0][k as keyof typeof deals[0]] != null) : [],
          stages_found: [...new Set(deals.map(d => d.stage).filter(Boolean))],
          samples: deals.slice(0, 3).map(d => ({
            name: d.name,
            value: d.value,
            stage: d.stage,
          })),
        }
      }

      if (object_type === 'all' || object_type === 'contacts') {
        const sampleAccount = (await crm.adapter.getAccounts({ limit: 1 }))[0]
        if (sampleAccount?.crm_id) {
          const contacts = await crm.adapter.getContacts(sampleAccount.crm_id)
          results.contacts = {
            count: contacts.length,
            sample_fields: contacts.length > 0 ? Object.keys(contacts[0]).filter(k => contacts[0][k as keyof typeof contacts[0]] != null) : [],
            samples: contacts.slice(0, 3).map(c => ({
              name: `${c.first_name} ${c.last_name}`,
              title: c.title,
              seniority: c.seniority,
            })),
          }
        } else {
          results.contacts = { count: 0, note: 'No accounts found to sample contacts from' }
        }
      }

      return { crm_type: crm.type, data: results }
    },
  })

  const analyze_account_distribution = tool({
    description:
      'Analyze the distribution of accounts by industry, size, geography, and other dimensions. Helps understand what the customer base looks like.',
    parameters: z.object({
      source: z
        .enum(['crm', 'database'])
        .default('crm')
        .describe('Pull from live CRM or already-synced database'),
      limit: z.number().default(200).describe('Max accounts to analyze'),
    }),
    execute: async ({ source, limit }) => {
      let accounts: Array<{ industry?: string | null; employee_count?: number | null; annual_revenue?: number | null; hq_country?: string | null; hq_city?: string | null }>

      if (source === 'crm') {
        const crm = await getCrmAdapter(supabase, tenantId)
        if (!crm) return { error: 'No CRM connected' }
        accounts = await crm.adapter.getAccounts({ limit })
      } else {
        const { data } = await supabase
          .from('companies')
          .select('industry, employee_count, annual_revenue, hq_country, hq_city')
          .eq('tenant_id', tenantId)
          .limit(limit)
        accounts = data ?? []
      }

      const industryDist: Record<string, number> = {}
      const countryDist: Record<string, number> = {}
      const sizeBuckets = { small: 0, mid: 0, enterprise: 0, unknown: 0 }
      const revenueBuckets = { under_1m: 0, '1m_10m': 0, '10m_100m': 0, '100m_plus': 0, unknown: 0 }

      for (const a of accounts) {
        const ind = a.industry ?? 'Unknown'
        industryDist[ind] = (industryDist[ind] ?? 0) + 1

        const country = a.hq_country ?? 'Unknown'
        countryDist[country] = (countryDist[country] ?? 0) + 1

        if (!a.employee_count) sizeBuckets.unknown++
        else if (a.employee_count < 200) sizeBuckets.small++
        else if (a.employee_count < 1000) sizeBuckets.mid++
        else sizeBuckets.enterprise++

        if (!a.annual_revenue) revenueBuckets.unknown++
        else if (a.annual_revenue < 1_000_000) revenueBuckets.under_1m++
        else if (a.annual_revenue < 10_000_000) revenueBuckets['1m_10m']++
        else if (a.annual_revenue < 100_000_000) revenueBuckets['10m_100m']++
        else revenueBuckets['100m_plus']++
      }

      const topIndustries = Object.entries(industryDist)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)

      return {
        total_accounts: accounts.length,
        industry_distribution: topIndustries,
        country_distribution: Object.entries(countryDist).sort((a, b) => b[1] - a[1]),
        size_distribution: sizeBuckets,
        revenue_distribution: revenueBuckets,
      }
    },
  })

  const analyze_pipeline_history = tool({
    description:
      'Analyze closed deals to understand win rates, average deal sizes, cycle lengths, and stage patterns. Critical for setting funnel benchmarks.',
    parameters: z.object({
      source: z
        .enum(['crm', 'database'])
        .default('crm')
        .describe('Pull from live CRM or already-synced database'),
    }),
    execute: async ({ source }) => {
      let deals: Array<{ value?: number | null; stage?: string | null; is_won?: boolean | null; is_closed?: boolean | null; days_in_stage?: number | null; created_at?: string | null; closed_at?: string | null }>

      if (source === 'crm') {
        const crm = await getCrmAdapter(supabase, tenantId)
        if (!crm) return { error: 'No CRM connected' }
        const allDeals = await crm.adapter.getOpportunities({})
        deals = allDeals
      } else {
        const { data } = await supabase
          .from('opportunities')
          .select('value, stage, is_won, is_closed, days_in_stage, created_at, closed_at')
          .eq('tenant_id', tenantId)
        deals = data ?? []
      }

      const closedDeals = deals.filter(d => d.is_closed)
      const wonDeals = closedDeals.filter(d => d.is_won)
      const lostDeals = closedDeals.filter(d => !d.is_won)
      const openDeals = deals.filter(d => !d.is_closed)

      const avgWonValue = wonDeals.length > 0
        ? Math.round(wonDeals.reduce((s, d) => s + (d.value ?? 0), 0) / wonDeals.length)
        : 0

      const cycleDays = wonDeals
        .filter(d => d.created_at && d.closed_at)
        .map(d => {
          const created = new Date(d.created_at!).getTime()
          const closed = new Date(d.closed_at!).getTime()
          return Math.round((closed - created) / (24 * 60 * 60 * 1000))
        })

      const avgCycleDays = cycleDays.length > 0
        ? Math.round(cycleDays.reduce((s, d) => s + d, 0) / cycleDays.length)
        : null

      const stageDistribution: Record<string, number> = {}
      for (const d of openDeals) {
        const stage = d.stage ?? 'Unknown'
        stageDistribution[stage] = (stageDistribution[stage] ?? 0) + 1
      }

      return {
        total_deals: deals.length,
        closed: closedDeals.length,
        won: wonDeals.length,
        lost: lostDeals.length,
        open: openDeals.length,
        win_rate: closedDeals.length > 0 ? Math.round((wonDeals.length / closedDeals.length) * 100) : null,
        avg_won_deal_value: avgWonValue,
        avg_cycle_days: avgCycleDays,
        median_cycle_days: cycleDays.length > 0 ? cycleDays.sort((a, b) => a - b)[Math.floor(cycleDays.length / 2)] : null,
        open_pipeline_value: openDeals.reduce((s, d) => s + (d.value ?? 0), 0),
        stage_distribution: stageDistribution,
      }
    },
  })

  const analyze_contact_patterns = tool({
    description:
      'Assess contact density, seniority distribution, and role coverage across accounts. Helps understand relationship depth.',
    parameters: z.object({
      sample_accounts: z.number().default(20).describe('Number of accounts to sample'),
    }),
    execute: async ({ sample_accounts }) => {
      const { data: companies } = await supabase
        .from('companies')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .limit(sample_accounts)

      if (!companies?.length) {
        const crm = await getCrmAdapter(supabase, tenantId)
        if (!crm) return { error: 'No data available. Sync CRM first.' }
        return { note: 'No accounts in database yet. Run CRM sync first, then analyze contacts.' }
      }

      const companyIds = companies.map(c => c.id)

      const { data: contacts } = await supabase
        .from('contacts')
        .select('company_id, seniority, title, is_champion, is_decision_maker, is_economic_buyer')
        .eq('tenant_id', tenantId)
        .in('company_id', companyIds)

      const contactsByCompany: Record<string, number> = {}
      const seniorityDist: Record<string, number> = {}
      let championsFound = 0
      let decisionMakersFound = 0

      for (const c of contacts ?? []) {
        contactsByCompany[c.company_id] = (contactsByCompany[c.company_id] ?? 0) + 1
        const sen = c.seniority ?? 'unknown'
        seniorityDist[sen] = (seniorityDist[sen] ?? 0) + 1
        if (c.is_champion) championsFound++
        if (c.is_decision_maker) decisionMakersFound++
      }

      const contactCounts = Object.values(contactsByCompany)
      const avgContactsPerAccount = contactCounts.length > 0
        ? Math.round(contactCounts.reduce((s, n) => s + n, 0) / contactCounts.length * 10) / 10
        : 0
      const accountsWithNoContacts = companies.length - Object.keys(contactsByCompany).length

      return {
        accounts_sampled: companies.length,
        total_contacts: (contacts ?? []).length,
        avg_contacts_per_account: avgContactsPerAccount,
        accounts_with_no_contacts: accountsWithNoContacts,
        seniority_distribution: seniorityDist,
        champions_identified: championsFound,
        decision_makers_identified: decisionMakersFound,
      }
    },
  })

  const propose_icp_config = tool({
    description:
      'Generate an ICP scoring configuration based on won-deal patterns. Analyzes what industries, sizes, and geographies correlate with wins.',
    parameters: z.object({
      use_existing_data: z.boolean().default(true).describe('Use already-synced data in the database'),
    }),
    execute: async () => {
      const { data: wonOpps } = await supabase
        .from('opportunities')
        .select('company_id, value')
        .eq('tenant_id', tenantId)
        .eq('is_won', true)

      const wonCompanyIds = [...new Set((wonOpps ?? []).map(o => o.company_id).filter(Boolean))]

      if (wonCompanyIds.length < 3) {
        return {
          note: 'Not enough won deals to derive patterns. Using sensible defaults.',
          proposed_config: buildDefaultICPConfig(),
        }
      }

      const { data: wonCompanies } = await supabase
        .from('companies')
        .select('industry, employee_count, annual_revenue, hq_country, hq_city')
        .in('id', wonCompanyIds)

      const { data: allCompanies } = await supabase
        .from('companies')
        .select('industry, employee_count, annual_revenue, hq_country')
        .eq('tenant_id', tenantId)

      const wonIndustries: Record<string, number> = {}
      const wonCountries: Record<string, number> = {}
      const wonSizes: number[] = []

      for (const c of wonCompanies ?? []) {
        if (c.industry) wonIndustries[c.industry] = (wonIndustries[c.industry] ?? 0) + 1
        if (c.hq_country) wonCountries[c.hq_country] = (wonCountries[c.hq_country] ?? 0) + 1
        if (c.employee_count) wonSizes.push(c.employee_count)
      }

      const topIndustries = Object.entries(wonIndustries)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name)

      const topCountries = Object.entries(wonCountries)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name)

      const medianSize = wonSizes.length > 0
        ? wonSizes.sort((a, b) => a - b)[Math.floor(wonSizes.length / 2)]
        : 500

      return {
        analysis: {
          won_deals_analyzed: wonCompanyIds.length,
          total_accounts: (allCompanies ?? []).length,
          top_winning_industries: topIndustries,
          top_winning_countries: topCountries,
          median_winning_company_size: medianSize,
        },
        proposed_config: {
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
              description: 'Company size fit based on employee count',
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
    },
  })

  const propose_funnel_config = tool({
    description:
      'Generate funnel stage configuration with velocity thresholds and stall multipliers based on actual pipeline history.',
    parameters: z.object({}),
    execute: async () => {
      const { data: opps } = await supabase
        .from('opportunities')
        .select('stage, days_in_stage, is_closed, is_won, value, created_at, closed_at')
        .eq('tenant_id', tenantId)

      if (!opps?.length) {
        return {
          note: 'No pipeline data found. Using sensible defaults.',
          proposed_config: buildDefaultFunnelConfig(),
        }
      }

      const stageMap: Record<string, { count: number; days: number[]; won: number; total_closed: number }> = {}
      const stages = [...new Set(opps.map(o => o.stage).filter(Boolean))] as string[]

      for (const stage of stages) {
        const stageOpps = opps.filter(o => o.stage === stage)
        const daysArr = stageOpps.map(o => o.days_in_stage ?? 0).filter(d => d > 0)
        stageMap[stage] = {
          count: stageOpps.length,
          days: daysArr,
          won: stageOpps.filter(o => o.is_won).length,
          total_closed: stageOpps.filter(o => o.is_closed).length,
        }
      }

      const stageConfigs = stages.map((stage, i) => {
        const data = stageMap[stage]
        const sortedDays = [...data.days].sort((a, b) => a - b)
        const medianDays = sortedDays.length > 0
          ? sortedDays[Math.floor(sortedDays.length / 2)]
          : 14

        return {
          name: stage,
          order: i + 1,
          crm_field_value: stage,
          stage_type: stage.toLowerCase().includes('closed') ? (stage.toLowerCase().includes('won') ? 'closed_won' : 'closed_lost') : 'active',
          expected_velocity_days: medianDays,
          stall_multiplier: 1.5,
          description: `${data.count} deals observed, median ${medianDays} days`,
        }
      })

      return {
        analysis: {
          total_deals: opps.length,
          stages_found: stages.length,
          stage_summary: Object.entries(stageMap).map(([stage, data]) => ({
            stage,
            deal_count: data.count,
            median_days: data.days.length > 0
              ? [...data.days].sort((a, b) => a - b)[Math.floor(data.days.length / 2)]
              : null,
          })),
        },
        proposed_config: {
          stages: stageConfigs,
          benchmark_config: {
            rolling_window_days: 90,
            refresh_frequency: 'weekly',
            min_deals_for_benchmark: 5,
            scopes: ['company', 'rep'],
          },
          stall_config: {
            default_multiplier: 1.5,
            check_frequency: 'daily',
          },
        },
      }
    },
  })

  const apply_icp_config = tool({
    description:
      'Persist an ICP scoring configuration to the tenant. Use only after the user has reviewed and accepted a proposed config (or an edited version). Writes tenants.icp_config — subsequent scoring runs will use this immediately.',
    parameters: z.object({
      config: z
        .object({
          version: z.string().default('1.0'),
          dimensions: z.array(z.unknown()).min(1).describe('ICP scoring dimensions with weights and tiers'),
          tier_thresholds: z.record(z.string(), z.number()).optional(),
        })
        .passthrough()
        .describe('Full ICP config object — typically the proposed_config returned by propose_icp_config'),
      note: z.string().optional().describe('Optional note explaining what changed'),
    }),
    execute: async ({ config, note }) => {
      const stamped = {
        ...(config as Record<string, unknown>),
        _updated_at: new Date().toISOString(),
        _updated_note: note ?? null,
      }

      // Phase 3 T2.1 — capture prior icp_config for the audit row.
      // Best-effort: failure to read just means before=null in the
      // audit; never blocks the apply.
      let priorIcp: unknown = null
      try {
        const { data: prior } = await supabase
          .from('tenants')
          .select('icp_config')
          .eq('id', tenantId)
          .single()
        priorIcp = (prior as { icp_config?: unknown } | null)?.icp_config ?? null
      } catch {
        // Swallow — audit-log is not load-bearing for the apply.
      }

      const { error } = await supabase
        .from('tenants')
        .update({ icp_config: stamped, updated_at: new Date().toISOString() })
        .eq('id', tenantId)

      if (error) {
        return { success: false, error: `Failed to save ICP config: ${error.message}` }
      }

      // Phase 3 T2.1 — audit AFTER successful apply. The agent
      // surface (admin / leader role per tool_registry seed) is
      // technically a system-actor here because `apply_icp_config`
      // is invoked by the model on behalf of the human, not the
      // human directly. user_id is null per the audit module's
      // contract for system actions; metadata.invoked_via='agent'
      // makes the provenance explicit.
      void recordAdminAction(supabase, {
        tenant_id: tenantId,
        user_id: null,
        action: 'onboarding.apply_icp',
        target: 'tenants.icp_config',
        before: priorIcp,
        after: stamped,
        metadata: {
          invoked_via: 'agent',
          tool_slug: 'apply_icp_config',
          note: note ?? null,
          dimensions_count: (config as { dimensions?: unknown[] }).dimensions?.length ?? 0,
        },
      })

      return {
        success: true,
        message: 'ICP configuration saved. Next scoring run will use these dimensions.',
        version: (config as { version?: string }).version ?? '1.0',
        dimensions_count: (config as { dimensions?: unknown[] }).dimensions?.length ?? 0,
        note: note ?? null,
      }
    },
  })

  const apply_funnel_config = tool({
    description:
      'Persist a funnel stage configuration to the tenant. Use only after the user has reviewed and accepted a proposed config. Writes tenants.funnel_config — the next benchmark cron run will compute against these stages.',
    parameters: z.object({
      config: z
        .object({
          stages: z.array(z.unknown()).min(1).describe('Ordered funnel stages with stage_type and velocity'),
          benchmark_config: z.record(z.string(), z.unknown()).optional(),
          stall_config: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough()
        .describe('Full funnel config object — typically the proposed_config returned by propose_funnel_config'),
      note: z.string().optional().describe('Optional note explaining what changed'),
    }),
    execute: async ({ config, note }) => {
      const stamped = {
        ...(config as Record<string, unknown>),
        _updated_at: new Date().toISOString(),
        _updated_note: note ?? null,
      }

      // Phase 3 T2.1 — capture prior funnel_config for the audit
      // row. Best-effort.
      let priorFunnel: unknown = null
      try {
        const { data: prior } = await supabase
          .from('tenants')
          .select('funnel_config')
          .eq('id', tenantId)
          .single()
        priorFunnel = (prior as { funnel_config?: unknown } | null)?.funnel_config ?? null
      } catch {
        // Swallow.
      }

      const { error } = await supabase
        .from('tenants')
        .update({ funnel_config: stamped, updated_at: new Date().toISOString() })
        .eq('id', tenantId)

      if (error) {
        return { success: false, error: `Failed to save funnel config: ${error.message}` }
      }

      void recordAdminAction(supabase, {
        tenant_id: tenantId,
        user_id: null,
        action: 'onboarding.apply_funnel',
        target: 'tenants.funnel_config',
        before: priorFunnel,
        after: stamped,
        metadata: {
          invoked_via: 'agent',
          tool_slug: 'apply_funnel_config',
          note: note ?? null,
          stages_count: (config as { stages?: unknown[] }).stages?.length ?? 0,
        },
      })

      return {
        success: true,
        message: 'Funnel configuration saved. The next benchmark run will use these stages.',
        stages_count: (config as { stages?: unknown[] }).stages?.length ?? 0,
        note: note ?? null,
      }
    },
  })

  return {
    explore_crm_fields,
    analyze_account_distribution,
    analyze_pipeline_history,
    analyze_contact_patterns,
    propose_icp_config,
    propose_funnel_config,
    apply_icp_config,
    apply_funnel_config,
  }
}

function buildDefaultICPConfig() {
  return {
    version: '1.0',
    dimensions: [
      { name: 'industry', weight: 0.30, description: 'Industry alignment', scoring_tiers: [{ score: 50, label: 'Default - configure after data analysis' }] },
      { name: 'company_size', weight: 0.25, description: 'Company size fit', scoring_tiers: [{ score: 50, label: 'Default' }] },
      { name: 'geography', weight: 0.20, description: 'Geographic fit', scoring_tiers: [{ score: 50, label: 'Default' }] },
      { name: 'revenue', weight: 0.15, description: 'Revenue fit', scoring_tiers: [{ score: 50, label: 'Default' }] },
      { name: 'tech_maturity', weight: 0.10, description: 'Tech maturity', scoring_tiers: [{ score: 50, label: 'Default' }] },
    ],
    tier_thresholds: { A: 80, B: 60, C: 40, D: 0 },
  }
}

function buildDefaultFunnelConfig() {
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

export async function buildOnboardingCoachPrompt(tenantId: string): Promise<string> {
  const profile = await loadBusinessProfile(tenantId)

  const header = formatAgentHeader(
    'the Onboarding Coach',
    'Set up Revenue AI OS for a new customer by exploring their CRM, proposing scoring configs, and persisting them once approved.',
    profile,
  )

  const role = `## Role: Onboarding Coach
You guide a brand-new customer through first-run setup. Always explore real data first, then propose; persist only after the user accepts.

**Your sequence:**
1. Use explore_crm_fields to confirm what's in the CRM.
2. Use analyze_account_distribution and analyze_pipeline_history to find shape.
3. Use propose_icp_config and propose_funnel_config to draft tenant configs.
4. Walk the user through each proposal in plain English (one dimension at a time).
5. Once the user explicitly accepts (or edits), call apply_icp_config / apply_funnel_config to persist.

**Guidelines:**
- Be transparent about what data you found and what's missing.
- For each proposed dimension, name the data point that justifies it (e.g. "78% of won deals were in the staffing industry").
- If there isn't enough data (e.g. fewer than 10 closed deals), say so and use defaults.
- Never apply a config without the user explicitly saying yes.
- The goal: make the system immediately useful with real-data-driven defaults.`

  return [
    header,
    formatBusinessContext(profile),
    role,
    commonBehaviourRules(),
  ].join('\n\n')
}
