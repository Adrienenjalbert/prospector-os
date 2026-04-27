import type { SupabaseClient } from '@supabase/supabase-js'

export interface TranscriptWebhookPayload {
  source: 'gong' | 'fireflies'
  source_id: string
  title?: string
  occurred_at: string
  duration_minutes?: number
  participants: { name: string; email?: string; company?: string }[]
  raw_text: string
  source_url?: string
  call_type?: string
}

export interface TranscriptSearchResult {
  id: string
  company_id: string | null
  summary: string
  themes: string[]
  occurred_at: string
  source_url: string | null
  similarity: number
}

interface SummarizeResult {
  summary: string
  themes: string[]
  sentiment_score: number
  meddpicc: Record<string, unknown> | null
}

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536
const MAX_EMBED_TOKENS = 8000
const APPROX_CHARS_PER_TOKEN = 4

/**
 * Optional callbacks the consumer (apps/web) can pass so the LLM
 * traffic flows through the AI Gateway via `getModel()` rather than
 * raw `fetch` (B3.4).
 *
 * `summariseFn` is the LLM-driven structured summary (Sonnet by
 * default). When omitted, the ingester falls back to direct Anthropic
 * `fetch` (legacy behaviour) — preserves backwards compat for any
 * caller that hasn't migrated.
 *
 * `embedFn` is the embedding model call. Omit to use the built-in
 * OpenAI `text-embedding-3-small` direct fetch.
 *
 * Both functions are pure adapters over your preferred AI client. The
 * adapter package itself stays free of `@prospector/web` imports.
 */
export interface TranscriptIngesterOptions {
  summariseFn?: (rawText: string) => Promise<SummarizeResult>
  embedFn?: (text: string) => Promise<number[]>
}

export class TranscriptIngester {
  private supabase: SupabaseClient
  private tenantId: string
  private summariseFn?: (rawText: string) => Promise<SummarizeResult>
  private embedFn?: (text: string) => Promise<number[]>

  constructor(
    supabase: SupabaseClient,
    tenantId: string,
    options: TranscriptIngesterOptions = {},
  ) {
    this.supabase = supabase
    this.tenantId = tenantId
    this.summariseFn = options.summariseFn
    this.embedFn = options.embedFn
  }

  async ingest(payload: TranscriptWebhookPayload): Promise<string> {
    const { data: existing } = await this.supabase
      .from('transcripts')
      .select('id')
      .eq('tenant_id', this.tenantId)
      .eq('source', payload.source)
      .eq('source_id', payload.source_id)
      .maybeSingle()

    if (existing?.id) {
      return existing.id as string
    }

    const companyId = await this.matchCompany(payload.participants)

    const [embedding, summarized] = await Promise.all([
      this.computeEmbedding(payload.raw_text),
      this.summarize(payload.raw_text),
    ])

    const { data, error } = await this.supabase
      .from('transcripts')
      .insert({
        tenant_id: this.tenantId,
        source: payload.source,
        source_id: payload.source_id,
        title: payload.title ?? null,
        occurred_at: payload.occurred_at,
        duration_minutes: payload.duration_minutes ?? null,
        participants: payload.participants,
        raw_text: payload.raw_text,
        source_url: payload.source_url ?? null,
        call_type: payload.call_type ?? null,
        company_id: companyId,
        summary: summarized.summary,
        themes: summarized.themes,
        sentiment_score: summarized.sentiment_score,
        meddpicc_extracted: summarized.meddpicc,
        embedding: `[${embedding.join(',')}]`,
      })
      .select('id')
      .single()

    if (error) {
      throw new Error(`Failed to insert transcript: ${error.message}`)
    }

    return data.id as string
  }

  async computeEmbedding(text: string): Promise<number[]> {
    // B3.4: prefer the consumer-provided callback (typically routed
    // via the AI Gateway) when available. Falls back to direct OpenAI
    // fetch for legacy callers that never set the option.
    if (this.embedFn) {
      return this.embedFn(text)
    }
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set')
    }

    const truncated = text.slice(0, MAX_EMBED_TOKENS * APPROX_CHARS_PER_TOKEN)

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: truncated,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`OpenAI embeddings failed (${res.status}): ${body}`)
    }

    const json = await res.json()
    return json.data[0].embedding as number[]
  }

  async summarize(rawText: string): Promise<SummarizeResult> {
    // B3.4: prefer the consumer-provided callback so calls flow
    // through the AI Gateway. The fallback below stays for callers
    // (or legacy tests) that haven't migrated.
    if (this.summariseFn) {
      return this.summariseFn(rawText)
    }
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set')
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: `You are an expert sales call analyst. Given a transcript, extract:
1. "summary": a 2-3 sentence summary of the conversation
2. "themes": an array of topic strings discussed (e.g. ["pricing", "implementation timeline", "competitor comparison"])
3. "sentiment_score": a number from -1 (very negative) to 1 (very positive) reflecting buyer sentiment
4. "meddpicc": if this is a sales call, extract MEDDPICC fields as an object with keys like "metrics", "economic_buyer", "decision_criteria", "decision_process", "paper_process", "implications_of_pain", "champion", "competition". Set to null if not a sales call.

Respond ONLY with valid JSON, no markdown fences or extra text.`,
        messages: [
          {
            role: 'user',
            content: rawText.slice(0, 24000),
          },
        ],
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Anthropic summarize failed (${res.status}): ${body}`)
    }

    const json = await res.json()
    const content = json.content?.[0]?.text ?? '{}'

    try {
      const parsed = JSON.parse(content) as SummarizeResult
      return {
        summary: parsed.summary ?? '',
        themes: Array.isArray(parsed.themes) ? parsed.themes : [],
        sentiment_score: typeof parsed.sentiment_score === 'number'
          ? Math.max(-1, Math.min(1, parsed.sentiment_score))
          : 0,
        meddpicc: parsed.meddpicc ?? null,
      }
    } catch {
      return {
        summary: content.slice(0, 500),
        themes: [],
        sentiment_score: 0,
        meddpicc: null,
      }
    }
  }

  async matchCompany(
    participants: TranscriptWebhookPayload['participants'],
  ): Promise<string | null> {
    const emails = participants
      .map((p) => p.email)
      .filter((e): e is string => !!e)

    if (emails.length === 0) return null

    const { data } = await this.supabase
      .from('contacts')
      .select('company_id')
      .eq('tenant_id', this.tenantId)
      .in('email', emails)
      .limit(1)
      .maybeSingle()

    return (data?.company_id as string) ?? null
  }

  async searchSimilar(
    query: string,
    options: { limit?: number; companyId?: string | null } = {},
  ): Promise<TranscriptSearchResult[]> {
    const limit = options.limit ?? 5
    const embedding = await this.computeEmbedding(query)

    const rpcParams: Record<string, unknown> = {
      query_embedding: embedding,
      match_tenant_id: this.tenantId,
      match_count: limit,
    }
    if (options.companyId) {
      rpcParams.filter_company_id = options.companyId
    }

    const { data, error } = await this.supabase.rpc('match_transcripts', rpcParams)

    if (error) {
      throw new Error(`Transcript similarity search failed: ${error.message}`)
    }

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      company_id: (row.company_id as string) ?? null,
      summary: (row.summary as string) ?? '',
      themes: (row.themes as string[]) ?? [],
      occurred_at: row.occurred_at as string,
      source_url: (row.source_url as string) ?? null,
      similarity: row.similarity as number,
    }))
  }
}
