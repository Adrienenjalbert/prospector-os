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
      'Get the ranked priority queue for the current rep. Returns top accounts sorted by expected revenue with trigger reasons and recommended actions.',
    parameters: z.object({
      queue_type: z
        .enum(['today', 'pipeline', 'prospecting'])
        .default('today')
        .describe('Type of queue: today (urgent actions), pipeline (all deals), prospecting (no-deal accounts)'),
      limit: z.number().default(10).describe('Max accounts to return'),
    }),
    execute: async ({ queue_type, limit }) => {
      const query = supabase
        .from('companies')
        .select('id, name, expected_revenue, propensity, priority_tier, priority_reason, icp_tier, icp_score')
        .eq('tenant_id', tenantId)
        .eq('owner_crm_id', repId)
        .order('expected_revenue', { ascending: false })
        .limit(limit)

      if (queue_type === 'today') {
        query.in('priority_tier', ['HOT', 'WARM'])
      }

      const { data, error } = await query
      if (error) throw new Error(`Priority queue query failed: ${error.message}`)
      return { queue_type, accounts: data ?? [] }
    },
  })

  const crmLookup = tool({
    description:
      'Look up account, contact, or deal details from the database. Search by name or ID. Returns full record with related data.',
    parameters: z.object({
      search_term: z.string().describe('Account name, contact name, or deal name to search for'),
      type: z
        .enum(['account', 'contact', 'deal'])
        .default('account')
        .describe('Type of record to search for'),
    }),
    execute: async ({ search_term, type }) => {
      switch (type) {
        case 'account': {
          const { data } = await supabase
            .from('companies')
            .select('*')
            .eq('tenant_id', tenantId)
            .ilike('name', `%${search_term}%`)
            .limit(5)
          return { type: 'account', results: data ?? [] }
        }
        case 'contact': {
          const { data } = await supabase
            .from('contacts')
            .select('*, companies!inner(name)')
            .eq('tenant_id', tenantId)
            .or(`first_name.ilike.%${search_term}%,last_name.ilike.%${search_term}%`)
            .limit(5)
          return { type: 'contact', results: data ?? [] }
        }
        case 'deal': {
          const { data } = await supabase
            .from('opportunities')
            .select('*, companies!inner(name)')
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
      'Run research on a specific company. Returns company overview, scoring breakdown, signals, contacts, and deals.',
    parameters: z.object({
      company_name: z.string().describe('Name of the company to research'),
      company_id: z.string().optional().describe('Company ID if known'),
    }),
    execute: async ({ company_name, company_id }) => {
      let companyQuery = supabase
        .from('companies')
        .select('*')
        .eq('tenant_id', tenantId)

      if (company_id) {
        companyQuery = companyQuery.eq('id', company_id)
      } else {
        companyQuery = companyQuery.ilike('name', `%${company_name}%`)
      }

      const { data: companies } = await companyQuery.limit(1).single()
      if (!companies) return { error: `Company "${company_name}" not found` }

      const [signalsRes, contactsRes, oppsRes] = await Promise.all([
        supabase
          .from('signals')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('company_id', companies.id)
          .order('detected_at', { ascending: false })
          .limit(10),
        supabase
          .from('contacts')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('company_id', companies.id)
          .order('relevance_score', { ascending: false }),
        supabase
          .from('opportunities')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('company_id', companies.id)
          .order('value', { ascending: false }),
      ])

      return {
        company: companies,
        signals: signalsRes.data ?? [],
        contacts: contactsRes.data ?? [],
        opportunities: oppsRes.data ?? [],
      }
    },
  })

  const outreachDrafter = tool({
    description:
      'Draft a personalised outreach email based on account context, signals, and rep style. Returns subject line, body, and follow-up suggestion.',
    parameters: z.object({
      account_id: z.string().describe('The company ID to draft outreach for'),
      contact_name: z.string().optional().describe('Specific contact to address'),
      outreach_type: z
        .enum(['cold_email', 'follow_up', 'stall_rescue', 'signal_response', 'meeting_request'])
        .describe('Type of outreach'),
      additional_context: z.string().optional().describe('Extra context from the rep'),
    }),
    execute: async ({ account_id, contact_name, outreach_type, additional_context }) => {
      const { data: company } = await supabase
        .from('companies')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', account_id)
        .single()

      if (!company) return { error: 'Company not found' }

      const { data: signals } = await supabase
        .from('signals')
        .select('signal_type, title, description')
        .eq('tenant_id', tenantId)
        .eq('company_id', account_id)
        .order('detected_at', { ascending: false })
        .limit(3)

      return {
        instruction: 'Use this data to draft the email. The response IS the draft.',
        company_name: company.name,
        industry: company.industry,
        employee_count: company.employee_count,
        signals: signals ?? [],
        contact_name: contact_name ?? 'the decision-maker',
        outreach_type,
        additional_context,
      }
    },
  })

  const funnelDiagnosis = tool({
    description:
      'Get full funnel analysis with stage-by-stage performance vs company benchmark. Shows drop rates, conversion rates, impact scores, and stall counts.',
    parameters: z.object({
      scope: z
        .enum(['rep', 'team', 'company'])
        .default('rep')
        .describe('Scope of analysis'),
      stage_filter: z.string().optional().describe('Focus on a specific stage'),
    }),
    execute: async ({ scope, stage_filter }) => {
      const repQuery = supabase
        .from('funnel_benchmarks')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('scope', scope === 'rep' ? 'rep' : 'company')
        .eq('scope_id', scope === 'rep' ? repId : 'all')

      if (stage_filter) {
        repQuery.eq('stage_name', stage_filter)
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

      const stages = (repBench.data ?? []).map((rb) => {
        const cb = (companyBench.data ?? []).find((c) => c.stage_name === rb.stage_name)
        return {
          stage: rb.stage_name,
          rep_conv: rb.conversion_rate,
          rep_drop: rb.drop_rate,
          bench_conv: cb?.conversion_rate ?? 0,
          bench_drop: cb?.drop_rate ?? 0,
          delta_drop: Math.round((rb.drop_rate - (cb?.drop_rate ?? 0)) * 100) / 100,
          deal_count: rb.deal_count,
          avg_days: rb.avg_days_in_stage,
          stall_count: rb.stall_count,
          impact_score: rb.impact_score,
        }
      })

      return { scope, stages }
    },
  })

  const dealStrategy = tool({
    description:
      'Analyse a specific deal: health assessment, contacts, win probability, and recommended actions.',
    parameters: z.object({
      deal_name_or_id: z.string().describe('Deal name or ID'),
    }),
    execute: async ({ deal_name_or_id }) => {
      let query = supabase
        .from('opportunities')
        .select('*, companies!inner(name, industry, icp_tier, propensity)')
        .eq('tenant_id', tenantId)

      if (deal_name_or_id.match(/^[0-9a-f-]{36}$/)) {
        query = query.eq('id', deal_name_or_id)
      } else {
        query = query.ilike('name', `%${deal_name_or_id}%`)
      }

      const { data: deal } = await query.limit(1).single()
      if (!deal) return { error: `Deal "${deal_name_or_id}" not found` }

      const { data: contacts } = await supabase
        .from('contacts')
        .select('first_name, last_name, title, seniority, is_champion, is_economic_buyer, last_activity_date, phone, email')
        .eq('tenant_id', tenantId)
        .eq('company_id', deal.company_id)

      return {
        deal,
        contacts: contacts ?? [],
        health: deal.is_stalled ? 'stalled' : deal.days_in_stage > 14 ? 'at_risk' : 'on_track',
      }
    },
  })

  const contactFinder = tool({
    description:
      'Find contacts at a specific company for multi-threading. Returns existing contacts filtered by seniority and department.',
    parameters: z.object({
      account_id: z.string().describe('Company ID'),
      seniority_filter: z
        .array(z.string())
        .optional()
        .describe('Filter by seniority: c_level, vp, director, manager'),
      department_filter: z
        .array(z.string())
        .optional()
        .describe('Filter by department: Operations, HR, Finance, etc.'),
    }),
    execute: async ({ account_id, seniority_filter, department_filter }) => {
      let query = supabase
        .from('contacts')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('company_id', account_id)

      if (seniority_filter?.length) {
        query = query.in('seniority', seniority_filter)
      }
      if (department_filter?.length) {
        query = query.in('department', department_filter)
      }

      const { data } = await query.order('relevance_score', { ascending: false })
      return { contacts: data ?? [], total: (data ?? []).length }
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
