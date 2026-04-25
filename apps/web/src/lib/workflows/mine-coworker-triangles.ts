import type { SupabaseClient } from '@supabase/supabase-js'
import { emitAgentEvent } from '@prospector/core'
import {
  loadCompanyResolutionIndex,
  resolveCompanyString,
  normaliseCompanyName,
} from '@/lib/memory/entity-resolution'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * mine-coworker-triangles — Phase 7 (Section 3.2).
 *
 * Finds 3-way coworker bridges: contact A at prospect P1 and contact
 * B at prospect P2 BOTH used to work at company X (where X may or may
 * not be in the tenant CRM).
 *
 * Why "triangles" specifically: a single shared previous employer is
 * a thin signal (lots of people worked at $BigCo at some point). But
 * when TWO contacts at TWO DIFFERENT prospects both worked at the
 * same intermediate company, the bridge has structural strength —
 * either company X is small/specific (high-confidence bridge) or
 * the contacts share a tight cohort (alumni network).
 *
 * Pipeline (deterministic):
 *
 *   1. Load all contacts with non-empty `previous_companies`.
 *   2. Build an inverted index: previous_company_normalised →
 *      [{ contact_id, company_id }].
 *   3. For each previous_company entry that has 2+ contacts at
 *      DIFFERENT current companies, emit:
 *      - `coworked_with` edge: contact A ↔ contact B (bidirectional)
 *      - `bridges_to` edge: company A ↔ company B with weight 0.85
 *        (higher than reverse-alumni's 0.7 because triangle = stronger)
 *
 * Idempotency: per-tenant per-day; unique edge constraint dedupes.
 *
 * Output volume: ~10-50 high-value bridges per tenant after warmup.
 *
 * This is the strongest connection signal in Phase 7 because it's
 * structural (graph topology), not just enrichment (string match).
 */

const MAX_CONTACTS_PER_RUN = 5000
const MIN_CONTACTS_PER_PREVIOUS_COMPANY = 2  // need at least a triangle
const MAX_TRIANGLE_FANOUT = 20                // skip ultra-popular shared companies

interface ContactWithPrevious {
  id: string
  company_id: string
  first_name: string | null
  last_name: string | null
  previous_companies: string[]
}

export async function enqueueMineCoworkerTriangles(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'mine_coworker_triangles',
    idempotencyKey: `mct:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runMineCoworkerTriangles(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_contacts',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')

        const { data: contacts } = await ctx.supabase
          .from('contacts')
          .select('id, company_id, first_name, last_name, previous_companies')
          .eq('tenant_id', ctx.tenantId)
          .not('previous_companies', 'is', null)
          .limit(MAX_CONTACTS_PER_RUN)

        const all = (contacts ?? []) as Array<{
          id: string
          company_id: string
          first_name: string | null
          last_name: string | null
          previous_companies: unknown
        }>

        const rows: ContactWithPrevious[] = []
        for (const c of all) {
          if (!Array.isArray(c.previous_companies)) continue
          const prevList = c.previous_companies.filter(
            (p): p is string => typeof p === 'string' && p.length > 0,
          )
          if (prevList.length === 0) continue
          rows.push({
            id: c.id,
            company_id: c.company_id,
            first_name: c.first_name,
            last_name: c.last_name,
            previous_companies: prevList,
          })
        }

        return { contacts: rows }
      },
    },
    {
      name: 'find_triangles_and_emit',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { contacts } = ctx.stepState.load_contacts as {
          contacts: ContactWithPrevious[]
        }

        if (contacts.length === 0) {
          return { triangles_found: 0, bridges_written: 0 }
        }

        const index = await loadCompanyResolutionIndex(ctx.supabase, ctx.tenantId)

        // Inverted index: normalised previous_company → [{ contact, company }].
        // We use the resolveCompanyString output (when matched) OR the
        // normalised string (when not) as the key. Tenant-internal
        // company matches are stronger but the triangle works either way.
        const byPreviousEmployer = new Map<
          string,
          Array<{ contactId: string; companyId: string; contactName: string }>
        >()

        for (const contact of contacts) {
          const seenForThisContact = new Set<string>()
          for (const prevName of contact.previous_companies) {
            // Use the resolved-id when possible; fall back to
            // normalised name. The key has a prefix marker so
            // resolved/unresolved entries don't collide.
            const resolvedId = resolveCompanyString(prevName, index)
            const key = resolvedId ? `id:${resolvedId}` : `name:${normaliseCompanyName(prevName)}`
            if (key === 'name:' || seenForThisContact.has(key)) continue
            seenForThisContact.add(key)

            const arr = byPreviousEmployer.get(key) ?? []
            arr.push({
              contactId: contact.id,
              companyId: contact.company_id,
              contactName:
                `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || contact.id,
            })
            byPreviousEmployer.set(key, arr)
          }
        }

        // Walk the inverted index for triangles.
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
        const coworkerEdgesToInsert: Array<{
          tenant_id: string
          src_kind: 'contact'
          src_id: string
          dst_kind: 'contact'
          dst_id: string
          edge_kind: 'coworked_with'
          weight: number
          evidence: Record<string, unknown>
        }> = []
        const seenBridgePairs = new Set<string>()
        const seenCoworkerPairs = new Set<string>()
        let trianglesFound = 0

        for (const [previousKey, members] of byPreviousEmployer) {
          if (members.length < MIN_CONTACTS_PER_PREVIOUS_COMPANY) continue
          if (members.length > MAX_TRIANGLE_FANOUT) continue // skip ubergeneric "Google"

          // For each pair where the two contacts are at DIFFERENT
          // current companies, write the edges.
          for (let i = 0; i < members.length; i++) {
            for (let j = i + 1; j < members.length; j++) {
              const a = members[i]
              const b = members[j]
              if (a.companyId === b.companyId) continue
              trianglesFound += 1

              // bridges_to edge between the two CURRENT companies.
              // Sort the (src, dst) tuple so re-detection from the
              // other side dedupes against the unique constraint.
              const [companyLow, companyHigh] = [a.companyId, b.companyId].sort()
              const bridgePairKey = `${companyLow}|${companyHigh}`
              if (!seenBridgePairs.has(bridgePairKey)) {
                seenBridgePairs.add(bridgePairKey)
                bridgeRowsToInsert.push({
                  tenant_id: ctx.tenantId,
                  src_kind: 'company',
                  src_id: companyLow,
                  dst_kind: 'company',
                  dst_id: companyHigh,
                  edge_kind: 'bridges_to',
                  weight: 0.85,
                  evidence: {
                    miner: 'mine_coworker_triangles',
                    via_previous_employer: previousKey,
                    bridging_contacts: [a.contactId, b.contactId],
                    bridging_contact_names: [a.contactName, b.contactName],
                  },
                })
              }

              // coworked_with edge between the two contacts (sorted
              // for dedup).
              const [contactLow, contactHigh] = [a.contactId, b.contactId].sort()
              const coworkerKey = `${contactLow}|${contactHigh}`
              if (!seenCoworkerPairs.has(coworkerKey)) {
                seenCoworkerPairs.add(coworkerKey)
                coworkerEdgesToInsert.push({
                  tenant_id: ctx.tenantId,
                  src_kind: 'contact',
                  src_id: contactLow,
                  dst_kind: 'contact',
                  dst_id: contactHigh,
                  edge_kind: 'coworked_with',
                  weight: 0.85,
                  evidence: {
                    miner: 'mine_coworker_triangles',
                    via_previous_employer: previousKey,
                  },
                })
              }
            }
          }
        }

        // Batched upsert; unique constraint dedupes across runs.
        const allEdges = [...bridgeRowsToInsert, ...coworkerEdgesToInsert]
        if (allEdges.length === 0) {
          return { triangles_found: trianglesFound, bridges_written: 0 }
        }

        const { error: insertErr } = await ctx.supabase
          .from('memory_edges')
          .upsert(allEdges, {
            onConflict: 'tenant_id,src_kind,src_id,dst_kind,dst_id,edge_kind',
            ignoreDuplicates: true,
          })
        if (insertErr) {
          console.warn(
            '[mine-coworker-triangles] edge insert failed:',
            insertErr.message,
          )
          return {
            triangles_found: trianglesFound,
            bridges_written: 0,
            error: insertErr.message,
          }
        }

        // Telemetry — first 50 events to bound table growth.
        for (const row of bridgeRowsToInsert.slice(0, 50)) {
          await emitAgentEvent(ctx.supabase, {
            tenant_id: ctx.tenantId,
            event_type: 'bridge_detected',
            payload: {
              edge_kind: row.edge_kind,
              src_kind: row.src_kind,
              dst_kind: row.dst_kind,
              miner: 'mine_coworker_triangles',
              src_id: row.src_id,
              dst_id: row.dst_id,
            },
          })
        }

        return {
          triangles_found: trianglesFound,
          bridges_written: bridgeRowsToInsert.length,
          coworker_edges_written: coworkerEdgesToInsert.length,
        }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
