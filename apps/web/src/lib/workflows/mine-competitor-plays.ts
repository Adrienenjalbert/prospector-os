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
 * mine-competitor-plays — nightly workflow that derives the language /
 * positioning that won deals against each named competitor.
 *
 * Inputs:
 *   - `tenants.business_config.competitors`  → the tenant's own
 *     competitor list (set on /admin/config). Without this list, the
 *     workflow has nothing to scope competitor mentions against.
 *   - `transcripts.themes` for closed-won + closed-lost deals →
 *     surfaces which competitor names were brought up in WON vs LOST
 *     conversations.
 *
 * Output: one `competitor_play` memory per (competitor, outcome=won)
 * pair, scoped by `competitor`. Each memory body summarises:
 *   - how often the competitor came up in won deals,
 *   - the recurring themes / framing language those won deals used.
 *
 * Lost-deal mentions also surface as part of the body so the rep
 * sees both sides ("when you DID win against X, themes were Y; when
 * you LOST to X, themes were Z"). Single memory per competitor keeps
 * the prompt tight.
 *
 * Cost: zero AI. Pure SQL + counting.
 */

const MIN_OCCURRENCES_PER_COMPETITOR = 2

interface OppForCompetitor {
  id: string
  company_id: string | null
  is_won: boolean | null
  closed_at: string | null
}

interface TranscriptForCompetitor {
  id: string
  company_id: string | null
  themes: string[] | null
}

export async function enqueueMineCompetitorPlays(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'mine_competitor_plays',
    idempotencyKey: `mc:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runMineCompetitorPlays(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_inputs',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')

        const { data: tenant } = await ctx.supabase
          .from('tenants')
          .select('business_config')
          .eq('id', ctx.tenantId)
          .maybeSingle()

        const businessConfig =
          (tenant?.business_config as Record<string, unknown> | null) ?? {}
        const competitorsRaw = businessConfig.competitors
        const competitors: string[] = Array.isArray(competitorsRaw)
          ? (competitorsRaw as unknown[])
              .filter((c): c is string => typeof c === 'string' && c.length > 0)
              .map((c) => c.toLowerCase().trim())
          : []

        if (competitors.length === 0) {
          return { skipped: true, reason: 'no_competitor_list_in_business_config' }
        }

        const since = new Date(
          Date.now() - 24 * 30 * 24 * 60 * 60 * 1000,
        ).toISOString()

        const { data: opps } = await ctx.supabase
          .from('opportunities')
          .select('id, company_id, is_won, closed_at')
          .eq('tenant_id', ctx.tenantId)
          .eq('is_closed', true)
          .gte('closed_at', since)
          .limit(3000)

        const closedOpps = (opps ?? []) as OppForCompetitor[]
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

        const { data: transcripts } = await ctx.supabase
          .from('transcripts')
          .select('id, company_id, themes')
          .eq('tenant_id', ctx.tenantId)
          .in('company_id', closedCompanyIds)
          .not('themes', 'is', null)
          .limit(5000)

        return {
          competitors,
          opps: closedOpps,
          transcripts: (transcripts ?? []) as TranscriptForCompetitor[],
        }
      },
    },

    {
      name: 'cluster_competitor_plays',
      run: async (ctx) => {
        const loaded = ctx.stepState.load_inputs as
          | {
              skipped?: boolean
              competitors?: string[]
              opps?: OppForCompetitor[]
              transcripts?: TranscriptForCompetitor[]
            }
          | undefined
        if (!loaded || loaded.skipped) return { skipped: true }

        const competitors = loaded.competitors ?? []
        const opps = loaded.opps ?? []
        const transcripts = loaded.transcripts ?? []

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

        // Per-competitor stats: theme frequencies and outcome counts,
        // plus sample transcript URNs for evidence.
        type CompetitorBucket = {
          competitor: string
          won_mentions: number
          lost_mentions: number
          won_themes: Record<string, number>
          lost_themes: Record<string, number>
          sample_won_urns: string[]
          sample_lost_urns: string[]
        }
        const buckets = new Map<string, CompetitorBucket>()
        for (const c of competitors) {
          buckets.set(c, {
            competitor: c,
            won_mentions: 0,
            lost_mentions: 0,
            won_themes: {},
            lost_themes: {},
            sample_won_urns: [],
            sample_lost_urns: [],
          })
        }

        for (const t of transcripts) {
          if (!t.company_id || !t.themes || t.themes.length === 0) continue
          const outcomes = companyOutcomes.get(t.company_id)
          if (!outcomes) continue

          const lowercaseThemes = t.themes
            .filter((th): th is string => typeof th === 'string')
            .map((th) => th.toLowerCase().trim())

          for (const competitor of competitors) {
            const matchedTheme = lowercaseThemes.find((th) =>
              th.includes(competitor),
            )
            if (!matchedTheme) continue
            const bucket = buckets.get(competitor)
            if (!bucket) continue

            const transcriptUrn = urn.transcript(ctx.tenantId!, t.id)
            if (outcomes.has('won')) {
              bucket.won_mentions += 1
              if (bucket.sample_won_urns.length < 4) {
                bucket.sample_won_urns.push(transcriptUrn)
              }
              for (const th of lowercaseThemes) {
                if (th.includes(competitor)) continue
                bucket.won_themes[th] = (bucket.won_themes[th] ?? 0) + 1
              }
            }
            if (outcomes.has('lost')) {
              bucket.lost_mentions += 1
              if (bucket.sample_lost_urns.length < 4) {
                bucket.sample_lost_urns.push(transcriptUrn)
              }
              for (const th of lowercaseThemes) {
                if (th.includes(competitor)) continue
                bucket.lost_themes[th] = (bucket.lost_themes[th] ?? 0) + 1
              }
            }
          }
        }

        const ready = Array.from(buckets.values()).filter(
          (b) => b.won_mentions + b.lost_mentions >= MIN_OCCURRENCES_PER_COMPETITOR,
        )

        if (ready.length === 0) {
          return { skipped: true, reason: 'no_competitor_signal' }
        }

        return { competitors_with_data: ready }
      },
    },

    {
      name: 'write_competitor_memories',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const clustered = ctx.stepState.cluster_competitor_plays as
          | {
              skipped?: boolean
              competitors_with_data?: Array<{
                competitor: string
                won_mentions: number
                lost_mentions: number
                won_themes: Record<string, number>
                lost_themes: Record<string, number>
                sample_won_urns: string[]
                sample_lost_urns: string[]
              }>
            }
          | undefined
        if (!clustered || clustered.skipped || !clustered.competitors_with_data) {
          return { skipped: true }
        }

        const writes: string[] = []
        for (const b of clustered.competitors_with_data) {
          const winRate =
            b.won_mentions + b.lost_mentions > 0
              ? b.won_mentions / (b.won_mentions + b.lost_mentions)
              : 0

          const topWonThemes = topN(b.won_themes, 4)
          const topLostThemes = topN(b.lost_themes, 4)

          const winThemesFragment =
            topWonThemes.length > 0
              ? `Themes that worked when you WON: ${topWonThemes.map((t) => `"${t.theme}"`).join(', ')}.`
              : 'No transcript-side win patterns mined yet.'
          const lossThemesFragment =
            topLostThemes.length > 0
              ? ` Themes that came up when you LOST: ${topLostThemes.map((t) => `"${t.theme}"`).join(', ')}.`
              : ''

          const winRateFragment =
            b.won_mentions + b.lost_mentions >= 3
              ? ` Head-to-head win rate vs this competitor: ${(winRate * 100).toFixed(0)}% (${b.won_mentions}W/${b.lost_mentions}L).`
              : ''

          const confidence = Math.min(
            0.95,
            0.3 +
              Math.min(
                0.65,
                Math.log10(Math.max(b.won_mentions + b.lost_mentions, 3)) * 0.45,
              ),
          )

          const r = await proposeMemory(ctx.supabase, {
            tenant_id: ctx.tenantId,
            kind: 'competitor_play',
            scope: { competitor: b.competitor },
            title: `Playbook vs ${capitalise(b.competitor)}`,
            body: `${winThemesFragment}${lossThemesFragment}${winRateFragment} When the prospect mentions ${capitalise(b.competitor)} on a call, lead with the WON-side themes; pre-empt the LOST-side themes before they harden.`,
            evidence: {
              urns: [...b.sample_won_urns, ...b.sample_lost_urns],
              counts: { won_mentions: b.won_mentions, lost_mentions: b.lost_mentions },
              samples: [
                ...topWonThemes.map((t) => `won:${t.theme}`),
                ...topLostThemes.map((t) => `lost:${t.theme}`),
              ].slice(0, 8),
            },
            confidence,
            source_workflow: 'mine_competitor_plays',
          })
          writes.push(r.memory_id)
        }

        return { memories_written: writes.length, memory_ids: writes }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

function topN(counts: Record<string, number>, n: number): Array<{ theme: string; count: number }> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([theme, count]) => ({ theme, count }))
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}
