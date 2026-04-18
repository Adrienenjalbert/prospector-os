import { z } from 'zod'
import { parseUrn } from '@prospector/core'

import type { ToolHandler } from '../../tool-loader'

/**
 * `draft_alumni_intro` — fetches the context the agent needs to draft a
 * warm-intro outreach to a former champion who has moved to a new
 * company. Pairs with the `champion-alumni-opportunities` slice and the
 * `champion-alumni-detector` nightly workflow.
 *
 * Returns the structured context (original deal, original company, new
 * company snapshot, contact details). The agent then composes the actual
 * outreach in its response, leaning on the tenant's value props and the
 * sales-frameworks playbook (typically Three Whys + RAIN for warm
 * intros).
 *
 * Why a tool rather than a slice: this is a one-shot fetch driven by the
 * agent's intent ("I want to draft a warm intro to Sarah at NewCo") —
 * not a per-turn always-on context. Same shape as the existing
 * `draft_outreach` tool the account-strategist uses.
 *
 * No CRM mutations — this returns drafting context, not a sent message.
 * The rep approves and sends from their own inbox.
 */

export const draftAlumniIntroSchema = z.object({
  contact_urn: z
    .string()
    .describe(
      'URN of the former champion who has moved (e.g. urn:rev:contact:abc).',
    ),
  new_company_urn: z
    .string()
    .describe(
      "URN of the contact's new company (e.g. urn:rev:company:xyz). The champion-alumni-opportunities slice surfaces both URNs.",
    ),
})

export type DraftAlumniIntroArgs = z.infer<typeof draftAlumniIntroSchema>

interface AlumniIntroResult {
  data: {
    contact: {
      id: string
      name: string
      title: string | null
      email: string | null
    } | null
    original_deal: {
      id: string
      name: string
      stage: string
      value: number | null
      closed_at: string | null
      lost_reason: string | null
    } | null
    original_company: {
      id: string
      name: string
      industry: string | null
    } | null
    new_company: {
      id: string
      name: string
      industry: string | null
      employee_count: number | null
      icp_tier: string | null
      open_deals_count: number
      recent_signals_count: number
    } | null
    /**
     * Talking points the agent can quote verbatim. Each is a fact the
     * rep can defend. The agent should choose 2-3, never all of them.
     */
    talking_points: string[]
    /**
     * Suggested intro structure — the Three Whys (anything / you / now)
     * is the natural fit for warm-intro because the prospect already
     * knows the rep but not WHY now.
     */
    suggested_framework: 'three-why'
  } | null
  error?: string
  citations: Array<{
    claim_text: string
    source_type: string
    source_id?: string
    source_url?: string
  }>
}

export const draftAlumniIntroHandler: ToolHandler = {
  slug: 'draft_alumni_intro',
  schema: draftAlumniIntroSchema,
  build: (toolCtx) => async (rawArgs) => {
    const args = rawArgs as DraftAlumniIntroArgs
    const contactRef = parseUrn(args.contact_urn)
    const newCompanyRef = parseUrn(args.new_company_urn)

    if (!contactRef || contactRef.type !== 'contact') {
      return {
        data: null,
        error: `contact_urn must be a contact URN, got ${args.contact_urn}`,
        citations: [],
      } satisfies AlumniIntroResult
    }
    if (!newCompanyRef || newCompanyRef.type !== 'company') {
      return {
        data: null,
        error: `new_company_urn must be a company URN, got ${args.new_company_urn}`,
        citations: [],
      } satisfies AlumniIntroResult
    }

    // Hydrate contact + original company (where they were a champion)
    const { data: contact } = await toolCtx.supabase
      .from('contacts')
      .select('id, first_name, last_name, title, email, company_id')
      .eq('tenant_id', toolCtx.tenantId)
      .eq('id', contactRef.id)
      .maybeSingle()

    if (!contact) {
      return {
        data: null,
        error: `Contact ${contactRef.id} not found in tenant.`,
        citations: [],
      } satisfies AlumniIntroResult
    }

    // Original company (where the contact was a champion at close-won)
    const { data: originalCompany } = contact.company_id
      ? await toolCtx.supabase
          .from('companies')
          .select('id, name, industry')
          .eq('tenant_id', toolCtx.tenantId)
          .eq('id', contact.company_id)
          .maybeSingle()
      : { data: null }

    // The won deal that established this person as a champion. Pick the
    // most recent won deal at the original company.
    const { data: originalDeal } = contact.company_id
      ? await toolCtx.supabase
          .from('opportunities')
          .select('id, name, stage, value, closed_at, lost_reason, is_won')
          .eq('tenant_id', toolCtx.tenantId)
          .eq('company_id', contact.company_id)
          .eq('is_won', true)
          .order('closed_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null }

    // New company snapshot — firmographics + activity counters
    const [newCompanyRes, newDealsRes, newSignalsRes] = await Promise.all([
      toolCtx.supabase
        .from('companies')
        .select('id, name, industry, employee_count, icp_tier')
        .eq('tenant_id', toolCtx.tenantId)
        .eq('id', newCompanyRef.id)
        .maybeSingle(),
      toolCtx.supabase
        .from('opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', toolCtx.tenantId)
        .eq('company_id', newCompanyRef.id)
        .eq('is_closed', false),
      toolCtx.supabase
        .from('signals')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', toolCtx.tenantId)
        .eq('company_id', newCompanyRef.id)
        .gte(
          'detected_at',
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        ),
    ])

    const contactName =
      `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() ||
      contact.email ||
      'former champion'

    // Build the talking points from facts the rep can defend.
    const talking_points: string[] = []
    if (originalCompany?.name && originalDeal?.name) {
      talking_points.push(
        `You championed "${originalDeal.name}" at ${originalCompany.name} (closed-won${originalDeal.closed_at ? ' ' + originalDeal.closed_at.slice(0, 7) : ''}).`,
      )
    }
    if (originalCompany?.industry && newCompanyRes.data?.industry) {
      const sameIndustry =
        originalCompany.industry === newCompanyRes.data.industry
      talking_points.push(
        sameIndustry
          ? `Same industry as your previous role (${originalCompany.industry}) — likely same operational pain points.`
          : `Industry shift: ${originalCompany.industry} → ${newCompanyRes.data.industry}. Frame our value in terms relevant to the new sector.`,
      )
    }
    if (newCompanyRes.data?.icp_tier) {
      talking_points.push(
        `${newCompanyRes.data.name} is currently scored ICP ${newCompanyRes.data.icp_tier} for us.`,
      )
    }
    if ((newSignalsRes.count ?? 0) > 0) {
      talking_points.push(
        `${newSignalsRes.count} active signals on ${newCompanyRes.data?.name ?? 'the new company'} in the last 30 days — consider naming one as the "why now".`,
      )
    }
    if ((newDealsRes.count ?? 0) > 0) {
      talking_points.push(
        `WARNING: ${newDealsRes.count} open deal(s) already exist on ${newCompanyRes.data?.name ?? 'the new company'} — coordinate with the existing rep before reaching out.`,
      )
    }
    talking_points.push(
      'Lead with congratulations on the new role; do NOT pitch in the first message. Goal: 15-min discovery, not a demo ask.',
    )

    return {
      data: {
        contact: {
          id: contact.id,
          name: contactName,
          title: contact.title,
          email: contact.email,
        },
        original_deal: originalDeal
          ? {
              id: originalDeal.id,
              name: originalDeal.name,
              stage: originalDeal.stage,
              value: originalDeal.value,
              closed_at: originalDeal.closed_at,
              lost_reason: originalDeal.lost_reason,
            }
          : null,
        original_company: originalCompany
          ? {
              id: originalCompany.id,
              name: originalCompany.name,
              industry: originalCompany.industry,
            }
          : null,
        new_company: newCompanyRes.data
          ? {
              id: newCompanyRes.data.id,
              name: newCompanyRes.data.name,
              industry: newCompanyRes.data.industry,
              employee_count: newCompanyRes.data.employee_count,
              icp_tier: newCompanyRes.data.icp_tier,
              open_deals_count: newDealsRes.count ?? 0,
              recent_signals_count: newSignalsRes.count ?? 0,
            }
          : null,
        talking_points,
        suggested_framework: 'three-why',
      },
      citations: [
        ...(contact
          ? [
              {
                claim_text: contactName,
                source_type: 'contact',
                source_id: contact.id,
              },
            ]
          : []),
        ...(originalCompany
          ? [
              {
                claim_text: originalCompany.name,
                source_type: 'company',
                source_id: originalCompany.id,
              },
            ]
          : []),
        ...(originalDeal
          ? [
              {
                claim_text: originalDeal.name,
                source_type: 'opportunity',
                source_id: originalDeal.id,
              },
            ]
          : []),
        ...(newCompanyRes.data
          ? [
              {
                claim_text: newCompanyRes.data.name,
                source_type: 'company',
                source_id: newCompanyRes.data.id,
              },
            ]
          : []),
      ],
    } satisfies AlumniIntroResult
  },
}
