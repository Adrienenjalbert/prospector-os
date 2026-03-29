import { z } from 'zod'
import { tool } from 'ai'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export function createAgentTools(tenantId: string, repId: string) {
  const supabase = getSupabase()

  const priorityQueue = tool({
    description:
      'Get a ranked list of accounts the rep should focus on, sorted by expected revenue. Use for "who should I focus on", "what are my top accounts", "who should I call today". Does NOT show funnel/conversion data — use funnel_diagnosis for that.',
    parameters: z.object({
      queue_type: z
        .enum(['today', 'pipeline', 'prospecting'])
        .default('today')
        .describe('today = urgent HOT/WARM accounts, pipeline = all accounts with open deals, prospecting = high-ICP accounts with no active deal'),
      limit: z.number().default(10).describe('Max accounts to return'),
    }),
    execute: async ({ queue_type, limit }) => {
      if (queue_type === 'prospecting') {
        const { data: accountsWithDeals } = await supabase
          .from('opportunities')
          .select('company_id')
          .eq('tenant_id', tenantId)
          .eq('owner_crm_id', repId)
          .eq('is_closed', false)

        const dealAccountIds = (accountsWithDeals ?? []).map((d) => d.company_id)

        let query = supabase
          .from('companies')
          .select('id, name, expected_revenue, propensity, priority_tier, priority_reason, icp_tier')
          .eq('tenant_id', tenantId)
          .eq('owner_crm_id', repId)
          .in('icp_tier', ['A', 'B'])
          .order('expected_revenue', { ascending: false })
          .limit(limit)

        if (dealAccountIds.length > 0) {
          query = query.not('id', 'in', `(${dealAccountIds.join(',')})`)
        }

        const { data, error } = await query
        if (error) throw new Error(`Prospecting query failed: ${error.message}`)
        return { queue_type, accounts: data ?? [] }
      }

      let query = supabase
        .from('companies')
        .select('id, name, expected_revenue, propensity, priority_tier, priority_reason, icp_tier')
        .eq('tenant_id', tenantId)
        .eq('owner_crm_id', repId)
        .order('expected_revenue', { ascending: false })
        .limit(limit)

      if (queue_type === 'today') {
        query = query.in('priority_tier', ['HOT', 'WARM'])
      }

      const { data, error } = await query
      if (error) throw new Error(`Priority queue query failed: ${error.message}`)
      return { queue_type, accounts: data ?? [] }
    },
  })

  const crmLookup = tool({
    description:
      'Look up an account, contact, or deal by name. Use when you need details about a specific entity the rep mentions.',
    parameters: z.object({
      search_term: z.string().describe('Name to search for'),
      type: z
        .enum(['account', 'contact', 'deal'])
        .default('account'),
    }),
    execute: async ({ search_term, type }) => {
      switch (type) {
        case 'account': {
          const { data } = await supabase
            .from('companies')
            .select('id, name, industry, employee_count, hq_city, icp_tier, propensity, priority_tier, priority_reason, expected_revenue')
            .eq('tenant_id', tenantId)
            .ilike('name', `%${search_term}%`)
            .limit(5)
          return { type: 'account', results: data ?? [] }
        }
        case 'contact': {
          const { data } = await supabase
            .from('contacts')
            .select('first_name, last_name, title, email, phone, seniority, is_champion, is_decision_maker, company_id')
            .eq('tenant_id', tenantId)
            .or(`first_name.ilike.%${search_term}%,last_name.ilike.%${search_term}%`)
            .limit(5)
          return { type: 'contact', results: data ?? [] }
        }
        case 'deal': {
          const { data } = await supabase
            .from('opportunities')
            .select('id, name, value, stage, days_in_stage, is_stalled, company_id')
            .eq('tenant_id', tenantId)
            .ilike('name', `%${search_term}%`)
            .limit(5)
          return { type: 'deal', results: data ?? [] }
        }
      }
    },
  })

  const accountResearch = tool({
    description:
      'Deep dive on one company: returns firmographics, all signals, contacts, and open deals. Use when the rep wants to understand an account before a call or meeting.',
    parameters: z.object({
      company_name: z.string().describe('Company name to research'),
    }),
    execute: async ({ company_name }) => {
      const { data: company } = await supabase
        .from('companies')
        .select('*')
        .eq('tenant_id', tenantId)
        .ilike('name', `%${company_name}%`)
        .limit(1)
        .single()

      if (!company) return { error: `Company "${company_name}" not found` }

      const [signalsRes, contactsRes, oppsRes] = await Promise.all([
        supabase
          .from('signals')
          .select('signal_type, title, description, urgency, relevance_score, detected_at')
          .eq('tenant_id', tenantId)
          .eq('company_id', company.id)
          .order('detected_at', { ascending: false })
          .limit(10),
        supabase
          .from('contacts')
          .select('first_name, last_name, title, email, phone, seniority, is_champion, is_decision_maker')
          .eq('tenant_id', tenantId)
          .eq('company_id', company.id)
          .order('relevance_score', { ascending: false })
          .limit(15),
        supabase
          .from('opportunities')
          .select('name, value, stage, days_in_stage, is_stalled, stall_reason')
          .eq('tenant_id', tenantId)
          .eq('company_id', company.id)
          .eq('is_closed', false)
          .order('value', { ascending: false })
          .limit(5),
      ])

      return {
        company: {
          name: company.name,
          industry: company.industry,
          employee_count: company.employee_count,
          hq_city: company.hq_city,
          hq_country: company.hq_country,
          icp_tier: company.icp_tier,
          icp_score: company.icp_score,
          propensity: company.propensity,
          priority_tier: company.priority_tier,
          priority_reason: company.priority_reason,
        },
        signals: signalsRes.data ?? [],
        contacts: contactsRes.data ?? [],
        open_deals: oppsRes.data ?? [],
      }
    },
  })

  const outreachDrafter = tool({
    description:
      'Fetch account context needed to draft outreach. Returns company details, recent signals, and contact info. After receiving this data, compose the email in your response using the rep\'s outreach tone and Indeed Flex value props.',
    parameters: z.object({
      account_name: z.string().describe('Company name (will be looked up)'),
      contact_name: z.string().optional().describe('Specific contact to address'),
      outreach_type: z
        .enum(['cold_email', 'follow_up', 'stall_rescue', 'signal_response', 'meeting_request'])
        .describe('Type of outreach'),
    }),
    execute: async ({ account_name, contact_name, outreach_type }) => {
      const { data: company } = await supabase
        .from('companies')
        .select('id, name, industry, employee_count, hq_city, icp_tier, priority_reason')
        .eq('tenant_id', tenantId)
        .ilike('name', `%${account_name}%`)
        .limit(1)
        .single()

      if (!company) return { error: `Company "${account_name}" not found` }

      const { data: signals } = await supabase
        .from('signals')
        .select('signal_type, title')
        .eq('tenant_id', tenantId)
        .eq('company_id', company.id)
        .order('detected_at', { ascending: false })
        .limit(3)

      let contact = null
      if (contact_name) {
        const { data } = await supabase
          .from('contacts')
          .select('first_name, last_name, title, email')
          .eq('tenant_id', tenantId)
          .or(`first_name.ilike.%${contact_name}%,last_name.ilike.%${contact_name}%`)
          .limit(1)
          .single()
        contact = data
      }

      return {
        company,
        signals: signals ?? [],
        contact,
        outreach_type,
      }
    },
  })

  const funnelDiagnosis = tool({
    description:
      'Analyse pipeline health: stage-by-stage conversion rates, drop rates vs company benchmark, and stall counts. Use for "how is my pipeline", "where am I losing deals", "what stage needs work". Does NOT rank individual accounts — use priority_queue for that.',
    parameters: z.object({
      stage_filter: z.string().optional().describe('Focus on a specific stage name'),
    }),
    execute: async ({ stage_filter }) => {
      const repQuery = supabase
        .from('funnel_benchmarks')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('scope', 'rep')
        .eq('scope_id', repId)

      if (stage_filter) repQuery.eq('stage_name', stage_filter)

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
        stages: (repBench.data ?? []).map((rb) => {
          const cb = (companyBench.data ?? []).find(
            (c) => c.stage_name === rb.stage_name
          )
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

  const dealStrategy = tool({
    description:
      'Analyse a specific deal: health assessment based on stage benchmarks, contacts involved, and recommended actions. Use for "how is my deal with X", "what should I do to close X".',
    parameters: z.object({
      deal_name: z.string().describe('Deal name to analyse'),
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

      const [contactsRes, benchRes] = await Promise.all([
        supabase
          .from('contacts')
          .select('first_name, last_name, title, seniority, is_champion, is_economic_buyer, phone, email, last_activity_date')
          .eq('tenant_id', tenantId)
          .eq('company_id', deal.company_id)
          .limit(10),
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
        health: deal.is_stalled
          ? 'stalled'
          : deal.days_in_stage > stallThreshold
            ? 'at_risk'
            : 'on_track',
        benchmark: {
          median_days: medianDays,
          stall_threshold: stallThreshold,
        },
        contacts: contactsRes.data ?? [],
      }
    },
  })

  const contactFinder = tool({
    description:
      'Find contacts at a company for multi-threading. Use when the rep needs to identify decision-makers or find the right person to reach out to.',
    parameters: z.object({
      account_name: z.string().describe('Company name'),
      seniority_filter: z
        .array(z.string())
        .optional()
        .describe('Filter by seniority: c_level, vp, director, manager'),
    }),
    execute: async ({ account_name, seniority_filter }) => {
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('tenant_id', tenantId)
        .ilike('name', `%${account_name}%`)
        .limit(1)
        .single()

      if (!company) return { error: `Company "${account_name}" not found`, contacts: [] }

      let query = supabase
        .from('contacts')
        .select('first_name, last_name, title, email, phone, seniority, department, is_champion, is_decision_maker')
        .eq('tenant_id', tenantId)
        .eq('company_id', company.id)

      if (seniority_filter?.length) {
        query = query.in('seniority', seniority_filter)
      }

      const { data } = await query
        .order('relevance_score', { ascending: false })
        .limit(15)

      return { company_name: account_name, contacts: data ?? [] }
    },
  })

  return {
    priority_queue: priorityQueue,
    crm_lookup: crmLookup,
    account_research: accountResearch,
    outreach_drafter: outreachDrafter,
    funnel_diagnosis: funnelDiagnosis,
    deal_strategy: dealStrategy,
    contact_finder: contactFinder,
  }
}
