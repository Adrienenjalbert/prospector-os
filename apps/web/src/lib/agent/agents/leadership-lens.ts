import { z } from 'zod'
import { tool } from 'ai'
import type { AgentContext } from '@prospector/core'
import { getServiceSupabase } from '../tools/shared'
import {
  loadBusinessProfile,
  formatAgentHeader,
  formatBusinessContext,
  commonBehaviourRules,
  commonSalesPlaybook,
  formatPackedSections,
  joinPromptParts,
  type SystemPromptParts,
} from './_shared'
import type { PackedContext } from '../context'

/**
 * Leadership Lens — synthesises team-level signal across reps and stages.
 * Designed for sales leaders, RevOps, and CROs who need divergence and risk
 * roll-ups, not deal-by-deal coaching.
 */
export function createLeadershipLensTools(tenantId: string) {
  const supabase = getServiceSupabase()

  const funnel_divergence = tool({
    description:
      'Compare each rep\'s funnel against the company benchmark and surface stages where reps are diverging significantly. Use for "where are we losing deals as a team", "which reps need coaching at which stage".',
    parameters: z.object({
      min_delta_pts: z
        .number()
        .default(5)
        .describe('Minimum drop-rate delta vs company to flag (in percentage points)'),
    }),
    execute: async ({ min_delta_pts }) => {
      const [companyBenchRes, repBenchRes, repsRes] = await Promise.all([
        supabase
          .from('funnel_benchmarks')
          .select('stage_name, drop_rate, conversion_rate, median_days_in_stage')
          .eq('tenant_id', tenantId)
          .eq('scope', 'company')
          .eq('scope_id', 'all'),
        supabase
          .from('funnel_benchmarks')
          .select('stage_name, scope_id, drop_rate, conversion_rate, deal_count, stall_count, impact_score')
          .eq('tenant_id', tenantId)
          .eq('scope', 'rep'),
        supabase
          .from('rep_profiles')
          .select('crm_id, name')
          .eq('tenant_id', tenantId)
          .eq('active', true),
      ])

      const companyByStage = new Map(
        (companyBenchRes.data ?? []).map((b) => [b.stage_name, b]),
      )
      const repNames = new Map(
        (repsRes.data ?? []).map((r) => [r.crm_id, r.name]),
      )

      const stageRollup: Record<string, {
        stage: string
        company_drop_rate: number
        company_conversion_rate: number
        diverging_reps: { rep_name: string; rep_drop_rate: number; delta: number; deals: number; stalls: number; impact_score: number }[]
      }> = {}

      for (const rb of repBenchRes.data ?? []) {
        const cb = companyByStage.get(rb.stage_name)
        if (!cb) continue
        const delta = (rb.drop_rate ?? 0) - (cb.drop_rate ?? 0)
        if (Math.abs(delta) < min_delta_pts) continue

        if (!stageRollup[rb.stage_name]) {
          stageRollup[rb.stage_name] = {
            stage: rb.stage_name,
            company_drop_rate: cb.drop_rate ?? 0,
            company_conversion_rate: cb.conversion_rate ?? 0,
            diverging_reps: [],
          }
        }

        stageRollup[rb.stage_name].diverging_reps.push({
          rep_name: repNames.get(rb.scope_id) ?? rb.scope_id,
          rep_drop_rate: rb.drop_rate ?? 0,
          delta: Math.round(delta * 10) / 10,
          deals: rb.deal_count ?? 0,
          stalls: rb.stall_count ?? 0,
          impact_score: rb.impact_score ?? 0,
        })
      }

      return {
        threshold_pts: min_delta_pts,
        stages: Object.values(stageRollup).sort(
          (a, b) =>
            Math.max(...b.diverging_reps.map((r) => r.impact_score), 0) -
            Math.max(...a.diverging_reps.map((r) => r.impact_score), 0),
        ),
      }
    },
  })

  const forecast_risk = tool({
    description:
      'Identify open deals at highest forecast risk: stalled, slipping past close date, or with low propensity. Use for "what\'s at risk in the forecast", "which deals could miss this month".',
    parameters: z.object({
      months_ahead: z
        .number()
        .default(1)
        .describe('How many months out to assess (1 = current month)'),
      limit: z.number().default(20).describe('Max deals to return'),
    }),
    execute: async ({ months_ahead, limit }) => {
      const horizon = new Date()
      horizon.setMonth(horizon.getMonth() + months_ahead)

      const { data: opps } = await supabase
        .from('opportunities')
        .select('id, crm_id, name, value, stage, days_in_stage, is_stalled, stall_reason, expected_close_date, owner_crm_id, company_id')
        .eq('tenant_id', tenantId)
        .eq('is_closed', false)
        .lte('expected_close_date', horizon.toISOString().slice(0, 10))
        .order('value', { ascending: false })
        .limit(limit * 2)

      const dealRows = opps ?? []
      const companyIds = [...new Set(dealRows.map((d) => d.company_id).filter(Boolean))]

      const [companiesRes, repsRes] = await Promise.all([
        companyIds.length
          ? supabase
              .from('companies')
              .select('id, name, propensity, priority_tier')
              .in('id', companyIds)
          : Promise.resolve({ data: [] as { id: string; name: string; propensity: number | null; priority_tier: string | null }[] }),
        supabase
          .from('rep_profiles')
          .select('crm_id, name')
          .eq('tenant_id', tenantId),
      ])

      const companyMap = new Map(
        (companiesRes.data ?? []).map((c) => [c.id, c]),
      )
      const repMap = new Map(
        (repsRes.data ?? []).map((r) => [r.crm_id, r.name]),
      )

      const at_risk_deals = dealRows
        .map((d) => {
          const company = companyMap.get(d.company_id ?? '')
          const propensity = company?.propensity ?? 0
          const reasons: string[] = []
          if (d.is_stalled) reasons.push(d.stall_reason ?? 'stalled')
          if (propensity < 50) reasons.push(`low propensity (${propensity})`)
          if (d.expected_close_date && new Date(d.expected_close_date) < new Date()) {
            reasons.push('close date passed')
          }

          return {
            id: d.id,
            crm_id: d.crm_id,
            name: d.name,
            value: d.value,
            stage: d.stage,
            days_in_stage: d.days_in_stage,
            is_stalled: d.is_stalled,
            expected_close_date: d.expected_close_date,
            owner: repMap.get(d.owner_crm_id ?? '') ?? d.owner_crm_id,
            company_name: company?.name ?? 'Unknown',
            propensity,
            risk_reasons: reasons,
            risk_value: reasons.length > 0 ? d.value ?? 0 : 0,
          }
        })
        .filter((d) => d.risk_reasons.length > 0)
        .sort((a, b) => (b.risk_value ?? 0) - (a.risk_value ?? 0))
        .slice(0, limit)

      const total_risk_value = at_risk_deals.reduce(
        (s, d) => s + (d.risk_value ?? 0),
        0,
      )

      return {
        horizon_months: months_ahead,
        at_risk_count: at_risk_deals.length,
        total_risk_value,
        at_risk_deals,
      }
    },
  })

  const team_patterns = tool({
    description:
      'Win-rate, average cycle, and stall counts by rep. Use for "who\'s closing", "where the team needs coaching".',
    parameters: z.object({
      lookback_days: z.number().default(90),
    }),
    execute: async ({ lookback_days }) => {
      const since = new Date(Date.now() - lookback_days * 24 * 60 * 60 * 1000).toISOString()

      const [closedRes, openRes, repsRes] = await Promise.all([
        supabase
          .from('opportunities')
          .select('owner_crm_id, value, is_won, days_in_stage, created_at, closed_at')
          .eq('tenant_id', tenantId)
          .eq('is_closed', true)
          .gte('closed_at', since),
        supabase
          .from('opportunities')
          .select('owner_crm_id, value, is_stalled')
          .eq('tenant_id', tenantId)
          .eq('is_closed', false),
        supabase
          .from('rep_profiles')
          .select('crm_id, name, team')
          .eq('tenant_id', tenantId)
          .eq('active', true),
      ])

      const reps = repsRes.data ?? []
      type Bucket = { rep_name: string; team: string | null; closed: number; won: number; lost: number; pipeline_value: number; pipeline_count: number; stalls: number; avg_cycle_days: number | null; win_rate: number | null }
      const byRep: Record<string, Bucket> = {}

      for (const r of reps) {
        byRep[r.crm_id] = {
          rep_name: r.name,
          team: r.team,
          closed: 0,
          won: 0,
          lost: 0,
          pipeline_value: 0,
          pipeline_count: 0,
          stalls: 0,
          avg_cycle_days: null,
          win_rate: null,
        }
      }

      const cycleByRep: Record<string, number[]> = {}
      for (const c of closedRes.data ?? []) {
        const id = c.owner_crm_id ?? ''
        if (!byRep[id]) continue
        byRep[id].closed += 1
        if (c.is_won) byRep[id].won += 1
        else byRep[id].lost += 1
        if (c.created_at && c.closed_at) {
          const days = Math.round(
            (new Date(c.closed_at).getTime() - new Date(c.created_at).getTime()) /
              (24 * 60 * 60 * 1000),
          )
          cycleByRep[id] = cycleByRep[id] ?? []
          cycleByRep[id].push(days)
        }
      }

      for (const o of openRes.data ?? []) {
        const id = o.owner_crm_id ?? ''
        if (!byRep[id]) continue
        byRep[id].pipeline_value += o.value ?? 0
        byRep[id].pipeline_count += 1
        if (o.is_stalled) byRep[id].stalls += 1
      }

      for (const [id, bucket] of Object.entries(byRep)) {
        if (bucket.closed > 0) bucket.win_rate = Math.round((bucket.won / bucket.closed) * 100)
        const cycles = cycleByRep[id]
        if (cycles?.length) {
          bucket.avg_cycle_days = Math.round(
            cycles.reduce((s, n) => s + n, 0) / cycles.length,
          )
        }
      }

      return {
        lookback_days,
        reps: Object.values(byRep).sort(
          (a, b) => (b.win_rate ?? 0) - (a.win_rate ?? 0),
        ),
      }
    },
  })

  const coaching_themes = tool({
    description:
      'Surface common loss reasons and stall causes across the team. Use for "what coaching themes should we focus on", "common loss reasons".',
    parameters: z.object({
      lookback_days: z.number().default(90),
    }),
    execute: async ({ lookback_days }) => {
      const since = new Date(Date.now() - lookback_days * 24 * 60 * 60 * 1000).toISOString()

      const [lostRes, stalledRes] = await Promise.all([
        supabase
          .from('opportunities')
          .select('lost_reason, value')
          .eq('tenant_id', tenantId)
          .eq('is_won', false)
          .eq('is_closed', true)
          .not('lost_reason', 'is', null)
          .gte('closed_at', since),
        supabase
          .from('opportunities')
          .select('stall_reason, value')
          .eq('tenant_id', tenantId)
          .eq('is_stalled', true)
          .eq('is_closed', false)
          .not('stall_reason', 'is', null),
      ])

      const lostMap: Record<string, { count: number; value: number }> = {}
      for (const o of lostRes.data ?? []) {
        const k = (o.lost_reason ?? '').slice(0, 80) || 'Unspecified'
        lostMap[k] = lostMap[k] ?? { count: 0, value: 0 }
        lostMap[k].count += 1
        lostMap[k].value += o.value ?? 0
      }

      const stallMap: Record<string, { count: number; value: number }> = {}
      for (const o of stalledRes.data ?? []) {
        const k = (o.stall_reason ?? '').slice(0, 80) || 'Unspecified'
        stallMap[k] = stallMap[k] ?? { count: 0, value: 0 }
        stallMap[k].count += 1
        stallMap[k].value += o.value ?? 0
      }

      const top = (m: Record<string, { count: number; value: number }>) =>
        Object.entries(m)
          .map(([reason, v]) => ({ reason, ...v }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8)

      return {
        lookback_days,
        top_loss_reasons: top(lostMap),
        top_stall_reasons: top(stallMap),
      }
    },
  })

  return {
    funnel_divergence,
    forecast_risk,
    team_patterns,
    coaching_themes,
  }
}

export async function buildLeadershipLensPromptParts(
  tenantId: string,
  ctx: AgentContext | null = null,
  packed: PackedContext | null = null,
): Promise<SystemPromptParts> {
  const profile = await loadBusinessProfile(tenantId)

  const header = formatAgentHeader(
    'the Leadership Lens',
    'Synthesise team-level performance, divergence, and forecast risk for the leader.',
    profile,
  )

  const role = `## Role: Leadership Lens
You report to a sales leader. Your job is to synthesise across reps and stages, not coach individual deals.
- Always frame patterns at the rep, team, or stage level — not single accounts.
- Surface divergence (rep vs company benchmark) before listing details.
- For risk, name dollar value and concentration (e.g. "3 reps account for 80% of the at-risk pipeline").
- For coaching, propose ONE highest-leverage theme, not a laundry list.`

  const staticPrefix = [header, formatBusinessContext(profile), role].join('\n\n')

  const dynamicParts: string[] = []
  const packedSection = formatPackedSections(packed)
  if (packedSection) dynamicParts.push(packedSection)
  dynamicParts.push(commonSalesPlaybook(ctx, { role: 'leader' }))
  dynamicParts.push(commonBehaviourRules())

  return { staticPrefix, dynamicSuffix: dynamicParts.join('\n\n') }
}

export async function buildLeadershipLensPrompt(
  tenantId: string,
  ctx: AgentContext | null = null,
  packed: PackedContext | null = null,
): Promise<string> {
  const parts = await buildLeadershipLensPromptParts(tenantId, ctx, packed)
  return joinPromptParts(parts)
}
