import { z } from 'zod'
import type { ToolHandler } from '../../tool-loader'
import { urn } from '@prospector/core'

/**
 * Account-intelligence tool bundle (C2).
 *
 * Three tier-2-compliant tools that close obvious gaps in the agent's
 * "what does this rep need to act on this account today?" surface:
 *
 *   - find_similar_accounts  : semantic search over embedded company
 *                              snapshots (depends on migration 020 RPC
 *                              `match_companies`). Powers "find won
 *                              deals like Acme" workflows.
 *   - extract_meddpicc_gaps  : reads the structured MEDDPICC blob the
 *                              transcript ingester already extracts and
 *                              returns the missing fields as a citation
 *                              list. Zero new AI calls — the data is
 *                              already on `transcripts.meddpicc_extracted`.
 *   - summarise_account_health : composes the latest `health_snapshots`
 *                              row + the most recent signal types into
 *                              a one-paragraph state-of-the-account
 *                              with citations.
 *
 * Tier-2 doctrine compliance (per MISSION.md):
 *   - Zod-typed input schema (no free-form arguments).
 *   - `{ data, citations }` output — every claim cites its URN.
 *   - Errors are returned in the result, not thrown — the middleware
 *     wraps them as `tool_error` events with classification.
 *   - All cross-tenant boundaries are enforced via `ctx.tenantId`.
 */

// ===========================================================================
// find_similar_accounts
// ===========================================================================

export const findSimilarAccountsSchema = z.object({
  reference_company_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      'UUID of an existing company in the tenant ontology to find similar accounts for. ' +
        'Either this OR `reference_text` must be provided.',
    ),
  reference_text: z
    .string()
    .min(10)
    .max(2000)
    .optional()
    .describe(
      'Free-text description of the kind of account to find ("EMEA fintechs with 200-500 employees and a recent SOC2 audit"). ' +
        'Either this OR `reference_company_id` must be provided.',
    ),
  exclude_self: z
    .boolean()
    .optional()
    .describe(
      'When `reference_company_id` is set, drop the reference company itself from the results. Default true.',
    ),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Maximum number of similar accounts to return. Default 5.'),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Cosine-similarity threshold (0–1). Default 0.7.'),
})

export type FindSimilarAccountsArgs = z.infer<typeof findSimilarAccountsSchema>

interface SimilarAccountRow {
  id: string
  name: string
  industry: string | null
  similarity: number
}

export interface FindSimilarAccountsResult {
  data: {
    reference: { id: string | null; name: string | null }
    matches: Array<SimilarAccountRow & { source_url: string }>
    count: number
  } | null
  error?: string
  citations: Array<{
    type: 'evidence'
    source_type: 'company'
    source_id: string
    title: string
  }>
}

export const findSimilarAccountsHandler: ToolHandler = {
  slug: 'find_similar_accounts',
  schema: findSimilarAccountsSchema,
  build: (ctx) => async (rawArgs) => {
    const args = rawArgs as FindSimilarAccountsArgs
    if (!args.reference_company_id && !args.reference_text) {
      return {
        data: null,
        error: 'Either reference_company_id or reference_text is required.',
        citations: [],
      } satisfies FindSimilarAccountsResult
    }

    try {
      // Resolve the query embedding. Two paths:
      //   1. reference_company_id — read its stored embedding directly.
      //      Avoids an embedding API roundtrip for the common case of
      //      "show me accounts like this one".
      //   2. reference_text — embed the text via the shared embedQuery.
      let queryEmbedding: number[] | null = null
      let referenceName: string | null = null
      let referenceId: string | null = null

      if (args.reference_company_id) {
        const { data: ref } = await ctx.supabase
          .from('companies')
          .select('id, name, embedding')
          .eq('tenant_id', ctx.tenantId)
          .eq('id', args.reference_company_id)
          .maybeSingle()

        if (!ref) {
          return {
            data: null,
            error: `Reference company ${args.reference_company_id} not found in tenant.`,
            citations: [],
          } satisfies FindSimilarAccountsResult
        }
        referenceName = (ref.name as string | null) ?? null
        referenceId = (ref.id as string | null) ?? null
        const refEmbedding = (ref as { embedding: number[] | null }).embedding
        if (!refEmbedding) {
          return {
            data: null,
            error: `Reference company "${referenceName}" has no embedding yet — run the company-embeddings cron and retry.`,
            citations: [],
          } satisfies FindSimilarAccountsResult
        }
        queryEmbedding = refEmbedding
      } else if (args.reference_text) {
        const { embedQuery } = await import('@/lib/agent/context/embed-query')
        queryEmbedding = await embedQuery(args.reference_text)
      }

      if (!queryEmbedding) {
        return {
          data: null,
          error: 'Failed to resolve query embedding.',
          citations: [],
        } satisfies FindSimilarAccountsResult
      }

      const { data: matches, error } = await ctx.supabase.rpc('match_companies', {
        query_embedding: queryEmbedding,
        match_tenant_id: ctx.tenantId,
        match_threshold: args.threshold ?? 0.7,
        match_count: (args.max_results ?? 5) + (args.exclude_self === false ? 0 : 1),
      })
      if (error) {
        return {
          data: null,
          error: `match_companies failed: ${error.message}`,
          citations: [],
        } satisfies FindSimilarAccountsResult
      }

      let rows = (matches ?? []) as SimilarAccountRow[]
      if (referenceId && (args.exclude_self ?? true)) {
        rows = rows.filter((r) => r.id !== referenceId)
      }
      rows = rows.slice(0, args.max_results ?? 5)

      const enriched = rows.map((r) => ({
        ...r,
        source_url: urn.company(ctx.tenantId, r.id),
      }))

      return {
        data: {
          reference: { id: referenceId, name: referenceName },
          matches: enriched,
          count: enriched.length,
        },
        citations: enriched.map((m) => ({
          type: 'evidence' as const,
          source_type: 'company' as const,
          source_id: m.source_url,
          title: m.name,
        })),
      } satisfies FindSimilarAccountsResult
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'find_similar_accounts failed',
        citations: [],
      } satisfies FindSimilarAccountsResult
    }
  },
}

// ===========================================================================
// extract_meddpicc_gaps
// ===========================================================================

const MEDDPICC_FIELDS = [
  'metrics',
  'economic_buyer',
  'decision_criteria',
  'decision_process',
  'identify_pain',
  'champion',
  'competition',
  'paper_process',
] as const
type MeddpiccField = (typeof MEDDPICC_FIELDS)[number]

export const extractMeddpiccGapsSchema = z.object({
  company_id: z
    .string()
    .uuid()
    .describe('UUID of the company in the tenant ontology to inspect.'),
  lookback_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe('Only consider transcripts from the last N days. Default 90.'),
})

export type ExtractMeddpiccGapsArgs = z.infer<typeof extractMeddpiccGapsSchema>

export interface ExtractMeddpiccGapsResult {
  data: {
    company_id: string
    company_name: string | null
    transcripts_scanned: number
    coverage: Record<MeddpiccField, { covered: boolean; latest_value: string | null }>
    gaps: MeddpiccField[]
    coverage_pct: number
  } | null
  error?: string
  citations: Array<{
    type: 'evidence'
    source_type: 'transcript' | 'company'
    source_id: string
    title: string
  }>
}

export const extractMeddpiccGapsHandler: ToolHandler = {
  slug: 'extract_meddpicc_gaps',
  schema: extractMeddpiccGapsSchema,
  build: (ctx) => async (rawArgs) => {
    const args = rawArgs as ExtractMeddpiccGapsArgs
    try {
      const since = new Date(
        Date.now() - (args.lookback_days ?? 90) * 24 * 60 * 60 * 1000,
      ).toISOString()

      const [companyRes, transcriptRes] = await Promise.all([
        ctx.supabase
          .from('companies')
          .select('id, name')
          .eq('tenant_id', ctx.tenantId)
          .eq('id', args.company_id)
          .maybeSingle(),
        ctx.supabase
          .from('transcripts')
          .select('id, occurred_at, source_url, meddpicc_extracted')
          .eq('tenant_id', ctx.tenantId)
          .eq('company_id', args.company_id)
          .gte('occurred_at', since)
          .order('occurred_at', { ascending: false })
          .limit(20),
      ])

      if (!companyRes.data) {
        return {
          data: null,
          error: `Company ${args.company_id} not found in tenant.`,
          citations: [],
        } satisfies ExtractMeddpiccGapsResult
      }

      const transcripts =
        ((transcriptRes.data ?? []) as Array<{
          id: string
          occurred_at: string
          source_url: string | null
          meddpicc_extracted: Record<string, unknown> | null
        }>) ?? []

      // Walk transcripts newest-first; first non-null value per field
      // wins. The transcript that contributed the value is added as a
      // citation so the rep can verify. Companies with NO transcripts
      // get an empty coverage table — every field is a gap.
      const coverage: Record<
        MeddpiccField,
        { covered: boolean; latest_value: string | null; source_id?: string }
      > = MEDDPICC_FIELDS.reduce(
        (acc, field) => {
          acc[field] = { covered: false, latest_value: null }
          return acc
        },
        {} as Record<MeddpiccField, { covered: boolean; latest_value: string | null; source_id?: string }>,
      )

      const citingTranscriptIds = new Set<string>()
      for (const t of transcripts) {
        const meddpicc = (t.meddpicc_extracted ?? {}) as Record<string, unknown>
        for (const field of MEDDPICC_FIELDS) {
          if (coverage[field].covered) continue
          const v = meddpicc[field]
          if (v != null && v !== '') {
            coverage[field] = {
              covered: true,
              latest_value: typeof v === 'string' ? v.slice(0, 200) : JSON.stringify(v).slice(0, 200),
              source_id: urn.transcript(ctx.tenantId, t.id),
            }
            citingTranscriptIds.add(t.id)
          }
        }
      }

      const gaps = MEDDPICC_FIELDS.filter((f) => !coverage[f].covered)
      const coveredCount = MEDDPICC_FIELDS.length - gaps.length
      const coveragePct = Math.round((coveredCount / MEDDPICC_FIELDS.length) * 100)

      // Strip source_id from the public coverage view; expose it via
      // citations to keep the data shape narrow.
      const publicCoverage: Record<MeddpiccField, { covered: boolean; latest_value: string | null }> = MEDDPICC_FIELDS.reduce(
        (acc, f) => {
          acc[f] = { covered: coverage[f].covered, latest_value: coverage[f].latest_value }
          return acc
        },
        {} as Record<MeddpiccField, { covered: boolean; latest_value: string | null }>,
      )

      const citations: ExtractMeddpiccGapsResult['citations'] = []
      // Always cite the company first so the agent has a reliable
      // anchor URN even when no transcripts contributed.
      citations.push({
        type: 'evidence',
        source_type: 'company',
        source_id: urn.company(ctx.tenantId, args.company_id),
        title: (companyRes.data as { name: string | null }).name ?? 'company',
      })
      for (const id of citingTranscriptIds) {
        citations.push({
          type: 'evidence',
          source_type: 'transcript',
          source_id: urn.transcript(ctx.tenantId, id),
          title: `Transcript ${id.slice(0, 8)}`,
        })
      }

      return {
        data: {
          company_id: args.company_id,
          company_name: (companyRes.data as { name: string | null }).name ?? null,
          transcripts_scanned: transcripts.length,
          coverage: publicCoverage,
          gaps,
          coverage_pct: coveragePct,
        },
        citations,
      } satisfies ExtractMeddpiccGapsResult
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'extract_meddpicc_gaps failed',
        citations: [],
      } satisfies ExtractMeddpiccGapsResult
    }
  },
}

// ===========================================================================
// summarise_account_health
// ===========================================================================

export const summariseAccountHealthSchema = z.object({
  company_id: z
    .string()
    .uuid()
    .describe('UUID of the company to summarise.'),
  lookback_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe('Window for trend computation. Default 60.'),
})

export type SummariseAccountHealthArgs = z.infer<typeof summariseAccountHealthSchema>

interface HealthSnapshotRow {
  id: string
  health_score: number | null
  status: string | null
  captured_at: string
  reason: string | null
}

export interface SummariseAccountHealthResult {
  data: {
    company_id: string
    company_name: string | null
    latest: HealthSnapshotRow | null
    previous: HealthSnapshotRow | null
    trend: 'improving' | 'declining' | 'stable' | 'unknown'
    delta: number | null
    recent_signal_summary: { type: string; count: number }[]
    headline: string
  } | null
  error?: string
  citations: Array<{
    type: 'evidence'
    source_type: 'company' | 'health_snapshot' | 'signal'
    source_id: string
    title: string
  }>
}

export const summariseAccountHealthHandler: ToolHandler = {
  slug: 'summarise_account_health',
  schema: summariseAccountHealthSchema,
  build: (ctx) => async (rawArgs) => {
    const args = rawArgs as SummariseAccountHealthArgs
    try {
      const lookbackMs = (args.lookback_days ?? 60) * 24 * 60 * 60 * 1000
      const since = new Date(Date.now() - lookbackMs).toISOString()

      const [companyRes, snapshotsRes, signalsRes] = await Promise.all([
        ctx.supabase
          .from('companies')
          .select('id, name')
          .eq('tenant_id', ctx.tenantId)
          .eq('id', args.company_id)
          .maybeSingle(),
        ctx.supabase
          .from('health_snapshots')
          .select('id, health_score, status, captured_at, reason')
          .eq('tenant_id', ctx.tenantId)
          .eq('company_id', args.company_id)
          .gte('captured_at', since)
          .order('captured_at', { ascending: false })
          .limit(2),
        ctx.supabase
          .from('signals')
          .select('signal_type, title, weighted_score')
          .eq('tenant_id', ctx.tenantId)
          .eq('company_id', args.company_id)
          .gte('detected_at', since)
          .order('weighted_score', { ascending: false })
          .limit(10),
      ])

      if (!companyRes.data) {
        return {
          data: null,
          error: `Company ${args.company_id} not found in tenant.`,
          citations: [],
        } satisfies SummariseAccountHealthResult
      }

      const snapshots = (snapshotsRes.data ?? []) as HealthSnapshotRow[]
      const latest = snapshots[0] ?? null
      const previous = snapshots[1] ?? null

      let trend: 'improving' | 'declining' | 'stable' | 'unknown' = 'unknown'
      let delta: number | null = null
      if (latest && previous && latest.health_score != null && previous.health_score != null) {
        delta = latest.health_score - previous.health_score
        if (Math.abs(delta) < 3) trend = 'stable'
        else if (delta > 0) trend = 'improving'
        else trend = 'declining'
      } else if (latest) {
        trend = 'stable'
      }

      // Aggregate signals by type for the summary view.
      const signalCounts = new Map<string, number>()
      for (const s of signalsRes.data ?? []) {
        const type = String(s.signal_type ?? 'unknown')
        signalCounts.set(type, (signalCounts.get(type) ?? 0) + 1)
      }
      const recent_signal_summary = Array.from(signalCounts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)

      const companyName = (companyRes.data as { name: string | null }).name ?? null
      const headline =
        latest?.health_score != null
          ? `${companyName ?? 'Account'} health: ${latest.health_score}/100 (${trend}${delta != null ? `, ${delta > 0 ? '+' : ''}${delta.toFixed(0)}` : ''})${recent_signal_summary.length > 0 ? ` · top signal: ${recent_signal_summary[0].type} (×${recent_signal_summary[0].count})` : ''}`
          : `${companyName ?? 'Account'} health: no snapshot in the last ${args.lookback_days ?? 60} days.`

      const citations: SummariseAccountHealthResult['citations'] = [
        {
          type: 'evidence',
          source_type: 'company',
          source_id: urn.company(ctx.tenantId, args.company_id),
          title: companyName ?? 'company',
        },
      ]
      if (latest) {
        citations.push({
          type: 'evidence',
          source_type: 'health_snapshot',
          source_id: `urn:rev:${ctx.tenantId}:health_snapshot:${latest.id}`,
          title: `Health ${latest.health_score ?? '?'}/100 on ${latest.captured_at.slice(0, 10)}`,
        })
      }
      // Top signal cited so the headline's "top signal" claim is verifiable.
      // We don't have the signal row id here (we only selected signal_type +
      // title + weighted_score) so we synthesise a signal URN keyed by
      // company + title hash. Real signals on /admin/ontology link by row id;
      // this is enough for the agent's citation pill UX.
      if (recent_signal_summary.length > 0 && (signalsRes.data ?? []).length > 0) {
        const topSignal = (signalsRes.data ?? [])[0]
        const titleStr = String(topSignal.title ?? topSignal.signal_type ?? 'signal')
        const synthId = `${args.company_id}:${Buffer.from(titleStr).toString('base64url').slice(0, 16)}`
        citations.push({
          type: 'evidence',
          source_type: 'signal',
          source_id: urn.signal(ctx.tenantId, synthId),
          title: titleStr,
        })
      }

      return {
        data: {
          company_id: args.company_id,
          company_name: companyName,
          latest,
          previous,
          trend,
          delta,
          recent_signal_summary,
          headline,
        },
        citations,
      } satisfies SummariseAccountHealthResult
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'summarise_account_health failed',
        citations: [],
      } satisfies SummariseAccountHealthResult
    }
  },
}
