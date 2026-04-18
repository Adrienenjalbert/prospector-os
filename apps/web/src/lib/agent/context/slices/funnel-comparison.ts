import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import { citeBenchmark } from './_helpers'

/**
 * `funnel-comparison` — rep's stage-by-stage conversion vs the company
 * benchmark, sorted so the worst-performing stage is first.
 *
 * Drives diagnosis ("where am I losing deals") and forecast ("which stage
 * is bleeding"). Loaded for AE/leader on diagnosis/forecast/portfolio_health.
 *
 * Mirrors today's `assembleAgentContext.funnel_comparison` but with
 * benchmark-row citations included so the agent's claims like "I drop 15pp
 * more than company at Negotiation" are traceable.
 */

interface FunnelStageRow {
  stage: string
  rep_drop_rate: number
  company_drop_rate: number
  delta_drop: number
  rep_conv_rate: number
  company_conv_rate: number
  delta_conv: number
  rep_deals: number
  rep_avg_days: number
  rep_stalls: number
  status: 'CRITICAL' | 'MONITOR' | 'OPPORTUNITY' | 'HEALTHY' | 'UNKNOWN'
}

export const funnelComparisonSlice: ContextSlice<FunnelStageRow> = {
  slug: 'funnel-comparison',
  title: 'Funnel comparison',
  category: 'pipeline',

  triggers: {
    intents: ['diagnosis', 'forecast', 'portfolio_health'],
    roles: ['ae', 'nae', 'growth_ae', 'leader', 'ad'],
  },

  staleness: {
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/score'],
  },

  token_budget: 400,
  soft_timeout_ms: 1500,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<FunnelStageRow>> {
    const startedAt = Date.now()

    const [repRes, companyRes] = await Promise.all([
      ctx.supabase
        .from('funnel_benchmarks')
        .select(
          'stage_name, drop_rate, conversion_rate, deal_count, avg_days_in_stage, stall_count, impact_score',
        )
        .eq('tenant_id', ctx.tenantId)
        .eq('scope', 'rep')
        .eq('scope_id', ctx.repId),
      ctx.supabase
        .from('funnel_benchmarks')
        .select('stage_name, drop_rate, conversion_rate')
        .eq('tenant_id', ctx.tenantId)
        .eq('scope', 'company')
        .eq('scope_id', 'all'),
    ])

    if (repRes.error) {
      throw new Error(`funnel-comparison rep query failed: ${repRes.error.message}`)
    }
    if (companyRes.error) {
      throw new Error(`funnel-comparison company query failed: ${companyRes.error.message}`)
    }

    const benchByStage = new Map<string, { drop_rate: number; conversion_rate: number }>(
      (companyRes.data ?? []).map((b) => [b.stage_name, b]),
    )

    const rows: FunnelStageRow[] = (repRes.data ?? []).map((rb) => {
      const cb = benchByStage.get(rb.stage_name)
      const cbDrop = cb?.drop_rate ?? 0
      const cbConv = cb?.conversion_rate ?? 0
      const deltaDrop = (rb.drop_rate ?? 0) - cbDrop
      const deltaConv = (rb.conversion_rate ?? 0) - cbConv
      const isHighDrop = deltaDrop >= 5
      const isHighVolume = (rb.deal_count ?? 0) >= 1
      const status: FunnelStageRow['status'] = !cb
        ? 'UNKNOWN'
        : isHighDrop && isHighVolume
        ? 'CRITICAL'
        : isHighDrop
        ? 'MONITOR'
        : isHighVolume
        ? 'OPPORTUNITY'
        : 'HEALTHY'

      return {
        stage: rb.stage_name,
        rep_drop_rate: rb.drop_rate ?? 0,
        company_drop_rate: cbDrop,
        delta_drop: Math.round(deltaDrop * 10) / 10,
        rep_conv_rate: rb.conversion_rate ?? 0,
        company_conv_rate: cbConv,
        delta_conv: Math.round(deltaConv * 10) / 10,
        rep_deals: rb.deal_count ?? 0,
        rep_avg_days: rb.avg_days_in_stage ?? 0,
        rep_stalls: rb.stall_count ?? 0,
        status,
      }
    })

    rows.sort((a, b) => Math.abs(b.delta_drop) - Math.abs(a.delta_drop))

    return {
      rows,
      citations: rows.map((r) => citeBenchmark(r.stage)),
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
      warnings: rows.length === 0
        ? ['No funnel benchmarks computed yet — needs a cron/score run.']
        : undefined,
    }
  },

  formatForPrompt(rows: FunnelStageRow[]): string {
    if (rows.length === 0) {
      return '### Funnel comparison\n_No benchmarks computed yet (run cron/score)._'
    }
    const lines = rows.slice(0, 6).map((r) => {
      const dropPart = r.delta_drop === 0
        ? 'on benchmark'
        : `${r.delta_drop > 0 ? '+' : ''}${r.delta_drop.toFixed(1)}pp drop vs co`
      return `- ${r.stage} [${r.status}] — ${dropPart}, ${r.rep_deals} deals, ${r.rep_avg_days}d avg, ${r.rep_stalls} stalls`
    })
    return `### Funnel comparison (rep vs company)\n${lines.join('\n')}`
  },

  citeRow(row) {
    return {
      claim_text: `Benchmark: ${row.stage}`,
      source_type: 'funnel_benchmark',
      source_id: row.stage,
    }
  },
}
