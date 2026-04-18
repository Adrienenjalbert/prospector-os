import { z } from 'zod'
import { tool } from 'ai'
import type { AgentContext } from '@prospector/core'
import { TranscriptIngester } from '@prospector/adapters'
import { getServiceSupabase, resolveCompanyByName } from '../tools/shared'
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

export function createAccountStrategistTools(tenantId: string, _repId: string) {
  const supabase = getServiceSupabase()

  const research_account = tool({
    description:
      'Deep dive on one company: firmographics, scoring, signals, contacts, and open deals. Use when the rep wants to understand an account before outreach.',
    parameters: z.object({
      company_name: z.string().describe('Company name to research'),
    }),
    execute: async ({ company_name }) => {
      const company = await resolveCompanyByName(supabase, tenantId, company_name)
      if (!company) return { error: `Company "${company_name}" not found` }

      const [signalsRes, contactsRes, oppsRes] = await Promise.all([
        supabase
          .from('signals')
          .select('id, signal_type, title, description, urgency, relevance_score, source_url, detected_at')
          .eq('tenant_id', tenantId)
          .eq('company_id', company.id)
          .order('detected_at', { ascending: false })
          .limit(10),
        supabase
          .from('contacts')
          .select('id, crm_id, first_name, last_name, title, email, phone, seniority, is_champion, is_decision_maker, is_economic_buyer')
          .eq('tenant_id', tenantId)
          .eq('company_id', company.id)
          .order('relevance_score', { ascending: false })
          .limit(15),
        supabase
          .from('opportunities')
          .select('id, crm_id, name, value, stage, days_in_stage, is_stalled')
          .eq('tenant_id', tenantId)
          .eq('company_id', company.id)
          .eq('is_closed', false)
          .order('value', { ascending: false })
          .limit(5),
      ])

      return {
        company: {
          id: company.id,
          crm_id: company.crm_id,
          name: company.name,
          industry: company.industry,
          industry_group: company.industry_group,
          employee_count: company.employee_count,
          annual_revenue: company.annual_revenue,
          hq_city: company.hq_city,
          hq_country: company.hq_country,
          tech_stack: company.tech_stack,
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

  const find_contacts = tool({
    description:
      'Find contacts at a company for multi-threading. Use when the rep needs to identify decision-makers, champions, or the right person to reach out to.',
    parameters: z.object({
      account_name: z.string().describe('Company name'),
      seniority_filter: z
        .array(z.string())
        .optional()
        .describe('Filter by seniority: c_level, vp, director, manager'),
    }),
    execute: async ({ account_name, seniority_filter }) => {
      const company = await resolveCompanyByName(supabase, tenantId, account_name)
      if (!company) return { error: `Company "${account_name}" not found`, contacts: [] }

      let query = supabase
        .from('contacts')
        .select('id, crm_id, first_name, last_name, title, email, phone, seniority, department, is_champion, is_decision_maker, is_economic_buyer')
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

  const get_active_signals = tool({
    description:
      'Get recent buying signals for an account. Use to understand what triggers make this account relevant right now.',
    parameters: z.object({
      account_name: z.string().describe('Company name'),
      days: z.number().default(30).describe('Look back period in days'),
    }),
    execute: async ({ account_name, days }) => {
      const company = await resolveCompanyByName(supabase, tenantId, account_name)
      if (!company) return { error: `Company "${account_name}" not found` }

      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

      const { data } = await supabase
        .from('signals')
        .select('id, signal_type, title, description, urgency, relevance_score, source, source_url, detected_at')
        .eq('tenant_id', tenantId)
        .eq('company_id', company.id)
        .gte('detected_at', since)
        .order('detected_at', { ascending: false })

      return {
        company_name: company.name,
        signals: data ?? [],
        period_days: days,
      }
    },
  })

  const search_transcripts = tool({
    description:
      'Semantic search past call/meeting transcripts. Use to find what was discussed with an account or about a topic.',
    parameters: z.object({
      query: z.string().describe('What to search for in transcripts'),
      company_name: z.string().optional().describe('Limit to this company'),
      limit: z.number().default(5).describe('Max results'),
    }),
    execute: async ({ query, company_name, limit }) => {
      let companyId: string | undefined
      if (company_name) {
        const company = await resolveCompanyByName(supabase, tenantId, company_name)
        if (!company) return { error: `Company "${company_name}" not found` }
        companyId = company.id
      }

      const ingester = new TranscriptIngester(supabase, tenantId)
      const results = await ingester.searchSimilar(query, { companyId, limit })

      return { query, company_name: company_name ?? null, transcripts: results }
    },
  })

  const draft_outreach = tool({
    description:
      'Fetch all context needed to draft outreach: company profile, signals, contact info, and value props. After receiving this data, compose the message in your response using the rep\'s tone and the tenant\'s value propositions.',
    parameters: z.object({
      account_name: z.string().describe('Company name'),
      contact_name: z.string().optional().describe('Specific contact to address'),
      outreach_type: z
        .enum(['cold_email', 'follow_up', 'stall_rescue', 'signal_response', 'meeting_request', 'linkedin_message'])
        .describe('Type of outreach'),
    }),
    execute: async ({ account_name, contact_name, outreach_type }) => {
      const company = await resolveCompanyByName(supabase, tenantId, account_name)
      if (!company) return { error: `Company "${account_name}" not found` }

      const [signalsRes, profileRes] = await Promise.all([
        supabase
          .from('signals')
          .select('id, signal_type, title, description, source_url')
          .eq('tenant_id', tenantId)
          .eq('company_id', company.id)
          .order('detected_at', { ascending: false })
          .limit(3),
        supabase
          .from('business_profiles')
          .select('value_propositions, company_description, target_industries, ideal_customer_description')
          .eq('tenant_id', tenantId)
          .single(),
      ])

      let contact = null
      if (contact_name) {
        const { data } = await supabase
          .from('contacts')
          .select('id, crm_id, first_name, last_name, title, email, seniority')
          .eq('tenant_id', tenantId)
          .eq('company_id', company.id)
          .or(`first_name.ilike.%${contact_name}%,last_name.ilike.%${contact_name}%`)
          .limit(1)
          .single()
        contact = data
      }

      return {
        company: {
          id: company.id,
          crm_id: company.crm_id,
          name: company.name,
          industry: company.industry,
          employee_count: company.employee_count,
          hq_city: company.hq_city,
          icp_tier: company.icp_tier,
          priority_reason: company.priority_reason,
        },
        signals: signalsRes.data ?? [],
        contact,
        outreach_type,
        value_props: profileRes.data?.value_propositions ?? [],
        company_description: profileRes.data?.company_description ?? null,
      }
    },
  })

  const draft_meeting_brief = tool({
    description:
      'Assemble a pre-call brief: account snapshot, recent signals, contacts on the meeting, last touchpoints. Use before a discovery or follow-up meeting.',
    parameters: z.object({
      account_name: z.string().describe('Company name'),
      attendee_emails: z.array(z.string()).optional().describe('Emails of meeting attendees if known'),
    }),
    execute: async ({ account_name, attendee_emails }) => {
      const company = await resolveCompanyByName(supabase, tenantId, account_name)
      if (!company) return { error: `Company "${account_name}" not found` }

      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

      const [signalsRes, contactsRes, oppsRes] = await Promise.all([
        supabase
          .from('signals')
          .select('id, signal_type, title, description, urgency, detected_at')
          .eq('tenant_id', tenantId)
          .eq('company_id', company.id)
          .gte('detected_at', since)
          .order('detected_at', { ascending: false })
          .limit(5),
        supabase
          .from('contacts')
          .select('id, crm_id, first_name, last_name, title, email, seniority, is_champion, is_decision_maker, is_economic_buyer')
          .eq('tenant_id', tenantId)
          .eq('company_id', company.id),
        supabase
          .from('opportunities')
          .select('id, crm_id, name, value, stage, days_in_stage, expected_close_date, is_stalled')
          .eq('tenant_id', tenantId)
          .eq('company_id', company.id)
          .eq('is_closed', false),
      ])

      const allContacts = contactsRes.data ?? []
      const attendees = attendee_emails?.length
        ? allContacts.filter((c) =>
            attendee_emails.some(
              (e) => c.email && c.email.toLowerCase() === e.toLowerCase(),
            ),
          )
        : allContacts.filter(
            (c) => c.is_champion || c.is_decision_maker || c.is_economic_buyer,
          )

      return {
        company: {
          id: company.id,
          crm_id: company.crm_id,
          name: company.name,
          industry: company.industry,
          icp_tier: company.icp_tier,
          propensity: company.propensity,
          priority_reason: company.priority_reason,
        },
        signals: signalsRes.data ?? [],
        contacts: attendees,
        open_deals: oppsRes.data ?? [],
      }
    },
  })

  return {
    research_account,
    find_contacts,
    get_active_signals,
    search_transcripts,
    draft_outreach,
    draft_meeting_brief,
  }
}

export async function buildAccountStrategistPromptParts(
  tenantId: string,
  ctx: AgentContext | null = null,
  packed: PackedContext | null = null,
): Promise<SystemPromptParts> {
  const profile = await loadBusinessProfile(tenantId)

  const header = formatAgentHeader(
    'the Account Strategist',
    'Help reps craft personalized, signal-driven outreach grounded in the account\'s real situation.',
    profile,
  )

  // Removed the vague "Tailor tone to the rep's preferred outreach voice"
  // line — the real concrete guidance now lives in `formatRepPreferences`
  // (Outreach drafts: Professional / Consultative / Direct + tone).
  const role = `## Role: Account Strategist
You research individual accounts and draft outreach that connects the prospect's situation to the tenant's value propositions.
- Always ground outreach in real data: signals, industry context, company profile, transcript history.
- Lead cold outreach with a relevant signal or insight, not a product pitch.
- For follow-ups, reference specific previous interactions.
- Every draft has a single clear CTA.`

  const staticPrefix = [header, formatBusinessContext(profile), role].join('\n\n')

  const dynamicParts: string[] = []
  const packedSection = formatPackedSections(packed)
  if (packedSection) dynamicParts.push(packedSection)
  const repPrefs = formatRepPreferences(ctx?.rep_profile ?? null)
  if (repPrefs) dynamicParts.push(repPrefs)
  dynamicParts.push(commonSalesPlaybook(ctx, { role: 'ae' }))
  dynamicParts.push(commonBehaviourRules())

  return { staticPrefix, dynamicSuffix: dynamicParts.join('\n\n') }
}

export async function buildAccountStrategistPrompt(
  tenantId: string,
  ctx: AgentContext | null = null,
  packed: PackedContext | null = null,
): Promise<string> {
  const parts = await buildAccountStrategistPromptParts(tenantId, ctx, packed)
  return joinPromptParts(parts)
}
