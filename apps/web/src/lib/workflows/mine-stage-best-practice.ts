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
 * mine-stage-best-practice — nightly workflow that derives, for each
 * pipeline stage, the SINGLE differential factor most associated with
 * winning at that stage.
 *
 * The plan called for "logistic regression of stage-specific actions
 * on win probability". With activities currently cached as JSON on
 * `companies.enrichment_data` (no first-class activities table yet),
 * the v1 implementation does the cheaper, deterministic alternative:
 *
 *   For each stage with ≥ MIN_PER_STAGE closed deals on each side:
 *     1. Compute median contact-breadth on WON vs LOST deals at that
 *        stage.
 *     2. Compute median signal-count on WON vs LOST deals.
 *     3. The factor with the largest WON-vs-LOST delta becomes the
 *        "key signal at <stage>" memory body.
 *
 * Output: one `stage_best_practice` memory per stage. Surfaced via
 * the rep-playbook slice as the action-verb suggestion the agent
 * leans on for top-1 inbox actions.
 *
 * Confidence reflects sample size on each side (won + lost). Cost:
 * zero AI.
 */

const MIN_PER_STAGE = 5

interface OppForStage {
  id: string
  company_id: string | null
  stage: string | null
  is_won: boolean | null
}

export async function enqueueMineStageBestPractice(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'mine_stage_best_practice',
    idempotencyKey: `msbp:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runMineStageBestPractice(
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

        const { data: opps } = await ctx.supabase
          .from('opportunities')
          .select('id, company_id, stage, is_won')
          .eq('tenant_id', ctx.tenantId)
          .eq('is_closed', true)
          .gte('closed_at', since)
          .limit(5000)

        const closedOpps = (opps ?? []) as OppForStage[]
        const companyIds = [
          ...new Set(
            closedOpps
              .map((o) => o.company_id as string | null)
              .filter((id): id is string => !!id),
          ),
        ]

        if (closedOpps.length === 0 || companyIds.length === 0) {
          return { skipped: true, reason: 'no_closed' }
        }

        // Contact breadth per company.
        const contactCountByCompany = new Map<string, number>()
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

        // Signal count per company (active + recent).
        const signalCountByCompany = new Map<string, number>()
        const { data: signals } = await ctx.supabase
          .from('signals')
          .select('company_id')
          .eq('tenant_id', ctx.tenantId)
          .in('company_id', companyIds)
        for (const s of (signals ?? []) as { company_id: string }[]) {
          signalCountByCompany.set(
            s.company_id,
            (signalCountByCompany.get(s.company_id) ?? 0) + 1,
          )
        }

        return {
          opps: closedOpps,
          contactCountByCompany: Array.from(contactCountByCompany.entries()),
          signalCountByCompany: Array.from(signalCountByCompany.entries()),
        }
      },
    },

    {
      name: 'compute_stage_factors',
      run: async (ctx) => {
        const loaded = ctx.stepState.load_inputs as
          | {
              skipped?: boolean
              opps?: OppForStage[]
              contactCountByCompany?: Array<[string, number]>
              signalCountByCompany?: Array<[string, number]>
            }
          | undefined
        if (!loaded || loaded.skipped) return { skipped: true }

        const opps = loaded.opps ?? []
        const contactCount = new Map<string, number>(loaded.contactCountByCompany ?? [])
        const signalCount = new Map<string, number>(loaded.signalCountByCompany ?? [])

        // Per-stage buckets of (breadth, signals) split by outcome.
        type StageAccumulator = {
          stage: string
          won_breadth: number[]
          lost_breadth: number[]
          won_signals: number[]
          lost_signals: number[]
          won_urns: string[]
        }
        const byStage = new Map<string, StageAccumulator>()
        for (const o of opps) {
          const stage = (o.stage ?? '').trim()
          if (!stage || !o.company_id) continue
          let acc = byStage.get(stage)
          if (!acc) {
            acc = {
              stage,
              won_breadth: [],
              lost_breadth: [],
              won_signals: [],
              lost_signals: [],
              won_urns: [],
            }
            byStage.set(stage, acc)
          }
          const breadth = contactCount.get(o.company_id) ?? 0
          const signals = signalCount.get(o.company_id) ?? 0
          if (o.is_won) {
            acc.won_breadth.push(breadth)
            acc.won_signals.push(signals)
            if (acc.won_urns.length < 6 && ctx.tenantId) {
              acc.won_urns.push(urn.opportunity(ctx.tenantId, o.id))
            }
          } else {
            acc.lost_breadth.push(breadth)
            acc.lost_signals.push(signals)
          }
        }

        const stageFactors: Array<{
          stage: string
          won_count: number
          lost_count: number
          won_median_breadth: number
          lost_median_breadth: number
          won_median_signals: number
          lost_median_signals: number
          headline_factor: 'contact_breadth' | 'signal_volume'
          delta: number
          won_urns: string[]
        }> = []
        for (const acc of byStage.values()) {
          if (
            acc.won_breadth.length < MIN_PER_STAGE ||
            acc.lost_breadth.length < MIN_PER_STAGE
          ) {
            continue
          }
          const wMedB = median(acc.won_breadth)
          const lMedB = median(acc.lost_breadth)
          const wMedS = median(acc.won_signals)
          const lMedS = median(acc.lost_signals)
          const breadthDelta = wMedB - lMedB
          const signalDelta = wMedS - lMedS
          const headlineFactor =
            Math.abs(breadthDelta) >= Math.abs(signalDelta)
              ? 'contact_breadth'
              : 'signal_volume'
          const delta =
            headlineFactor === 'contact_breadth' ? breadthDelta : signalDelta

          // Skip stages where neither factor moves materially.
          if (Math.abs(delta) < 0.5) continue

          stageFactors.push({
            stage: acc.stage,
            won_count: acc.won_breadth.length,
            lost_count: acc.lost_breadth.length,
            won_median_breadth: wMedB,
            lost_median_breadth: lMedB,
            won_median_signals: wMedS,
            lost_median_signals: lMedS,
            headline_factor: headlineFactor,
            delta,
            won_urns: acc.won_urns,
          })
        }

        if (stageFactors.length === 0) {
          return { skipped: true, reason: 'no_stage_with_signal' }
        }

        return { stageFactors }
      },
    },

    {
      name: 'write_stage_memories',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const computed = ctx.stepState.compute_stage_factors as
          | {
              skipped?: boolean
              stageFactors?: Array<{
                stage: string
                won_count: number
                lost_count: number
                won_median_breadth: number
                lost_median_breadth: number
                won_median_signals: number
                lost_median_signals: number
                headline_factor: 'contact_breadth' | 'signal_volume'
                delta: number
                won_urns: string[]
              }>
            }
          | undefined
        if (!computed || computed.skipped || !computed.stageFactors) {
          return { skipped: true }
        }

        const writes: string[] = []
        for (const sf of computed.stageFactors) {
          const total = sf.won_count + sf.lost_count
          const confidence = Math.min(
            0.95,
            0.3 + Math.min(0.65, Math.log10(Math.max(total, 3)) * 0.45),
          )

          const factorLabel =
            sf.headline_factor === 'contact_breadth'
              ? 'multi-threading (number of distinct contacts per account)'
              : 'active signal volume on the account'

          const wonValue =
            sf.headline_factor === 'contact_breadth'
              ? sf.won_median_breadth
              : sf.won_median_signals
          const lostValue =
            sf.headline_factor === 'contact_breadth'
              ? sf.lost_median_breadth
              : sf.lost_median_signals

          const actionVerb =
            sf.headline_factor === 'contact_breadth'
              ? 'multi-thread to'
              : 'mine for fresh signals to drive engagement past'

          const r = await proposeMemory(ctx.supabase, {
            tenant_id: ctx.tenantId,
            kind: 'stage_best_practice',
            scope: { stage: sf.stage },
            title: `Best practice at ${sf.stage}`,
            body: `At ${sf.stage}, the strongest WON-vs-LOST differentiator is ${factorLabel}. Wins at this stage have a median of ${wonValue}; losses sit at ${lostValue} (sample: ${sf.won_count}W/${sf.lost_count}L). When suggesting a next action at ${sf.stage}, prefer "${actionVerb} ${Math.max(1, Math.round(wonValue))}".`,
            evidence: {
              urns: sf.won_urns,
              counts: {
                won_count: sf.won_count,
                lost_count: sf.lost_count,
                won_value: Math.round(wonValue),
                lost_value: Math.round(lostValue),
              },
              samples: [sf.headline_factor, sf.stage],
            },
            confidence,
            source_workflow: 'mine_stage_best_practice',
          })
          writes.push(r.memory_id)
        }

        return { memories_written: writes.length, memory_ids: writes }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
