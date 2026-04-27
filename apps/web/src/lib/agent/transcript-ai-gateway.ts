/**
 * AI Gateway-aware adapters for `TranscriptIngester` (B3.4).
 *
 * The adapter package (`@prospector/adapters`) deliberately stays free
 * of `@prospector/web` imports — keeping it usable from CLIs, tests,
 * and other consumers. To route the LLM + embedding traffic through
 * the AI Gateway when it's configured, we pass small adapter
 * functions in via `TranscriptIngesterOptions`.
 *
 * The defaults preserve backwards compat: if the AI Gateway env vars
 * aren't set, the SDK falls back to direct provider calls (same
 * runtime cost as the previous raw-fetch path, plus the SDK's
 * built-in retries and observability).
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel } from '@/lib/agent/model-registry'
import type { TranscriptIngesterOptions } from '@prospector/adapters'

const SUMMARY_SCHEMA = z.object({
  summary: z.string().describe('2-3 sentence summary of the conversation'),
  themes: z
    .array(z.string())
    .describe(
      'Topic strings discussed (e.g. ["pricing", "implementation timeline", "competitor comparison"]).',
    ),
  sentiment_score: z
    .number()
    .min(-1)
    .max(1)
    .describe('Buyer sentiment, -1 (very negative) to 1 (very positive)'),
  meddpicc: z
    .object({
      metrics: z.string().nullable().optional(),
      economic_buyer: z.string().nullable().optional(),
      decision_criteria: z.string().nullable().optional(),
      decision_process: z.string().nullable().optional(),
      paper_process: z.string().nullable().optional(),
      implications_of_pain: z.string().nullable().optional(),
      champion: z.string().nullable().optional(),
      competition: z.string().nullable().optional(),
    })
    .nullable()
    .describe('MEDDPICC fields when this is a sales call; null otherwise.'),
})

const TRANSCRIPT_SUMMARISE_SYSTEM = `You are an expert sales call analyst.
Given a transcript, extract:
1. A 2-3 sentence summary
2. The themes discussed
3. Buyer sentiment (-1 to 1)
4. MEDDPICC fields when applicable, otherwise null

Be concise. Match the buyer's vocabulary; don't invent qualifications
they didn't actually express.`

/**
 * Build a Sonnet-backed structured-output summariser. Uses
 * `generateObject` so output is type-safe — no fragile JSON.parse on
 * a regex-extracted slice. Routes through `getModel('anthropic/...')`
 * which honours the AI Gateway when configured.
 */
export function buildAiGatewaySummariser(): NonNullable<TranscriptIngesterOptions['summariseFn']> {
  return async (rawText: string) => {
    const result = await generateObject({
      model: getModel('anthropic/claude-sonnet-4'),
      schema: SUMMARY_SCHEMA,
      system: TRANSCRIPT_SUMMARISE_SYSTEM,
      prompt: rawText.slice(0, 24000),
      maxTokens: 1024,
      temperature: 0.1,
    })
    return {
      summary: result.object.summary,
      themes: result.object.themes,
      sentiment_score: Math.max(-1, Math.min(1, result.object.sentiment_score)),
      meddpicc: (result.object.meddpicc as Record<string, unknown> | null) ?? null,
    }
  }
}

/**
 * Convenience: bundle the AI-gateway adapters callers should pass to
 * `TranscriptIngester`. Today only the summariser is wired through
 * the gateway; the embedder still uses the legacy OpenAI direct
 * fetch (the adapter's built-in fallback) until `@ai-sdk/openai` is
 * added as a dep — at which point we plug a `buildAiGatewayEmbedder`
 * helper here without changing the call sites.
 *
 *   new TranscriptIngester(supabase, tenantId, transcriptIngesterAiOptions())
 */
export function transcriptIngesterAiOptions(): TranscriptIngesterOptions {
  return {
    summariseFn: buildAiGatewaySummariser(),
  }
}
