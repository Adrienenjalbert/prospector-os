import type { SupabaseClient } from '@supabase/supabase-js'
import { urn } from '@prospector/core'
import { proposeMemory } from '@/lib/memory/writer'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * mine-rep-playbook — nightly workflow that derives `rep_playbook`
 * memories per active rep from their own won-deal track record.
 *
 * For each rep with at least N closed deals in the last 24 months,
 * computes:
 *
 *   - win rate (won / closed)
 *   - median deal value on wins
 *   - median multi-threading rate on wins (distinct contacts per
 *     won-account)
 *
 * Plus a tenant-wide TOP-QUARTILE benchmark per metric so the rep
 * can see "your win rate is 31% — top quartile is 42%; your contact
 * breadth is 4 — top quartile is 7". Each rep memory includes
 * actionable framing ("multi-thread to 7+ contacts").
 *
 * Per-rep memories scope `actor_urn`-style via the rep_id field.
 * Tenant-wide top-quartile rows omit `rep_id` so they show up as
 * "the bar to clear" on every rep's playbook slice.
 *
 * Cost: zero AI. Pure SQL + simple stats.
 */

const MIN_CLOSED_FOR_REP = 8

interface OppForPlaybook {
  id: string
  company_id: string | null
  owner_crm_id: string | null
  is_won: boolean | null
  value: number | null
  closed_at: string | null
}

interface RepRow {
  id: string
  crm_id: string
  name: string
}

interface ContactCountRow {
  company_id: string
  count: number
}

interface RepStats {
  rep_id: string
  rep_crm_id: string
  rep_name: string
  closed: number
  won: number
  win_rate: number
  median_deal_value_wins: number | null
  median_contact_breadth_wins: number | null
  sample_won_urns: string[]
}

export async function enqueueMineRepPlaybook(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'mine_rep_playbook',
    idempotencyKey: `mrp:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runMineRepPlaybook(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_inputs',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(
          Date.now() - 24 * 30 * 24 * 60 * 60 * 1000,
        ).toISOString()

        const [oppsRes, repsRes] = await Promise.all([
          ctx.supabase
            .from('opportunities')
            .select('id, company_id, owner_crm_id, is_won, value, closed_at')
            .eq('tenant_id', ctx.tenantId)
            .eq('is_closed', true)
            .gte('closed_at', since)
            .limit(5000),
          ctx.supabase
            .from('rep_profiles')
            .select('id, crm_id, name')
            .eq('tenant_id', ctx.tenantId)
            .eq('active', true),
        ])

        const opps = (oppsRes.data ?? []) as OppForPlaybook[]
        const reps = (repsRes.data ?? []) as RepRow[]

        if (opps.length === 0 || reps.length === 0) {
          return { skipped: true, reason: 'insufficient_data' }
        }

        // Pull contact counts per company (won + lost) so we can
        // compute multi-threading rate. Single bulk query.
        const companyIds = [
          ...new Set(
            opps
              .map((o) => o.company_id as string | null)
              .filter((id): id is string => !!id),
          ),
        ]
        let contactCountByCompany = new Map<string, number>()
        if (companyIds.length > 0) {
          const { data: contacts } = await ctx.supabase
            .from('contacts')
            .select('company_id')
            .eq('tenant_id', ctx.tenantId)
            .in('company_id', companyIds)
          for (const c of (contacts ?? []) as { company_id: string }[]) {
            contactCountByCompany.set(
              c.company_id,
              (contactCountByCompany.get(c.company_id) ?? 0) + 1,
            )
          }
        }
        const contactCountRows: ContactCountRow[] = Array.from(
          contactCountByCompany.entries(),
        ).map(([company_id, count]) => ({ company_id, count }))

        return { opps, reps, contactCountRows }
      },
    },

    {
      name: 'compute_per_rep_stats',
      run: async (ctx) => {
        const loaded = ctx.stepState.load_inputs as
          | {
              skipped?: boolean
              opps?: OppForPlaybook[]
              reps?: RepRow[]
              contactCountRows?: ContactCountRow[]
            }
          | undefined
        if (!loaded || loaded.skipped) return { skipped: true }

        const opps = loaded.opps ?? []
        const reps = loaded.reps ?? []
        const contactCountByCompany = new Map<string, number>(
          (loaded.contactCountRows ?? []).map((r) => [r.company_id, r.count]),
        )

        const repsByCrm = new Map(reps.map((r) => [r.crm_id, r]))
        const stats = new Map<string, RepStats>()
        for (const rep of reps) {
          stats.set(rep.crm_id, {
            rep_id: rep.id,
            rep_crm_id: rep.crm_id,
            rep_name: rep.name,
            closed: 0,
            won: 0,
            win_rate: 0,
            median_deal_value_wins: null,
            median_contact_breadth_wins: null,
            sample_won_urns: [],
          })
        }
        // Per-rep accumulator buckets so we can compute medians once.
        const wonValues = new Map<string, number[]>()
        const wonBreadths = new Map<string, number[]>()
        for (const o of opps) {
          if (!o.owner_crm_id) continue
          const rep = repsByCrm.get(o.owner_crm_id)
          if (!rep) continue
          const s = stats.get(rep.crm_id)!
          s.closed += 1
          if (o.is_won) {
            s.won += 1
            if (typeof o.value === 'number' && o.value > 0) {
              const list = wonValues.get(rep.crm_id) ?? []
              list.push(o.value)
              wonValues.set(rep.crm_id, list)
            }
            if (o.company_id) {
              const breadth = contactCountByCompany.get(o.company_id) ?? 0
              if (breadth > 0) {
                const list = wonBreadths.get(rep.crm_id) ?? []
                list.push(breadth)
                wonBreadths.set(rep.crm_id, list)
              }
            }
            if (s.sample_won_urns.length < 6 && ctx.tenantId) {
              s.sample_won_urns.push(urn.opportunity(ctx.tenantId, o.id))
            }
          }
        }
        for (const s of stats.values()) {
          s.win_rate = s.closed > 0 ? s.won / s.closed : 0
          s.median_deal_value_wins = median(wonValues.get(s.rep_crm_id) ?? [])
          s.median_contact_breadth_wins = median(wonBreadths.get(s.rep_crm_id) ?? [])
        }

        const eligible = Array.from(stats.values()).filter(
          (s) => s.closed >= MIN_CLOSED_FOR_REP,
        )
        if (eligible.length === 0) {
          return { skipped: true, reason: 'no_rep_above_threshold' }
        }

        // Tenant-wide top-quartile benchmarks (across eligible reps).
        const topQuartile = {
          win_rate: percentile(eligible.map((s) => s.win_rate), 0.75),
          deal_value: percentile(
            eligible
              .map((s) => s.median_deal_value_wins)
              .filter((n): n is number => n !== null),
            0.75,
          ),
          contact_breadth: percentile(
            eligible
              .map((s) => s.median_contact_breadth_wins)
              .filter((n): n is number => n !== null),
            0.75,
          ),
        }

        return { eligible, topQuartile }
      },
    },

    {
      name: 'write_playbook_memories',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const computed = ctx.stepState.compute_per_rep_stats as
          | {
              skipped?: boolean
              eligible?: RepStats[]
              topQuartile?: { win_rate: number; deal_value: number; contact_breadth: number }
            }
          | undefined
        if (!computed || computed.skipped || !computed.eligible) {
          return { skipped: true }
        }

        const writes: string[] = []

        // 1. Tenant-wide top-quartile playbook (no rep_id) —
        // every rep sees this on their slice as "the bar".
        if (computed.topQuartile) {
          const r = await proposeMemory(ctx.supabase, {
            tenant_id: ctx.tenantId,
            kind: 'rep_playbook',
            scope: { segment: 'top_quartile' },
            title: 'Top-quartile rep playbook',
            body: `Across ${computed.eligible.length} reps with ≥${MIN_CLOSED_FOR_REP} closed deals each, the top quartile hits: win rate ≥ ${(computed.topQuartile.win_rate * 100).toFixed(0)}%, median deal value ≥ ${formatMoney(computed.topQuartile.deal_value)}, multi-threading to ≥ ${Math.round(computed.topQuartile.contact_breadth)} contacts per won account. Use these as the bar when coaching toward "what does great look like for this tenant".`,
            evidence: {
              urns: [],
              counts: {
                eligible_reps: computed.eligible.length,
                top_quartile_win_rate_pct: Math.round(computed.topQuartile.win_rate * 100),
                top_quartile_deal_value: Math.round(computed.topQuartile.deal_value),
                top_quartile_contact_breadth: Math.round(computed.topQuartile.contact_breadth),
              },
            },
            confidence: Math.min(
              0.95,
              0.4 + Math.min(0.55, Math.log10(Math.max(computed.eligible.length, 3)) * 0.4),
            ),
            source_workflow: 'mine_rep_playbook',
          })
          writes.push(r.memory_id)
        }

        // 2. Per-rep playbooks. Each row scoped by rep_id so the
        // rep-playbook slice can pick the active rep's memory.
        for (const s of computed.eligible) {
          const winRatePct = (s.win_rate * 100).toFixed(0)
          const breadth = s.median_contact_breadth_wins ?? 0
          const dealValue = s.median_deal_value_wins ?? 0

          const winRateGap = computed.topQuartile
            ? Math.round((computed.topQuartile.win_rate - s.win_rate) * 100)
            : null
          const breadthGap = computed.topQuartile
            ? Math.round(computed.topQuartile.contact_breadth - breadth)
            : null

          const gapFragment =
            winRateGap !== null && winRateGap > 0 && breadthGap !== null && breadthGap > 0
              ? ` Top-quartile gap: +${winRateGap}pp win rate AND +${breadthGap} contacts per account — multi-threading is the highest-leverage move.`
              : winRateGap !== null && winRateGap > 0
                ? ` Top-quartile win-rate gap: +${winRateGap}pp.`
                : ''

          const r = await proposeMemory(ctx.supabase, {
            tenant_id: ctx.tenantId,
            kind: 'rep_playbook',
            scope: { rep_id: s.rep_id, segment: 'per_rep' },
            title: `${s.rep_name}'s playbook`,
            body: `Across ${s.closed} closed deals (${s.won}W/${s.closed - s.won}L, ${winRatePct}% win rate), median win value ${formatMoney(dealValue)}, median contact breadth ${breadth || 'unknown'} per won account.${gapFragment}`,
            evidence: {
              urns: s.sample_won_urns,
              counts: {
                closed: s.closed,
                won: s.won,
                win_rate_pct: Math.round(s.win_rate * 100),
                median_deal_value: Math.round(dealValue),
                median_contact_breadth: breadth,
              },
            },
            confidence: Math.min(
              0.95,
              0.3 + Math.min(0.65, Math.log10(Math.max(s.closed, 3)) * 0.45),
            ),
            source_workflow: 'mine_rep_playbook',
          })
          writes.push(r.memory_id)
        }

        return { memories_written: writes.length, memory_ids: writes }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]
}

function formatMoney(value: number): string {
  if (!value || !isFinite(value)) return 'unknown'
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`
  return `$${Math.round(value)}`
}
