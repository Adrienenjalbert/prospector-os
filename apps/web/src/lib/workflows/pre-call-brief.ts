import type { SupabaseClient } from '@supabase/supabase-js'
import { SlackDispatcher, SupabaseCooldownStore } from '@prospector/adapters'
import type { PreCallBriefParams } from '@prospector/adapters'
import { emitAgentEvent, urn } from '@prospector/core'

import {
  startWorkflow,
  runWorkflowDag,
  type DagNode,
  type WorkflowRunRow,
} from './runner'
import { shouldSuppressPush } from './holdout'

/**
 * Pre-Call Brief workflow (Phase 1 — DAG runner)
 *
 * Trigger: HubSpot meeting webhook → kick off with meetingId.
 *
 * DAG shape:
 *   fetch_meeting
 *     ├── resolve_company    ┐
 *     ├── resolve_rep        ├─→ assemble_brief ─→ schedule_dispatch ─→ dispatch_slack
 *     └── resolve_contact    ┘
 *
 * The three resolver nodes run concurrently (they share no data) and feed
 * one assemble_brief node with trigger_rule: none_failed_min_one_success so
 * the brief still ships if the contact lookup fails — graceful degradation.
 *
 * Every node's output is persisted to workflow_runs.step_state so retries
 * resume from the last completed node. The T-15 timer is enforced by the
 * `wait_until` sentinel returned from schedule_dispatch.
 */

export interface PreCallBriefInput {
  meeting_id: string
  portal_id?: number
  /** ISO timestamp. When set, overrides HubSpot lookup for testing. */
  meeting_start_override?: string
}

interface FetchedMeeting {
  meeting_id: string
  title: string
  start_time: string
  owner_crm_id: string | null
  company_crm_id: string | null
  contact_crm_id: string | null
}

// Three independent resolver outputs. Each one can fail without taking the
// others down — assemble_brief reconciles whatever made it through.
interface ResolvedCompany {
  tenant_id: string | null
  company_id: string | null
  company_name: string
  company_overview: string
  icp_tier: string
  icp_score: number
}

interface ResolvedRep {
  rep: { id: string; slack_user_id: string | null; name: string } | null
}

interface ResolvedContact {
  contact_name: string
  contact_title: string
}

interface AssembledBrief {
  params: PreCallBriefParams
  subject_urn: string
  interaction_id: string
  tenant_id: string
  rep_id: string | null
}

export async function enqueuePreCallBrief(
  supabase: SupabaseClient,
  tenantId: string,
  input: PreCallBriefInput,
): Promise<WorkflowRunRow> {
  // Idempotency key tenant-prefixed for the same reason as
  // transcript-ingest: the runner now scopes by tenant_id at lookup, but
  // a globally-unique-looking key remains better hygiene for ops + audit.
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'pre_call_brief',
    idempotencyKey: `pcb:${tenantId}:${input.meeting_id}`,
    input: input as unknown as Record<string, unknown>,
  })
}

export async function runPreCallBrief(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const nodes: DagNode[] = [
    // ── Layer 0 — fetch meeting from HubSpot ──────────────────────────────
    {
      id: 'fetch_meeting',
      run: async (ctx): Promise<FetchedMeeting> => {
        const { meeting_id, meeting_start_override } = ctx.input as unknown as PreCallBriefInput
        if (meeting_start_override) {
          return {
            meeting_id,
            title: 'Meeting',
            start_time: meeting_start_override,
            owner_crm_id: null,
            company_crm_id: null,
            contact_crm_id: null,
          }
        }

        const hubspotToken = process.env.HUBSPOT_PRIVATE_APP_TOKEN
        if (!hubspotToken) throw new Error('HUBSPOT_PRIVATE_APP_TOKEN not set')

        const res = await fetch(
          `https://api.hubapi.com/crm/v3/objects/meetings/${meeting_id}?properties=hs_meeting_title,hs_meeting_start_time,hubspot_owner_id&associations=contacts,companies`,
          { headers: { Authorization: `Bearer ${hubspotToken}` } },
        )
        if (!res.ok) throw new Error(`HubSpot meeting fetch failed: ${res.status}`)

        const meeting = (await res.json()) as {
          id: string
          properties: Record<string, string | null>
          associations?: Record<string, { results: { id: string }[] }>
        }

        return {
          meeting_id,
          title: meeting.properties.hs_meeting_title ?? 'Untitled Meeting',
          start_time: meeting.properties.hs_meeting_start_time ?? '',
          owner_crm_id: meeting.properties.hubspot_owner_id ?? null,
          company_crm_id: meeting.associations?.companies?.results?.[0]?.id ?? null,
          contact_crm_id: meeting.associations?.contacts?.results?.[0]?.id ?? null,
        }
      },
    },

    // ── Layer 1 — three parallel resolvers ────────────────────────────────
    {
      id: 'resolve_company',
      dependsOn: ['fetch_meeting'],
      run: async (ctx): Promise<ResolvedCompany> => {
        const fetched = ctx.stepState.fetch_meeting as FetchedMeeting
        const fallback: ResolvedCompany = {
          tenant_id: null,
          company_id: null,
          company_name: fetched.title,
          company_overview: `Meeting: ${fetched.title}`,
          icp_tier: 'Unknown',
          icp_score: 0,
        }
        if (!fetched.company_crm_id) return fallback

        const { data: company } = await ctx.supabase
          .from('companies')
          .select(
            'id, tenant_id, name, industry, employee_count, annual_revenue, hq_country, icp_score, icp_tier, priority_reason',
          )
          .eq('crm_id', fetched.company_crm_id)
          .maybeSingle()

        if (!company) return fallback

        const parts = [company.name]
        if (company.industry) parts.push(`Industry: ${company.industry}`)
        if (company.employee_count) parts.push(`Employees: ${company.employee_count.toLocaleString()}`)
        if (company.annual_revenue) parts.push(`Revenue: $${(company.annual_revenue / 1_000_000).toFixed(1)}M`)
        if (company.hq_country) parts.push(`HQ: ${company.hq_country}`)
        if (company.priority_reason) parts.push(`Priority: ${company.priority_reason}`)

        return {
          tenant_id: company.tenant_id,
          company_id: company.id,
          company_name: company.name,
          company_overview: parts.join(' | '),
          icp_tier: company.icp_tier ?? 'Unknown',
          icp_score: company.icp_score ?? 0,
        }
      },
    },
    {
      id: 'resolve_rep',
      dependsOn: ['fetch_meeting'],
      run: async (ctx): Promise<ResolvedRep> => {
        const fetched = ctx.stepState.fetch_meeting as FetchedMeeting
        if (!fetched.owner_crm_id) return { rep: null }
        const { data: rep } = await ctx.supabase
          .from('rep_profiles')
          .select('id, slack_user_id, name')
          .eq('crm_id', fetched.owner_crm_id)
          .maybeSingle()
        return { rep: rep ?? null }
      },
    },
    {
      id: 'resolve_contact',
      dependsOn: ['fetch_meeting'],
      run: async (ctx): Promise<ResolvedContact> => {
        const fetched = ctx.stepState.fetch_meeting as FetchedMeeting
        if (!fetched.contact_crm_id) {
          return { contact_name: 'Unknown Contact', contact_title: '' }
        }
        const { data: contact } = await ctx.supabase
          .from('contacts')
          .select('first_name, last_name, title')
          .eq('crm_id', fetched.contact_crm_id)
          .maybeSingle()
        if (!contact) {
          return { contact_name: 'Unknown Contact', contact_title: '' }
        }
        return {
          contact_name:
            [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown',
          contact_title: contact.title ?? '',
        }
      },
    },

    // ── Layer 2 — assemble with graceful degradation ──────────────────────
    // trigger_rule: none_failed_min_one_success — brief still ships if the
    // contact lookup failed; company + rep are the hard requirements
    // (enforced inside the node, so a soft miss is still captured as an
    // error in stepState rather than a DAG abort).
    {
      id: 'assemble_brief',
      dependsOn: ['resolve_company', 'resolve_rep', 'resolve_contact'],
      triggerRule: 'none_failed_min_one_success',
      run: async (ctx): Promise<AssembledBrief> => {
        const fetched = ctx.stepState.fetch_meeting as FetchedMeeting
        const company = ctx.stepState.resolve_company as ResolvedCompany
        const rep = ctx.stepState.resolve_rep as ResolvedRep
        const contact = ctx.stepState.resolve_contact as ResolvedContact

        if (!company.tenant_id || !company.company_id || !rep.rep?.slack_user_id) {
          throw new Error('Missing tenant/company/rep — cannot assemble brief')
        }

        const painPoints: PreCallBriefParams['painPoints'] = []
        const discoveryQuestions: string[] = []

        const { data: signals } = await ctx.supabase
          .from('signals')
          .select('title, signal_type, description')
          .eq('company_id', company.company_id)
          .eq('tenant_id', company.tenant_id)
          .order('detected_at', { ascending: false })
          .limit(5)

        for (const s of signals ?? []) {
          painPoints.push({
            text: s.title ?? s.description ?? s.signal_type,
            source: s.signal_type ?? 'signal',
          })
        }

        if (painPoints.length > 0) {
          discoveryQuestions.push(
            `What prompted your interest in solving ${painPoints[0].text.toLowerCase()}?`,
          )
        }
        discoveryQuestions.push('What does your current process look like today?')
        discoveryQuestions.push('Who else is involved in evaluating solutions like this?')
        discoveryQuestions.push('What does your timeline look like for making a decision?')

        const interactionId = crypto.randomUUID()
        const subjectUrn = urn.company(company.tenant_id, company.company_id)

        const meetingDate = new Date(fetched.start_time)
        const params: PreCallBriefParams = {
          slackUserId: rep.rep.slack_user_id,
          companyName: company.company_name,
          meetingTime: meetingDate.toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }),
          contactName: contact.contact_name,
          contactTitle: contact.contact_title,
          companyOverview: company.company_overview,
          icpTier: company.icp_tier,
          icpScore: company.icp_score,
          painPoints:
            painPoints.length > 0
              ? painPoints
              : [{ text: 'No signals detected yet', source: 'system' }],
          discoveryQuestions,
          interactionId,
        }

        return {
          params,
          subject_urn: subjectUrn,
          interaction_id: interactionId,
          tenant_id: company.tenant_id,
          rep_id: rep.rep.id,
        }
      },
    },

    // ── Layer 3 — durable wait until T-15 ─────────────────────────────────
    {
      id: 'schedule_dispatch',
      dependsOn: ['assemble_brief', 'fetch_meeting'],
      run: async (ctx) => {
        const fetched = ctx.stepState.fetch_meeting as FetchedMeeting
        const meetingTime = new Date(fetched.start_time).getTime()
        const fireAt = meetingTime - 15 * 60 * 1000
        const now = Date.now()

        if (fireAt > now + 30_000) {
          return { wait_until: new Date(fireAt).toISOString() }
        }
        return { ready: true }
      },
    },

    // ── Layer 4 — holdout-aware dispatch ──────────────────────────────────
    {
      id: 'dispatch_slack',
      dependsOn: ['schedule_dispatch', 'assemble_brief'],
      run: async (ctx) => {
        const slackToken = process.env.SLACK_BOT_TOKEN
        if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set')

        const brief = ctx.stepState.assemble_brief as AssembledBrief

        if (brief.rep_id) {
          const suppress = await shouldSuppressPush(ctx.supabase, brief.tenant_id, brief.rep_id)
          if (suppress) {
            return { skipped: true, reason: 'holdout_control' }
          }
        }

        const dispatcher = new SlackDispatcher(
          slackToken,
          new SupabaseCooldownStore(ctx.supabase),
          ctx.supabase,
        )

        // Respect the rep's alert_frequency so "low" preference reps only
        // see the highest-priority 1/day. This is the daily push-budget gate.
        const { data: repPref } = brief.rep_id
          ? await ctx.supabase
              .from('rep_profiles')
              .select('alert_frequency')
              .eq('id', brief.rep_id)
              .maybeSingle()
          : { data: null }

        const result = await dispatcher.sendPreCallBrief(
          brief.params,
          {
            tenantId: brief.tenant_id,
            subjectKey: `pre_call_brief:${brief.subject_urn}`,
          },
          brief.rep_id
            ? {
                tenantId: brief.tenant_id,
                repUserId: brief.rep_id,
                frequency: (repPref?.alert_frequency as 'high' | 'medium' | 'low') ?? 'medium',
              }
            : undefined,
        )

        await emitAgentEvent(ctx.supabase, {
          tenant_id: brief.tenant_id,
          interaction_id: brief.interaction_id,
          user_id: brief.rep_id,
          role: 'ae',
          event_type: result.ok ? 'response_finished' : 'error',
          subject_urn: brief.subject_urn,
          payload: {
            workflow: 'pre_call_brief',
            skipped: result.skipped ?? false,
            reason: result.skippedReason ?? result.error ?? null,
          },
        })

        return result
      },
    },
  ]

  return runWorkflowDag({ supabase, runId, nodes })
}
