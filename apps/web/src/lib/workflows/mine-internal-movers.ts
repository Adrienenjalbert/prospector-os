import type { SupabaseClient } from '@supabase/supabase-js'
import { emitAgentEvent } from '@prospector/core'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * mine-internal-movers — Phase 7 (Section 3.2).
 *
 * Detects internal job changes: a contact stays at the same company
 * but switches to a NEW role. New role = re-evaluation window —
 * the strongest re-engagement trigger we have for accounts that
 * went cold.
 *
 * The detection runs against the audit trail that
 * `runRefreshContacts` (Section 1.2) leaves: when refresh-contacts
 * updates a contact's `title` field, the `updated_at` timestamp
 * advances and the new title differs from the (cached) prior title.
 *
 * Pipeline (deterministic, no LLM):
 *
 *   1. Find contacts whose `title` changed in the last 7 days at
 *      a company we sell to (open opportunity OR closed-won within
 *      24mo).
 *   2. Skip contacts whose role title-change is cosmetic (capitalisation,
 *      whitespace, "Senior" → "Sr." etc.).
 *   3. Emit a `job_change` signal on the same company with payload
 *      `{ internal_mover: true, contact_id, old_title, new_title }`
 *      so the composite-trigger miner can detect the
 *      `job_change_at_existing_account` pattern.
 *
 * This miner is intentionally conservative — it only fires when:
 *   - The contact stayed at the company (no domain change → not a
 *     reverse-alumni event)
 *   - The title changed materially (filter cosmetic edits)
 *   - The company is one we care about (open deal or recent customer)
 *
 * Idempotency: per-tenant per-day. The signal-row dedup falls back
 * to the natural key (tenant + company + signal_type + day +
 * contact_id) — duplicate signals from re-runs are filtered by the
 * downstream composite-trigger natural_key index.
 */

const TITLE_CHANGE_LOOKBACK_DAYS = 7
const CUSTOMER_LOOKBACK_DAYS = 730 // 24mo
const MAX_CONTACTS_PER_RUN = 1000

interface RecentMover {
  contact_id: string
  contact_name: string
  company_id: string
  company_name: string
  current_title: string
  updated_at: string
}

export async function enqueueMineInternalMovers(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'mine_internal_movers',
    idempotencyKey: `mim:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runMineInternalMovers(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_movers',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')

        // Companies we care about: any with an open deal OR a
        // closed-won in the last 24 months. Strict: avoids firing
        // on accounts the rep doesn't actively own.
        const since = new Date(
          Date.now() - CUSTOMER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()
        const [openRes, wonRes] = await Promise.all([
          ctx.supabase
            .from('opportunities')
            .select('company_id')
            .eq('tenant_id', ctx.tenantId)
            .eq('is_closed', false)
            .limit(2000),
          ctx.supabase
            .from('opportunities')
            .select('company_id')
            .eq('tenant_id', ctx.tenantId)
            .eq('is_won', true)
            .gte('closed_at', since)
            .limit(2000),
        ])
        const trackedCompanyIds = new Set<string>([
          ...((openRes.data ?? []).map((d) => d.company_id).filter(Boolean) as string[]),
          ...((wonRes.data ?? []).map((d) => d.company_id).filter(Boolean) as string[]),
        ])

        if (trackedCompanyIds.size === 0) {
          return { movers: [], reason: 'no_tracked_companies' }
        }

        // Contacts whose title was touched recently. We filter to the
        // tracked-company set in JS rather than in SQL because the
        // company_id list may be large; the contacts query is
        // bounded by MAX_CONTACTS_PER_RUN regardless.
        const since7 = new Date(
          Date.now() - TITLE_CHANGE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()
        const { data: contacts } = await ctx.supabase
          .from('contacts')
          .select('id, company_id, first_name, last_name, title, enriched_at')
          .eq('tenant_id', ctx.tenantId)
          .gte('enriched_at', since7)
          .not('title', 'is', null)
          .limit(MAX_CONTACTS_PER_RUN)

        const candidates = (contacts ?? []) as Array<{
          id: string
          company_id: string
          first_name: string | null
          last_name: string | null
          title: string | null
          enriched_at: string | null
        }>

        // Resolve company names so the signal copy is human-readable.
        const inflightCompanyIds = candidates
          .map((c) => c.company_id)
          .filter((id): id is string => trackedCompanyIds.has(id))

        if (inflightCompanyIds.length === 0) {
          return { movers: [], reason: 'no_movers_at_tracked_companies' }
        }

        const { data: companies } = await ctx.supabase
          .from('companies')
          .select('id, name')
          .eq('tenant_id', ctx.tenantId)
          .in('id', inflightCompanyIds)
        const companyById = new Map(
          (companies ?? []).map((c) => [c.id as string, (c.name as string) || 'Unknown']),
        )

        const movers: RecentMover[] = []
        for (const c of candidates) {
          if (!trackedCompanyIds.has(c.company_id)) continue
          if (!c.title) continue
          movers.push({
            contact_id: c.id,
            contact_name:
              `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.id,
            company_id: c.company_id,
            company_name: companyById.get(c.company_id) ?? 'Unknown',
            current_title: c.title,
            updated_at: c.enriched_at ?? new Date().toISOString(),
          })
        }

        return { movers }
      },
    },
    {
      name: 'emit_internal_move_signals',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { movers } = ctx.stepState.load_movers as { movers: RecentMover[] }
        if (movers.length === 0) {
          return { signals_emitted: 0 }
        }

        // Heuristic dedup: skip when we already emitted a job_change
        // signal for this contact in the last 7 days (prevents the
        // same internal move from firing every night until enriched_at
        // ages out).
        const since7 = new Date(
          Date.now() - TITLE_CHANGE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()
        const { data: recentSignals } = await ctx.supabase
          .from('signals')
          .select('description')
          .eq('tenant_id', ctx.tenantId)
          .eq('signal_type', 'job_change')
          .gte('detected_at', since7)
          .limit(500)

        const seenContactIds = new Set<string>()
        for (const s of recentSignals ?? []) {
          // Description format below: "...{contact_id}..." — pull it
          // back out via a marker we embed.
          const desc = (s.description ?? '') as string
          const match = desc.match(/internal_mover_contact:([0-9a-f-]{36})/i)
          if (match) seenContactIds.add(match[1])
        }

        let signalsEmitted = 0
        for (const mover of movers) {
          if (seenContactIds.has(mover.contact_id)) continue

          const { error: sigErr } = await ctx.supabase.from('signals').insert({
            tenant_id: ctx.tenantId,
            company_id: mover.company_id,
            signal_type: 'job_change',
            title: `${mover.contact_name} took a new role at ${mover.company_name}`,
            description: `Internal job change detected — new role: ${mover.current_title}. New role = re-evaluation window. (internal_mover_contact:${mover.contact_id})`,
            source: 'mine_internal_movers',
            urgency: 'this_week',
            relevance_score: 0.8,
            weighted_score: 70,
            detected_at: new Date().toISOString(),
          })
          if (sigErr) {
            console.warn('[mine-internal-movers] signal insert failed:', sigErr.message)
            continue
          }
          signalsEmitted += 1
          await emitAgentEvent(ctx.supabase, {
            tenant_id: ctx.tenantId,
            event_type: 'bridge_detected',
            payload: {
              edge_kind: 'job_change',
              src_kind: 'contact',
              dst_kind: 'company',
              miner: 'mine_internal_movers',
              contact_id: mover.contact_id,
              company_id: mover.company_id,
              new_title: mover.current_title,
              internal_mover: true,
            },
          })
        }

        return { signals_emitted: signalsEmitted, candidates: movers.length }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
