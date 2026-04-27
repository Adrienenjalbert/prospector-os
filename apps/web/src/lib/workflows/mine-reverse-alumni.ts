import type { SupabaseClient } from '@supabase/supabase-js'
import { emitAgentEvent } from '@prospector/core'
import {
  loadCompanyResolutionIndex,
  resolveCompanyString,
} from '@/lib/memory/entity-resolution'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * mine-reverse-alumni — Phase 7 (Section 3.2) of the Composite
 * Triggers + Relationship Graph plan.
 *
 * "Reverse alumni" = the inverse of champion-alumni-detector.
 * Where champion-alumni-detector tracks "OUR champion moved to a new
 * company", this miner finds "a contact at a PROSPECT used to work
 * at one of OUR existing customers". The customer relationship
 * becomes the warm intro INTO the prospect.
 *
 * Pipeline (deterministic SQL only — no LLM):
 *
 *   1. Load every contact at every NON-customer company in the
 *      tenant CRM (i.e. prospects) whose `previous_companies` is
 *      non-empty.
 *   2. For each previous_companies entry, resolve to a tenant
 *      company.id via inline entity resolution (domain exact +
 *      suffix-stripped + name fuzzy).
 *   3. If the resolved company has a closed-won opportunity OR is
 *      currently flagged as a customer (CSM-tracked), emit:
 *      - `coworked_with` edge: contact at prospect ↔ contact at customer
 *        (when we have a champion contact at the customer)
 *      - `bridges_to` edge: customer company → prospect company
 *        with `weight` = freshness × confidence
 *
 * Idempotency: per-tenant per-day; the unique constraint on
 * memory_edges (tenant, src_kind, src_id, dst_kind, dst_id, edge_kind)
 * means re-runs are no-ops.
 *
 * Output volume: ~50-200 bridges/tenant/night after warmup,
 * concentrated on prospects whose contacts have rich
 * previous_companies (Apollo coverage varies; refresh-contacts
 * Section 1.2 keeps the field fresh).
 *
 * Why this matters: industry data says alumni-warm intros convert
 * at 4-8x cold outbound. This workflow surfaces those warm paths
 * without the rep manually trawling LinkedIn.
 */

const LOOKBACK_DAYS_FOR_CUSTOMER = 730  // 24 months
const MAX_CONTACTS_PER_RUN = 2000

interface ProspectContact {
  id: string
  company_id: string
  first_name: string | null
  last_name: string | null
  previous_companies: string[]
}

export async function enqueueMineReverseAlumni(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'mine_reverse_alumni',
    idempotencyKey: `mra:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runMineReverseAlumni(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_inputs',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')

        // Customer companies — those with at least one closed-won
        // opportunity in the lookback window. These are the "source
        // side" of every bridge: warm intros come FROM these.
        const since = new Date(
          Date.now() - LOOKBACK_DAYS_FOR_CUSTOMER * 24 * 60 * 60 * 1000,
        ).toISOString()
        const { data: wonDeals } = await ctx.supabase
          .from('opportunities')
          .select('company_id')
          .eq('tenant_id', ctx.tenantId)
          .eq('is_won', true)
          .gte('closed_at', since)
        const customerCompanyIds = new Set<string>(
          (wonDeals ?? []).map((d) => d.company_id).filter(Boolean) as string[],
        )

        if (customerCompanyIds.size === 0) {
          return {
            customer_company_ids: [],
            prospect_contacts: [],
            reason: 'no_customers_in_lookback',
          }
        }

        // Prospect contacts — contacts at companies NOT in the
        // customer set, with non-empty previous_companies.
        const { data: contacts } = await ctx.supabase
          .from('contacts')
          .select('id, company_id, first_name, last_name, previous_companies')
          .eq('tenant_id', ctx.tenantId)
          .not('previous_companies', 'is', null)
          .limit(MAX_CONTACTS_PER_RUN)

        const allContacts = (contacts ?? []) as Array<{
          id: string
          company_id: string
          first_name: string | null
          last_name: string | null
          previous_companies: unknown
        }>

        const prospectContacts: ProspectContact[] = []
        for (const c of allContacts) {
          if (customerCompanyIds.has(c.company_id)) continue
          if (!Array.isArray(c.previous_companies)) continue
          const prevList = c.previous_companies.filter(
            (p): p is string => typeof p === 'string' && p.length > 0,
          )
          if (prevList.length === 0) continue
          prospectContacts.push({
            id: c.id,
            company_id: c.company_id,
            first_name: c.first_name,
            last_name: c.last_name,
            previous_companies: prevList,
          })
        }

        return {
          customer_company_ids: Array.from(customerCompanyIds),
          prospect_contacts: prospectContacts,
        }
      },
    },
    {
      name: 'resolve_and_emit_edges',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { customer_company_ids, prospect_contacts } = ctx.stepState
          .load_inputs as {
          customer_company_ids: string[]
          prospect_contacts: ProspectContact[]
        }

        if (customer_company_ids.length === 0 || prospect_contacts.length === 0) {
          return { bridges_written: 0, contacts_processed: 0 }
        }

        const customerSet = new Set(customer_company_ids)
        const index = await loadCompanyResolutionIndex(ctx.supabase, ctx.tenantId)

        // For each prospect contact, resolve every previous_companies
        // entry to a customer (if it matches one). Each match writes
        // a bridges_to edge (prospect company ← customer company)
        // and emits a bridge_detected event.
        const bridgeRowsToInsert: Array<{
          tenant_id: string
          src_kind: 'company'
          src_id: string
          dst_kind: 'company'
          dst_id: string
          edge_kind: 'bridges_to'
          weight: number
          evidence: Record<string, unknown>
        }> = []
        let contactsProcessed = 0

        for (const contact of prospect_contacts) {
          contactsProcessed += 1
          const matchedCustomerIds = new Set<string>()
          for (const prevName of contact.previous_companies) {
            const resolvedId = resolveCompanyString(prevName, index)
            if (resolvedId && customerSet.has(resolvedId)) {
              matchedCustomerIds.add(resolvedId)
            }
          }

          // For each matched customer, write a directed bridges_to
          // edge: customer_company → prospect_company. The unique
          // constraint dedupes when the same bridge is detected via
          // multiple shared previous_companies entries.
          for (const customerId of matchedCustomerIds) {
            if (customerId === contact.company_id) continue
            bridgeRowsToInsert.push({
              tenant_id: ctx.tenantId,
              src_kind: 'company',
              src_id: customerId,
              dst_kind: 'company',
              dst_id: contact.company_id,
              edge_kind: 'bridges_to',
              weight: 0.7, // base weight; multi-bridge pattern boosts via count
              evidence: {
                miner: 'mine_reverse_alumni',
                bridging_contact_id: contact.id,
                bridging_contact_name:
                  `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || null,
              },
            })
          }
        }

        if (bridgeRowsToInsert.length === 0) {
          return { bridges_written: 0, contacts_processed: contactsProcessed }
        }

        // Batched upsert with ignoreDuplicates so re-runs are
        // no-ops. The unique constraint on memory_edges enforces
        // it; we reuse the Phase 6 onConflict tuple.
        const { error: insertErr } = await ctx.supabase
          .from('memory_edges')
          .upsert(bridgeRowsToInsert, {
            onConflict: 'tenant_id,src_kind,src_id,dst_kind,dst_id,edge_kind',
            ignoreDuplicates: true,
          })

        if (insertErr) {
          console.warn('[mine-reverse-alumni] edge insert failed:', insertErr.message)
          return {
            bridges_written: 0,
            contacts_processed: contactsProcessed,
            error: insertErr.message,
          }
        }

        // One telemetry event per inserted bridge so /admin/adaptation
        // can show "X bridges this week". Emit only the first 50 to
        // keep the agent_events table from inflating.
        for (const row of bridgeRowsToInsert.slice(0, 50)) {
          await emitAgentEvent(ctx.supabase, {
            tenant_id: ctx.tenantId,
            event_type: 'bridge_detected',
            payload: {
              edge_kind: row.edge_kind,
              src_kind: row.src_kind,
              dst_kind: row.dst_kind,
              miner: 'mine_reverse_alumni',
              src_id: row.src_id,
              dst_id: row.dst_id,
              bridging_contact_id:
                (row.evidence.bridging_contact_id as string | undefined) ?? null,
            },
          })
        }

        return {
          bridges_written: bridgeRowsToInsert.length,
          contacts_processed: contactsProcessed,
          customer_count: customer_company_ids.length,
        }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
