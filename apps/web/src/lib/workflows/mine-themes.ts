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
 * mine-themes — nightly workflow that turns closed-deal transcripts
 * into typed `win_theme` and `loss_theme` memories.
 *
 * The transcript-ingester (transcripts/transcript-ingester.ts) already
 * extracts `themes`, `sentiment_score`, and `meddpicc_extracted` per
 * call. The transcript-signals workflow promotes a few of those into
 * `signals` rows. THIS workflow does the second job: bucket themes
 * across CLOSED deals, separate by outcome (won vs lost), and surface
 * the recurring theme strings as memories the agent can quote.
 *
 * Why frequency-based clustering, not embeddings:
 *   - Themes are short strings (< 60 chars) the ingester already
 *     normalised. K-means on 1536-dim embeddings is overkill.
 *   - Cost discipline: zero new AI calls. Just SQL + counting.
 *   - Phase 6 (consolidation) can later add semantic dedup on
 *     near-identical themes — but the v1 frequency-based pass already
 *     unlocks the highest-leverage prompt grounding.
 *
 * Per-industry scoping mirrors mine-personas: a "competitor X" win-theme
 * for logistics deals is irrelevant on a fintech deal.
 */

const MIN_OCCURRENCES_FOR_THEME = 3
const TOP_THEMES_PER_OUTCOME_PER_INDUSTRY = 5
const TOP_LOSS_REASONS_PER_INDUSTRY = 5

interface OppForTheme {
  id: string
  company_id: string | null
  is_won: boolean | null
  closed_at: string | null
  lost_reason: string | null
}

interface CompanyForTheme {
  id: string
  industry: string | null
}

interface TranscriptForTheme {
  id: string
  company_id: string | null
  themes: string[] | null
}

export async function enqueueMineThemes(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'mine_themes',
    idempotencyKey: `mt:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runMineThemes(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_closed_deals_and_transcripts',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(
          Date.now() - 24 * 30 * 24 * 60 * 60 * 1000,
        ).toISOString()

        const { data: opps } = await ctx.supabase
          .from('opportunities')
          .select('id, company_id, is_won, closed_at, lost_reason')
          .eq('tenant_id', ctx.tenantId)
          .eq('is_closed', true)
          .gte('closed_at', since)
          .limit(3000)

        const closedOpps = (opps ?? []) as OppForTheme[]
        const closedCompanyIds = [
          ...new Set(
            closedOpps
              .map((o) => o.company_id as string | null)
              .filter((id): id is string => !!id),
          ),
        ]

        if (closedCompanyIds.length === 0) {
          return { skipped: true, reason: 'no_closed_deals' }
        }

        const [companiesRes, transcriptsRes] = await Promise.all([
          ctx.supabase
            .from('companies')
            .select('id, industry')
            .eq('tenant_id', ctx.tenantId)
            .in('id', closedCompanyIds),
          ctx.supabase
            .from('transcripts')
            .select('id, company_id, themes')
            .eq('tenant_id', ctx.tenantId)
            .in('company_id', closedCompanyIds)
            .not('themes', 'is', null)
            .limit(5000),
        ])

        return {
          opps: closedOpps,
          companies: (companiesRes.data ?? []) as CompanyForTheme[],
          transcripts: (transcriptsRes.data ?? []) as TranscriptForTheme[],
        }
      },
    },

    {
      name: 'cluster_themes',
      run: async (ctx) => {
        const loaded = ctx.stepState.load_closed_deals_and_transcripts as
          | {
              skipped?: boolean
              opps?: OppForTheme[]
              companies?: CompanyForTheme[]
              transcripts?: TranscriptForTheme[]
            }
          | undefined
        if (!loaded || loaded.skipped) return { skipped: true }

        const opps = loaded.opps ?? []
        const companies = loaded.companies ?? []
        const transcripts = loaded.transcripts ?? []

        const companyIndustryById = new Map<string, string | null>(
          companies.map((c) => [c.id, c.industry]),
        )

        // Bucket A: theme frequencies per (industry, outcome).
        type ThemeBucket = {
          industry: string | null
          outcome: 'won' | 'lost'
          themes: Record<string, number>
          /** Sample transcript URNs whose themes contributed. */
          sample_urns: string[]
        }
        const themeBuckets = new Map<string, ThemeBucket>()

        // Build a company → outcome map: a company is "won" when ANY
        // closed opp linked to it is won. Lost-only companies bucket
        // into 'lost'. (Companies with both won and lost map to both
        // outcomes — themes appear in both buckets, which is fine.)
        const companyOutcomes = new Map<string, Set<'won' | 'lost'>>()
        for (const o of opps) {
          if (!o.company_id) continue
          let s = companyOutcomes.get(o.company_id)
          if (!s) {
            s = new Set()
            companyOutcomes.set(o.company_id, s)
          }
          s.add(o.is_won ? 'won' : 'lost')
        }

        for (const t of transcripts) {
          if (!t.company_id || !t.themes || t.themes.length === 0) continue
          const outcomes = companyOutcomes.get(t.company_id)
          if (!outcomes) continue
          const industry = companyIndustryById.get(t.company_id) ?? null

          for (const outcome of outcomes) {
            const key = `${industry ?? '__tenant_wide__'}::${outcome}`
            let bucket = themeBuckets.get(key)
            if (!bucket) {
              bucket = { industry, outcome, themes: {}, sample_urns: [] }
              themeBuckets.set(key, bucket)
            }
            for (const rawTheme of t.themes) {
              const theme = String(rawTheme).trim().toLowerCase()
              if (!theme || theme.length > 80) continue
              bucket.themes[theme] = (bucket.themes[theme] ?? 0) + 1
            }
            if (bucket.sample_urns.length < 6) {
              bucket.sample_urns.push(urn.transcript(ctx.tenantId!, t.id))
            }
          }
        }

        // Bucket B: lost_reason frequencies per industry. CRM-side
        // lost_reason is the rep's own categorisation — strong signal
        // even when transcripts are absent.
        type LossReasonBucket = {
          industry: string | null
          reasons: Record<string, number>
          sample_urns: string[]
        }
        const lossReasonBuckets = new Map<string, LossReasonBucket>()
        for (const o of opps) {
          if (o.is_won || !o.lost_reason || !o.company_id) continue
          const industry = companyIndustryById.get(o.company_id) ?? null
          const key = industry ?? '__tenant_wide__'
          let bucket = lossReasonBuckets.get(key)
          if (!bucket) {
            bucket = { industry, reasons: {}, sample_urns: [] }
            lossReasonBuckets.set(key, bucket)
          }
          const reason = String(o.lost_reason).trim().toLowerCase()
          if (!reason || reason.length > 100) continue
          bucket.reasons[reason] = (bucket.reasons[reason] ?? 0) + 1
          if (bucket.sample_urns.length < 6) {
            bucket.sample_urns.push(urn.opportunity(ctx.tenantId!, o.id))
          }
        }

        return {
          themeBuckets: Array.from(themeBuckets.values()),
          lossReasonBuckets: Array.from(lossReasonBuckets.values()),
        }
      },
    },

    {
      name: 'write_theme_memories',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const clustered = ctx.stepState.cluster_themes as
          | {
              skipped?: boolean
              themeBuckets?: Array<{
                industry: string | null
                outcome: 'won' | 'lost'
                themes: Record<string, number>
                sample_urns: string[]
              }>
              lossReasonBuckets?: Array<{
                industry: string | null
                reasons: Record<string, number>
                sample_urns: string[]
              }>
            }
          | undefined
        if (!clustered || clustered.skipped) return { skipped: true }

        const writes: string[] = []

        // 1. Win/loss themes from transcript theme frequencies.
        for (const bucket of clustered.themeBuckets ?? []) {
          const sortedThemes = Object.entries(bucket.themes)
            .filter(([, c]) => c >= MIN_OCCURRENCES_FOR_THEME)
            .sort((a, b) => b[1] - a[1])
            .slice(0, TOP_THEMES_PER_OUTCOME_PER_INDUSTRY)

          if (sortedThemes.length === 0) continue

          const industryFragment = bucket.industry ? ` in ${bucket.industry}` : ''
          const kind = bucket.outcome === 'won' ? 'win_theme' : 'loss_theme'
          const labelOutcome = bucket.outcome === 'won' ? 'wins' : 'losses'

          const totalOccurrences = sortedThemes.reduce((sum, [, c]) => sum + c, 0)
          const confidence = Math.min(
            0.95,
            0.3 + Math.min(0.65, Math.log10(Math.max(totalOccurrences, 3)) * 0.45),
          )

          const themesList = sortedThemes
            .map(([theme, count]) => `"${theme}" (${count} mentions)`)
            .join(', ')

          const r = await proposeMemory(ctx.supabase, {
            tenant_id: ctx.tenantId,
            kind,
            scope: bucket.industry ? { industry: bucket.industry } : {},
            title: `Recurring themes in ${labelOutcome}${industryFragment}`,
            body:
              bucket.outcome === 'won'
                ? `In recent ${labelOutcome}${industryFragment}, transcripts repeatedly surface: ${themesList}. Lead with these themes early in the conversation — they correlate with the wins.`
                : `In recent ${labelOutcome}${industryFragment}, transcripts repeatedly surface: ${themesList}. Watch for these as early warnings; address explicitly before they harden into the deal-killer.`,
            evidence: {
              urns: bucket.sample_urns,
              counts: { theme_mentions: totalOccurrences },
              samples: sortedThemes.slice(0, 5).map(([t]) => t),
            },
            confidence,
            source_workflow: 'mine_themes',
          })
          writes.push(r.memory_id)
        }

        // 2. Loss themes from CRM-side lost_reason. Often more
        // structured than transcript themes (CRMs frequently constrain
        // lost_reason to a dropdown), and a strong predictor for the
        // churn-escalation workflow's re-engagement playbook.
        for (const bucket of clustered.lossReasonBuckets ?? []) {
          const sorted = Object.entries(bucket.reasons)
            .filter(([, c]) => c >= MIN_OCCURRENCES_FOR_THEME)
            .sort((a, b) => b[1] - a[1])
            .slice(0, TOP_LOSS_REASONS_PER_INDUSTRY)

          if (sorted.length === 0) continue

          const industryFragment = bucket.industry ? ` in ${bucket.industry}` : ''
          const total = sorted.reduce((sum, [, c]) => sum + c, 0)
          const confidence = Math.min(
            0.95,
            0.3 + Math.min(0.65, Math.log10(Math.max(total, 3)) * 0.45),
          )

          const reasonsList = sorted
            .map(([r, c]) => `"${r}" (${c})`)
            .join(', ')

          const r = await proposeMemory(ctx.supabase, {
            tenant_id: ctx.tenantId,
            kind: 'loss_theme',
            scope: bucket.industry
              ? { industry: bucket.industry, segment: 'crm_lost_reason' }
              : { segment: 'crm_lost_reason' },
            title: `Top documented loss reasons${industryFragment}`,
            body: `Reps logged the following CRM-side lost reasons${industryFragment}: ${reasonsList}. Treat each as a known objection vector — surface mitigations proactively rather than waiting for the prospect to raise them.`,
            evidence: {
              urns: bucket.sample_urns,
              counts: { lost_deals: total },
              samples: sorted.slice(0, 5).map(([r]) => r),
            },
            confidence,
            source_workflow: 'mine_themes',
          })
          writes.push(r.memory_id)
        }

        return { memories_written: writes.length, memory_ids: writes }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
