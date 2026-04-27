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
 * derive-sales-motion — nightly workflow that turns won-deal stage
 * dynamics into typed `motion_step` memories.
 *
 * For each stage that appears on at least N won opportunities in the
 * last 24 months, computes:
 *
 *   - median time-in-stage on the wins
 *   - median contact-breadth (distinct contacts on the company)
 *
 * Output: one `motion_step` memory per stage, scoped by stage. The
 * motion-fingerprint slice surfaces the matching memory on the active
 * deal's stage; the stalled-deals slice can quote the same median
 * via the existing funnel_benchmarks table — these memories add the
 * "deviation flag" semantic that funnel_benchmarks alone don't carry.
 *
 * Cost: zero AI. Pure SQL aggregation.
 *
 * Why not piggyback on `funnel_benchmarks`?
 *   - funnel_benchmarks is computed from ALL deals (won + lost +
 *     open) — the median is biased by stalled lost deals. We want
 *     the WON-only median because that's the motion the rep should
 *     mirror.
 *   - funnel_benchmarks doesn't track contact breadth.
 *   - Memory rows have evidence + confidence + lifecycle the agent
 *     can quote inline; benchmark rows don't.
 */

const MIN_WON_PER_STAGE = 5

interface OppForMotion {
  id: string
  company_id: string | null
  stage: string | null
  days_in_stage: number | null
}

interface ContactCountRow {
  company_id: string
  count: number
}

export async function enqueueDeriveSalesMotion(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'derive_sales_motion',
    idempotencyKey: `dsm:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runDeriveSalesMotion(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_won_motion',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(
          Date.now() - 24 * 30 * 24 * 60 * 60 * 1000,
        ).toISOString()

        const { data: opps } = await ctx.supabase
          .from('opportunities')
          .select('id, company_id, stage, days_in_stage')
          .eq('tenant_id', ctx.tenantId)
          .eq('is_closed', true)
          .eq('is_won', true)
          .gte('closed_at', since)
          .limit(3000)

        const wonOpps = (opps ?? []) as OppForMotion[]
        if (wonOpps.length < MIN_WON_PER_STAGE) {
          return {
            skipped: true,
            reason: `fewer_than_${MIN_WON_PER_STAGE}_won`,
            count: wonOpps.length,
          }
        }

        // Tally contact-breadth per company so we can compute a median
        // breadth on the won set. We look at ALL contacts ever on the
        // won companies — multi-threading is the durable signal,
        // contemporaneous-only would be brittle.
        const wonCompanyIds = [
          ...new Set(
            wonOpps
              .map((o) => o.company_id as string | null)
              .filter((id): id is string => !!id),
          ),
        ]

        let contactCountByCompany = new Map<string, number>()
        if (wonCompanyIds.length > 0) {
          const { data: contacts } = await ctx.supabase
            .from('contacts')
            .select('company_id')
            .eq('tenant_id', ctx.tenantId)
            .in('company_id', wonCompanyIds)
          const counts = new Map<string, number>()
          for (const c of (contacts ?? []) as { company_id: string }[]) {
            counts.set(c.company_id, (counts.get(c.company_id) ?? 0) + 1)
          }
          contactCountByCompany = counts
        }

        const contactCountRows: ContactCountRow[] = wonCompanyIds.map((id) => ({
          company_id: id,
          count: contactCountByCompany.get(id) ?? 0,
        }))

        return { wonOpps, contactCountRows }
      },
    },

    {
      name: 'compute_stage_motion',
      run: async (ctx) => {
        const loaded = ctx.stepState.load_won_motion as
          | {
              skipped?: boolean
              wonOpps?: OppForMotion[]
              contactCountRows?: ContactCountRow[]
            }
          | undefined
        if (!loaded || loaded.skipped) return { skipped: true }

        const wonOpps = loaded.wonOpps ?? []
        const contactCountRows = loaded.contactCountRows ?? []

        // Group won opps by stage. Skip stages with < MIN_WON_PER_STAGE
        // wins to avoid spurious "median 3 days from N=2" claims.
        const byStage = new Map<string, OppForMotion[]>()
        for (const o of wonOpps) {
          const stage = (o.stage ?? '').trim()
          if (!stage) continue
          let list = byStage.get(stage)
          if (!list) {
            list = []
            byStage.set(stage, list)
          }
          list.push(o)
        }

        const stageMedians = new Map<string, number>()
        for (const [stage, opps] of byStage.entries()) {
          if (opps.length < MIN_WON_PER_STAGE) continue
          const days = opps
            .map((o) => o.days_in_stage ?? 0)
            .filter((d) => d > 0)
            .sort((a, b) => a - b)
          if (days.length === 0) continue
          const median = days[Math.floor(days.length / 2)]
          stageMedians.set(stage, median)
        }

        // Tenant-wide contact breadth (median across won companies).
        const breadths = contactCountRows
          .map((r) => r.count)
          .filter((n) => n > 0)
          .sort((a, b) => a - b)
        const medianContactBreadth =
          breadths.length > 0 ? breadths[Math.floor(breadths.length / 2)] : null

        if (stageMedians.size === 0) {
          return { skipped: true, reason: 'no_stage_above_threshold' }
        }

        return {
          stageMedians: Array.from(stageMedians.entries()).map(([stage, median]) => ({
            stage,
            median_days: median,
            sample_size: byStage.get(stage)?.length ?? 0,
            sample_urns: (byStage.get(stage) ?? [])
              .slice(0, 6)
              .map((o) => urn.opportunity(ctx.tenantId!, o.id)),
          })),
          median_contact_breadth: medianContactBreadth,
          breadth_sample_size: breadths.length,
        }
      },
    },

    {
      name: 'write_motion_memories',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const computed = ctx.stepState.compute_stage_motion as
          | {
              skipped?: boolean
              stageMedians?: Array<{
                stage: string
                median_days: number
                sample_size: number
                sample_urns: string[]
              }>
              median_contact_breadth?: number | null
              breadth_sample_size?: number
            }
          | undefined
        if (!computed || computed.skipped || !computed.stageMedians) {
          return { skipped: true }
        }

        const writes: string[] = []
        for (const s of computed.stageMedians) {
          const confidence = Math.min(
            0.95,
            0.3 +
              Math.min(0.65, Math.log10(Math.max(s.sample_size, 3)) * 0.45),
          )

          const breadthFragment =
            computed.median_contact_breadth !== null &&
            computed.median_contact_breadth !== undefined
              ? ` Across the same wins, the median contact breadth is ${computed.median_contact_breadth} contact${computed.median_contact_breadth === 1 ? '' : 's'} per account — multi-thread to that level by mid-stage at the latest.`
              : ''

          const r = await proposeMemory(ctx.supabase, {
            tenant_id: ctx.tenantId,
            kind: 'motion_step',
            scope: { stage: s.stage },
            title: `${s.stage} cycle time on wins`,
            body: `Across ${s.sample_size} closed-won deals${s.sample_size === 1 ? '' : 's'}, the median time at the ${s.stage} stage is ${s.median_days} day${s.median_days === 1 ? '' : 's'}.${breadthFragment} If a deal materially exceeds this median at ${s.stage}, treat as a sales-motion deviation and intervene.`,
            evidence: {
              urns: s.sample_urns,
              counts: { won_opps: s.sample_size, median_days: s.median_days },
              samples: [s.stage],
            },
            confidence,
            source_workflow: 'derive_sales_motion',
          })
          writes.push(r.memory_id)
        }

        return {
          memories_written: writes.length,
          memory_ids: writes,
          median_contact_breadth: computed.median_contact_breadth,
        }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
