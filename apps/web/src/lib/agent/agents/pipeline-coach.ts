import { z } from 'zod'
import { tool } from 'ai'
import type { AgentContext } from '@prospector/core'
import { getServiceSupabase } from '../tools/shared'
import {
  loadBusinessProfile,
  formatAgentHeader,
  formatBusinessContext,
  formatRepPreferences,
  commonBehaviourRules,
  commonSalesPlaybook,
  formatPackedSections,
  joinPromptParts,
  type SystemPromptParts,
} from './_shared'
import type { PackedContext } from '../context'

export function createPipelineCoachTools(tenantId: string, repId: string) {
  const supabase = getServiceSupabase()

  const get_pipeline_overview = tool({
    description:
      'Get the rep\'s open deals with stages, values, and days-in-stage. Use for "show my pipeline", "what deals do I have", "what\'s open".',
    parameters: z.object({
      sort_by: z
        .enum(['value', 'days_in_stage', 'stage'])
        .default('value')
        .describe('Sort deals by this field'),
      limit: z.number().default(20).describe('Max deals to return'),
    }),
    execute: async ({ sort_by, limit }) => {
      const ascending = sort_by === 'days_in_stage'
        ? false
        : sort_by === 'value'
          ? false
          : true

      const { data, error } = await supabase
        .from('opportunities')
        .select('id, crm_id, name, value, stage, days_in_stage, is_stalled, stall_reason, expected_close_date, company_id')
        .eq('tenant_id', tenantId)
        .eq('owner_crm_id', repId)
        .eq('is_closed', false)
        .order(sort_by, { ascending })
        .limit(limit)

      if (error) throw new Error(`Pipeline query failed: ${error.message}`)

      const companyIds = [...new Set((data ?? []).map(d => d.company_id).filter(Boolean))]
      let companyMap: Record<string, string> = {}
      if (companyIds.length > 0) {
        const { data: companies } = await supabase
          .from('companies')
          .select('id, name')
          .in('id', companyIds)
        companyMap = Object.fromEntries((companies ?? []).map(c => [c.id, c.name]))
      }

      const deals = (data ?? []).map(d => ({
        ...d,
        company_name: companyMap[d.company_id] ?? 'Unknown',
      }))

      const totalValue = deals.reduce((sum, d) => sum + (d.value ?? 0), 0)
      const stalledCount = deals.filter(d => d.is_stalled).length

      return {
        total_deals: deals.length,
        total_pipeline_value: totalValue,
        stalled_count: stalledCount,
        deals,
      }
    },
  })

  const get_deal_detail = tool({
    description:
      'Analyse a specific deal: health assessment, contacts involved, stage benchmark, and recommended actions. Use for "how is my deal with X", "what should I do about X".',
    parameters: z.object({
      deal_name: z.string().describe('Deal name to look up'),
    }),
    execute: async ({ deal_name }) => {
      const { data: deal } = await supabase
        .from('opportunities')
        .select('*')
        .eq('tenant_id', tenantId)
        .ilike('name', `%${deal_name}%`)
        .limit(1)
        .single()

      if (!deal) return { error: `Deal "${deal_name}" not found` }

      const [contactsRes, benchRes, companyRes] = await Promise.all([
        supabase
          .from('contacts')
          .select('first_name, last_name, title, seniority, is_champion, is_economic_buyer, is_decision_maker, phone, email, last_activity_date')
          .eq('tenant_id', tenantId)
          .eq('company_id', deal.company_id)
          .limit(10),
        supabase
          .from('funnel_benchmarks')
          .select('median_days_in_stage, conversion_rate, drop_rate')
          .eq('tenant_id', tenantId)
          .eq('scope', 'company')
          .eq('scope_id', 'all')
          .eq('stage_name', deal.stage)
          .limit(1)
          .single(),
        supabase
          .from('companies')
          .select('name, icp_tier, propensity, priority_tier')
          .eq('id', deal.company_id)
          .single(),
      ])

      const medianDays = benchRes.data?.median_days_in_stage ?? 14
      const stallThreshold = Math.round(medianDays * 1.5)

      return {
        deal: {
          name: deal.name,
          value: deal.value,
          stage: deal.stage,
          days_in_stage: deal.days_in_stage,
          is_stalled: deal.is_stalled,
          stall_reason: deal.stall_reason,
          expected_close_date: deal.expected_close_date,
        },
        company: companyRes.data ?? null,
        health: deal.is_stalled
          ? 'stalled'
          : deal.days_in_stage > stallThreshold
            ? 'at_risk'
            : 'on_track',
        benchmark: {
          median_days: medianDays,
          stall_threshold: stallThreshold,
          conversion_rate: benchRes.data?.conversion_rate ?? null,
          drop_rate: benchRes.data?.drop_rate ?? null,
        },
        contacts: contactsRes.data ?? [],
      }
    },
  })

  const get_funnel_benchmarks = tool({
    description:
      'Compare the rep\'s stage-by-stage conversion rates against company benchmarks. Use for "how is my pipeline health", "where am I losing deals", "funnel diagnosis".',
    parameters: z.object({
      stage_filter: z.string().optional().describe('Focus on a specific stage name'),
    }),
    execute: async ({ stage_filter }) => {
      let repQuery = supabase
        .from('funnel_benchmarks')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('scope', 'rep')
        .eq('scope_id', repId)

      if (stage_filter) {
        repQuery = repQuery.eq('stage_name', stage_filter)
      }

      const [repBench, companyBench] = await Promise.all([
        repQuery,
        supabase
          .from('funnel_benchmarks')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('scope', 'company')
          .eq('scope_id', 'all'),
      ])

      return {
        stages: (repBench.data ?? []).map(rb => {
          const cb = (companyBench.data ?? []).find(c => c.stage_name === rb.stage_name)
          return {
            stage: rb.stage_name,
            rep_conv_rate: rb.conversion_rate,
            rep_drop_rate: rb.drop_rate,
            benchmark_conv_rate: cb?.conversion_rate ?? 0,
            benchmark_drop_rate: cb?.drop_rate ?? 0,
            delta_drop: Math.round((rb.drop_rate - (cb?.drop_rate ?? 0)) * 100) / 100,
            deals: rb.deal_count,
            avg_days: rb.avg_days_in_stage,
            stalls: rb.stall_count,
          }
        }),
      }
    },
  })

  const detect_stalls = tool({
    description:
      'Find deals that are stalled or at risk of stalling based on benchmark velocity thresholds. Use for "what deals are stuck", "stalled deals", "what needs attention".',
    parameters: z.object({
      include_at_risk: z.boolean().default(true).describe('Also include deals approaching stall threshold'),
    }),
    execute: async ({ include_at_risk }) => {
      const [dealsRes, benchRes] = await Promise.all([
        supabase
          .from('opportunities')
          .select('id, name, value, stage, days_in_stage, is_stalled, stall_reason, expected_close_date, company_id')
          .eq('tenant_id', tenantId)
          .eq('owner_crm_id', repId)
          .eq('is_closed', false)
          .order('days_in_stage', { ascending: false }),
        supabase
          .from('funnel_benchmarks')
          .select('stage_name, median_days_in_stage')
          .eq('tenant_id', tenantId)
          .eq('scope', 'company')
          .eq('scope_id', 'all'),
      ])

      const benchmarkMap = Object.fromEntries(
        (benchRes.data ?? []).map(b => [b.stage_name, b.median_days_in_stage])
      )

      const companyIds = [...new Set((dealsRes.data ?? []).map(d => d.company_id).filter(Boolean))]
      let companyMap: Record<string, string> = {}
      if (companyIds.length > 0) {
        const { data: companies } = await supabase
          .from('companies')
          .select('id, name')
          .in('id', companyIds)
        companyMap = Object.fromEntries((companies ?? []).map(c => [c.id, c.name]))
      }

      const results = (dealsRes.data ?? [])
        .map(d => {
          const median = benchmarkMap[d.stage] ?? 14
          const stallThreshold = Math.round(median * 1.5)
          const status = d.is_stalled
            ? 'stalled'
            : d.days_in_stage > stallThreshold
              ? 'at_risk'
              : d.days_in_stage > median
                ? 'monitor'
                : 'on_track'
          return {
            ...d,
            company_name: companyMap[d.company_id] ?? 'Unknown',
            median_days: median,
            stall_threshold: stallThreshold,
            status,
          }
        })
        .filter(d => d.status === 'stalled' || (include_at_risk && d.status === 'at_risk'))

      return { stalled_and_at_risk: results }
    },
  })

  const suggest_next_action = tool({
    description:
      'Based on deal stage, stall status, and contact coverage, suggest concrete next actions. Use for "what should I do next", "how do I move this forward".',
    parameters: z.object({
      deal_name: z.string().describe('Deal name to get actions for'),
    }),
    execute: async ({ deal_name }) => {
      const { data: deal } = await supabase
        .from('opportunities')
        .select('*')
        .eq('tenant_id', tenantId)
        .ilike('name', `%${deal_name}%`)
        .limit(1)
        .single()

      if (!deal) return { error: `Deal "${deal_name}" not found` }

      const [contactsRes, signalsRes, benchRes] = await Promise.all([
        supabase
          .from('contacts')
          .select('first_name, last_name, title, seniority, is_champion, is_decision_maker, is_economic_buyer, last_activity_date')
          .eq('tenant_id', tenantId)
          .eq('company_id', deal.company_id),
        supabase
          .from('signals')
          .select('signal_type, title, urgency')
          .eq('tenant_id', tenantId)
          .eq('company_id', deal.company_id)
          .order('detected_at', { ascending: false })
          .limit(5),
        supabase
          .from('funnel_benchmarks')
          .select('median_days_in_stage')
          .eq('tenant_id', tenantId)
          .eq('scope', 'company')
          .eq('scope_id', 'all')
          .eq('stage_name', deal.stage)
          .limit(1)
          .single(),
      ])

      const contacts = contactsRes.data ?? []
      const hasChampion = contacts.some(c => c.is_champion)
      const hasDecisionMaker = contacts.some(c => c.is_decision_maker)
      const hasEconomicBuyer = contacts.some(c => c.is_economic_buyer)
      const medianDays = benchRes.data?.median_days_in_stage ?? 14

      return {
        deal: {
          name: deal.name,
          value: deal.value,
          stage: deal.stage,
          days_in_stage: deal.days_in_stage,
          is_stalled: deal.is_stalled,
          stall_reason: deal.stall_reason,
        },
        contact_coverage: {
          total: contacts.length,
          has_champion: hasChampion,
          has_decision_maker: hasDecisionMaker,
          has_economic_buyer: hasEconomicBuyer,
        },
        active_signals: signalsRes.data ?? [],
        benchmark_median_days: medianDays,
        contacts: contacts.map(c => ({
          name: `${c.first_name} ${c.last_name}`,
          title: c.title,
          seniority: c.seniority,
          last_activity: c.last_activity_date,
        })),
      }
    },
  })

  const explain_score = tool({
    description:
      'Show the breakdown of an account\'s priority score: ICP, signal, engagement, contact coverage, velocity, and win rate. Use for "why is X high priority", "explain this score".',
    parameters: z.object({
      account_name: z.string().describe('Company name to explain'),
    }),
    execute: async ({ account_name }) => {
      const { data: company } = await supabase
        .from('companies')
        .select('id, crm_id, name, propensity, priority_tier, priority_reason, icp_score, icp_tier, signal_score, engagement_score, contact_coverage_score, velocity_score, win_rate_score, expected_revenue, urgency_multiplier')
        .eq('tenant_id', tenantId)
        .ilike('name', `%${account_name}%`)
        .limit(1)
        .single()

      if (!company) return { error: `Account "${account_name}" not found` }

      return {
        company: {
          id: company.id,
          crm_id: company.crm_id,
          name: company.name,
          propensity: company.propensity,
          priority_tier: company.priority_tier,
          priority_reason: company.priority_reason,
          expected_revenue: company.expected_revenue,
          urgency_multiplier: company.urgency_multiplier,
        },
        breakdown: [
          { dimension: 'ICP fit', score: company.icp_score, tier: company.icp_tier },
          { dimension: 'Signal momentum', score: company.signal_score },
          { dimension: 'Engagement depth', score: company.engagement_score },
          { dimension: 'Contact coverage', score: company.contact_coverage_score },
          { dimension: 'Stage velocity', score: company.velocity_score },
          { dimension: 'Profile win rate', score: company.win_rate_score },
        ],
      }
    },
  })

  return {
    get_pipeline_overview,
    get_deal_detail,
    get_funnel_benchmarks,
    detect_stalls,
    suggest_next_action,
    explain_score,
  }
}

export async function buildPipelineCoachPromptParts(
  tenantId: string,
  ctx: AgentContext | null,
  packed: PackedContext | null = null,
): Promise<SystemPromptParts> {
  const profile = await loadBusinessProfile(tenantId)

  const repName = ctx?.rep_profile?.name ?? 'the rep'
  const header = formatAgentHeader(
    'the Pipeline Coach',
    `Help ${repName} understand pipeline health, spot stalls early, and decide the next action.`,
    profile,
  )

  const role = `## Role: Pipeline Coach
- Always compare deal velocity against company benchmarks (use get_funnel_benchmarks).
- For stalled deals, explain WHY (days vs median, missing stakeholders, no recent activity) and suggest a specific unstalling action.
- Flag contact coverage gaps (no champion, no economic buyer, no decision maker).
- Prioritise high-value deals and urgent signals.
- For "why is X high priority", call explain_score and walk through the dimensions.`

  // Static prefix — cacheable across turns within the same (tenant, role).
  const staticPrefix = [header, formatBusinessContext(profile), role].join('\n\n')

  // Dynamic suffix — per-turn data + rep prefs + intent-dependent playbook
  // + behaviour rules (rules at end for lost-in-the-middle attention).
  // Rep preferences land BEFORE the playbook so they shape framework
  // application (e.g. a "brief" rep gets the SPIN questions in 4 lines,
  // not 12).
  const dynamicParts: string[] = []
  const packedSection = formatPackedSections(packed)
  if (packedSection) {
    dynamicParts.push(packedSection)
  } else if (ctx) {
    if (ctx.stalled_deals?.length) {
      const lines = ctx.stalled_deals.slice(0, 4).map(
        (d) => `- ${d.company_name} "${d.name}" — ${d.stage} for ${d.days_in_stage}d (median: ${d.median_days}d). ${d.stall_reason ?? 'No recent activity.'}`,
      )
      dynamicParts.push(`## Stalled Deals (snapshot)\n${lines.join('\n')}`)
    }
    if (ctx.priority_accounts?.length) {
      const top = ctx.priority_accounts.slice(0, 8).map(
        (a, i) => `${i + 1}. ${a.name} — ${a.priority_tier}${a.is_stalled ? ' STALLED' : ''}${a.top_signal ? ` | ${a.top_signal}` : ''}`,
      )
      dynamicParts.push(`## Top Priority Accounts (snapshot)\n${top.join('\n')}`)
    }
  }
  const repPrefs = formatRepPreferences(ctx?.rep_profile ?? null)
  if (repPrefs) dynamicParts.push(repPrefs)
  dynamicParts.push(commonSalesPlaybook(ctx, { role: 'ae' }))
  dynamicParts.push(commonBehaviourRules())
  const dynamicSuffix = dynamicParts.join('\n\n')

  return { staticPrefix, dynamicSuffix }
}

/**
 * Backwards-compatible string entry point. Workflows and the eval harness
 * call this directly; the agent route uses the parts version above to
 * enable Anthropic prompt caching.
 */
export async function buildPipelineCoachPrompt(
  tenantId: string,
  ctx: AgentContext | null,
  packed: PackedContext | null = null,
): Promise<string> {
  const parts = await buildPipelineCoachPromptParts(tenantId, ctx, packed)
  return joinPromptParts(parts)
}
