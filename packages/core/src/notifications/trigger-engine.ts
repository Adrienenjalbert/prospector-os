import type { Company, Opportunity, Signal, FunnelBenchmark } from '../types/ontology'
import type { TriggerType, TriggerEvent, StallTriggerPayload, SignalTriggerPayload, PriorityShiftPayload, FunnelGapPayload } from '../types/notifications'

export interface TriggerEvaluationInput {
  company: Company
  opportunities: Opportunity[]
  signals: Signal[]
  repBenchmarks: FunnelBenchmark[]
  companyBenchmarks: FunnelBenchmark[]
  previousScores: { priority_tier: string; expected_revenue: number } | null
}

export interface TriggerConfig {
  stall_enabled: boolean
  signal_min_relevance: number
  priority_shift_threshold: number
  funnel_gap_threshold_pts: number
}

const DEFAULT_CONFIG: TriggerConfig = {
  stall_enabled: true,
  signal_min_relevance: 0.7,
  priority_shift_threshold: 15,
  funnel_gap_threshold_pts: 10,
}

export function evaluateTriggers(
  input: TriggerEvaluationInput,
  tenantId: string,
  repId: string,
  config: TriggerConfig = DEFAULT_CONFIG
): Omit<TriggerEvent, 'id' | 'created_at'>[] {
  const events: Omit<TriggerEvent, 'id' | 'created_at'>[] = []

  if (config.stall_enabled) {
    for (const opp of input.opportunities) {
      if (opp.is_stalled && !opp.is_closed) {
        const bench = input.companyBenchmarks.find((b) => b.stage_name === opp.stage)
        events.push({
          tenant_id: tenantId,
          trigger_type: 'deal_stall',
          rep_id: repId,
          company_id: input.company.id,
          opportunity_id: opp.id,
          payload: {
            type: 'deal_stall',
            deal_name: opp.name,
            stage: opp.stage,
            days_in_stage: opp.days_in_stage,
            median_days: bench?.median_days_in_stage ?? 14,
            stall_reason: opp.stall_reason ?? 'No recent activity',
            last_activity_date: input.company.last_activity_date,
          } satisfies StallTriggerPayload,
        })
      }
    }
  }

  for (const signal of input.signals) {
    if (signal.relevance_score >= config.signal_min_relevance && signal.urgency === 'immediate') {
      events.push({
        tenant_id: tenantId,
        trigger_type: 'signal_detected',
        rep_id: repId,
        company_id: input.company.id,
        opportunity_id: null,
        payload: {
          type: 'signal_detected',
          signal_type: signal.signal_type,
          signal_title: signal.title,
          relevance_score: signal.relevance_score,
          urgency: signal.urgency,
          company_name: input.company.name,
        } satisfies SignalTriggerPayload,
      })
    }
  }

  if (input.previousScores) {
    const scoreDelta = Math.abs(
      input.company.expected_revenue - input.previousScores.expected_revenue
    )
    const tierChanged = input.company.priority_tier !== input.previousScores.priority_tier

    if (tierChanged || scoreDelta >= config.priority_shift_threshold * 1000) {
      events.push({
        tenant_id: tenantId,
        trigger_type: 'priority_shift',
        rep_id: repId,
        company_id: input.company.id,
        opportunity_id: null,
        payload: {
          type: 'priority_shift',
          previous_tier: input.previousScores.priority_tier as Company['priority_tier'],
          new_tier: input.company.priority_tier,
          score_change: scoreDelta,
          reason: input.company.priority_reason ?? 'Score change',
        } satisfies PriorityShiftPayload,
      })
    }
  }

  for (const rb of input.repBenchmarks) {
    const cb = input.companyBenchmarks.find((c) => c.stage_name === rb.stage_name)
    if (!cb) continue
    const delta = rb.drop_rate - cb.drop_rate
    if (delta >= config.funnel_gap_threshold_pts) {
      events.push({
        tenant_id: tenantId,
        trigger_type: 'funnel_gap',
        rep_id: repId,
        company_id: null,
        opportunity_id: null,
        payload: {
          type: 'funnel_gap',
          stage: rb.stage_name,
          rep_drop_rate: rb.drop_rate,
          benchmark_drop_rate: cb.drop_rate,
          delta,
          deal_count: rb.deal_count,
          value_at_risk: rb.stall_value,
        } satisfies FunnelGapPayload,
      })
    }
  }

  return events
}
