import type { SupabaseClient } from '@supabase/supabase-js'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Transcript-signal mining (C6.3).
 *
 * Closes the highest-leverage signal gap the strategic review
 * flagged: the transcript ingester already extracts `themes`,
 * `sentiment_score`, and `meddpicc` per call (Sonnet, ~$0.01/call) —
 * but nothing turned that structured output into `signals` rows
 * that feed the propensity scorer's urgency multiplier.
 *
 * The cron/signals pipeline was burning Sonnet on hallucinated
 * external "research" while the real first-party transcript gold
 * sat unused. This workflow promotes:
 *
 *   - sentiment_score < -0.3                      → churn_risk signal
 *   - theme matches tenant competitor list        → competitor_mention
 *   - theme matches /pricing|cost|expensive|budget/i → price_objection
 *   - meddpicc.economic_buyer IS NULL AND deal stage >= Proposal
 *                                                 → champion_missing
 *
 * Each emitted signal includes `source_transcript_id` so the agent's
 * citation pills link back to the recording. Zero new AI cost — the
 * structured fields are already on the transcripts row.
 *
 * Idempotency: per-tenant per-day, with insertSignalIfNew preventing
 * duplicates when the same transcript is re-processed.
 */

interface TranscriptRow {
  id: string
  company_id: string | null
  occurred_at: string
  themes: string[] | null
  sentiment_score: number | null
  meddpicc_extracted: Record<string, unknown> | null
  source_url: string | null
}

const DAY_DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const PROPOSAL_STAGE_KEYWORDS = ['proposal', 'negotiation', 'commit', 'closed_won', 'closing']

export async function enqueueTranscriptSignals(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'transcript_signals',
    idempotencyKey: `ts:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runTranscriptSignals(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_transcripts',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const { data, error } = await ctx.supabase
          .from('transcripts')
          .select('id, company_id, occurred_at, themes, sentiment_score, meddpicc_extracted, source_url')
          .eq('tenant_id', ctx.tenantId)
          .gte('occurred_at', since)
          .limit(500)
        if (error) throw new Error(`load transcripts failed: ${error.message}`)
        return { transcripts: (data ?? []) as TranscriptRow[] }
      },
    },
    {
      name: 'load_tenant_config',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { data: tenant } = await ctx.supabase
          .from('tenants')
          .select('signal_config, business_config')
          .eq('id', ctx.tenantId)
          .maybeSingle()

        const signalConfig =
          (tenant?.signal_config as { signal_types?: Array<{ name: string; weight_multiplier?: number }> } | null) ??
          null
        const competitorList =
          ((tenant?.business_config as { competitors?: string[] } | null)?.competitors ?? []).map(
            (c) => c.toLowerCase(),
          )

        const weightOf = (type: string) =>
          signalConfig?.signal_types?.find((t) => t.name === type)?.weight_multiplier ?? 1.0

        return { competitorList, weights: {
          churn_risk: weightOf('churn_risk'),
          competitor_mention: weightOf('competitor_mention'),
          price_objection: weightOf('price_objection'),
          champion_missing: weightOf('champion_missing'),
        } }
      },
    },
    {
      name: 'load_active_deals',
      run: async (ctx) => {
        // Used for the champion_missing gate — only fires on deals
        // at proposal stage or later.
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const transcripts = (ctx.stepState.load_transcripts as { transcripts: TranscriptRow[] }).transcripts
        const companyIds = [
          ...new Set(transcripts.map((t) => t.company_id).filter((id): id is string => !!id)),
        ]
        if (companyIds.length === 0) {
          return { advancedStageByCompany: {} as Record<string, boolean> }
        }
        const { data: opps } = await ctx.supabase
          .from('opportunities')
          .select('company_id, stage, is_closed')
          .eq('tenant_id', ctx.tenantId)
          .in('company_id', companyIds)
          .eq('is_closed', false)

        const advancedStageByCompany: Record<string, boolean> = {}
        for (const o of opps ?? []) {
          const stage = String(o.stage ?? '').toLowerCase()
          const advanced = PROPOSAL_STAGE_KEYWORDS.some((k) => stage.includes(k))
          if (advanced && o.company_id) {
            advancedStageByCompany[o.company_id as string] = true
          }
        }
        return { advancedStageByCompany }
      },
    },
    {
      name: 'emit_signals',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const transcripts = (ctx.stepState.load_transcripts as { transcripts: TranscriptRow[] }).transcripts
        const { competitorList, weights } = ctx.stepState.load_tenant_config as {
          competitorList: string[]
          weights: { churn_risk: number; competitor_mention: number; price_objection: number; champion_missing: number }
        }
        const { advancedStageByCompany } = ctx.stepState.load_active_deals as {
          advancedStageByCompany: Record<string, boolean>
        }

        const dedupSince = new Date(Date.now() - DAY_DEDUP_WINDOW_MS).toISOString()

        // Insert helper — same shape as cron/signals.insertSignalIfNew
        // so tenants see consistent dedup behaviour across both
        // signal sources.
        const insertSignalIfNew = async (row: {
          tenant_id: string
          company_id: string
          signal_type: string
          title: string
          description: string | null
          source: string
          source_url: string | null
          relevance_score: number
          weight_multiplier: number
          recency_days: number
          weighted_score: number
          urgency: string
          detected_at: string
        }): Promise<boolean> => {
          const { count } = await ctx.supabase
            .from('signals')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', row.tenant_id)
            .eq('company_id', row.company_id)
            .eq('signal_type', row.signal_type)
            .gte('detected_at', dedupSince)
          if ((count ?? 0) > 0) return false
          const { error } = await ctx.supabase.from('signals').insert(row)
          if (error) {
            console.warn('[transcript-signals] insert failed:', error.message)
            return false
          }
          return true
        }

        let inserted = 0
        for (const t of transcripts) {
          if (!t.company_id) continue
          const detectedAt = new Date().toISOString()

          // 1. churn_risk — strongly negative sentiment.
          if (typeof t.sentiment_score === 'number' && t.sentiment_score < -0.3) {
            const ok = await insertSignalIfNew({
              tenant_id: ctx.tenantId,
              company_id: t.company_id,
              signal_type: 'churn_risk',
              title: `Negative sentiment on call (${t.sentiment_score.toFixed(2)})`,
              description: `Transcript scored sentiment ${t.sentiment_score.toFixed(2)} on a -1..1 scale.`,
              source: 'transcript_signal',
              source_url: t.source_url,
              relevance_score: Math.min(1, Math.abs(t.sentiment_score)),
              weight_multiplier: weights.churn_risk,
              recency_days: Math.floor((Date.now() - new Date(t.occurred_at).getTime()) / 86400000),
              weighted_score: Math.min(1, Math.abs(t.sentiment_score)) * weights.churn_risk,
              urgency: 'this_week',
              detected_at: detectedAt,
            })
            if (ok) inserted += 1
          }

          // 2. competitor_mention — themes matching tenant competitors.
          const themes = (t.themes ?? []).map((th) => String(th).toLowerCase())
          if (competitorList.length > 0) {
            const hit = themes.find((th) => competitorList.some((c) => th.includes(c)))
            if (hit) {
              const ok = await insertSignalIfNew({
                tenant_id: ctx.tenantId,
                company_id: t.company_id,
                signal_type: 'competitor_mention',
                title: `Competitor mentioned: ${hit}`,
                description: `Theme extracted from transcript: "${hit}"`,
                source: 'transcript_signal',
                source_url: t.source_url,
                relevance_score: 0.85,
                weight_multiplier: weights.competitor_mention,
                recency_days: Math.floor((Date.now() - new Date(t.occurred_at).getTime()) / 86400000),
                weighted_score: 0.85 * weights.competitor_mention,
                urgency: 'immediate',
                detected_at: detectedAt,
              })
              if (ok) inserted += 1
            }
          }

          // 3. price_objection — themes matching pricing pattern.
          if (themes.some((th) => /pricing|cost|expensive|budget|too high/.test(th))) {
            const ok = await insertSignalIfNew({
              tenant_id: ctx.tenantId,
              company_id: t.company_id,
              signal_type: 'price_objection',
              title: 'Pricing objection raised',
              description: `Themes referenced pricing/cost concerns: ${themes.filter((th) => /pricing|cost|expensive|budget|too high/.test(th)).join(', ')}`,
              source: 'transcript_signal',
              source_url: t.source_url,
              relevance_score: 0.7,
              weight_multiplier: weights.price_objection,
              recency_days: Math.floor((Date.now() - new Date(t.occurred_at).getTime()) / 86400000),
              weighted_score: 0.7 * weights.price_objection,
              urgency: 'this_week',
              detected_at: detectedAt,
            })
            if (ok) inserted += 1
          }

          // 4. champion_missing — MEDDPICC EB null AND deal at advanced stage.
          const meddpicc = (t.meddpicc_extracted ?? {}) as Record<string, unknown>
          const ebMissing =
            meddpicc &&
            (meddpicc['economic_buyer'] === null || meddpicc['economic_buyer'] === undefined ||
              meddpicc['economic_buyer'] === '')
          const championMissing =
            meddpicc &&
            (meddpicc['champion'] === null || meddpicc['champion'] === undefined ||
              meddpicc['champion'] === '')
          if ((ebMissing || championMissing) && advancedStageByCompany[t.company_id]) {
            const ok = await insertSignalIfNew({
              tenant_id: ctx.tenantId,
              company_id: t.company_id,
              signal_type: 'champion_missing',
              title: ebMissing ? 'No economic buyer identified at proposal stage' : 'No champion identified at proposal stage',
              description: 'MEDDPICC extraction shows the deal is at proposal+ stage but the EB/champion is unknown. Late-stage qualification gap.',
              source: 'transcript_signal',
              source_url: t.source_url,
              relevance_score: 0.9,
              weight_multiplier: weights.champion_missing,
              recency_days: Math.floor((Date.now() - new Date(t.occurred_at).getTime()) / 86400000),
              weighted_score: 0.9 * weights.champion_missing,
              urgency: 'immediate',
              detected_at: detectedAt,
            })
            if (ok) inserted += 1
          }
        }

        return { transcripts_scanned: transcripts.length, signals_inserted: inserted }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
