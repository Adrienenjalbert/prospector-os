/**
 * Query-side embedder used by RAG slices (C5.2).
 *
 * Single-shot embedding of the rep's last message so RAG slices can
 * call Supabase RPCs (`match_companies`, `match_notes`, etc.) keyed
 * on similarity to the actual question.
 *
 * Memoised within a single request to avoid re-embedding the same
 * message N times (one per RAG slice). The cache is per-Promise (not
 * per-string) so concurrent slices share the in-flight embed.
 */

const cache = new Map<string, Promise<number[]>>()

/**
 * Embed `text` via OpenAI text-embedding-3-small. Memoised by text
 * content. Returns a 1536-dim vector. Throws on missing API key /
 * network failure — the calling slice is expected to catch and
 * degrade to empty (RAG is a soft enhancement, never a hard
 * dependency).
 */
export async function embedQuery(text: string): Promise<number[]> {
  const trimmed = (text ?? '').trim()
  if (!trimmed) {
    throw new Error('embedQuery: empty input text')
  }
  const cached = cache.get(trimmed)
  if (cached) return cached

  const promise = (async () => {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not set — RAG retrieval unavailable')
    }
    const truncated = trimmed.slice(0, 4000)
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: truncated,
        dimensions: 1536,
      }),
    })
    if (!res.ok) {
      throw new Error(`embedQuery: OpenAI ${res.status}`)
    }
    const json = await res.json()
    return json.data[0].embedding as number[]
  })()

  cache.set(trimmed, promise)
  // Bound the cache size in long-running processes (Edge / Fluid
  // Compute reuses instances). 64 entries × 1.5KB ≈ 96KB upper bound.
  if (cache.size > 64) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  return promise
}

/**
 * Phase 6 (A1.1) — alias of embedQuery used by memory-aware slices
 * (icp-snapshot, persona-library, win-loss-themes, competitor-plays)
 * when they fall back to the match_memories RPC. Functionally
 * identical to embedQuery (same model, same dims, same memoisation),
 * but exported under a name that grep-anchors the call sites for any
 * future audit ("which slices use vector memory recall vs scope
 * loading?").
 *
 * The match_wiki_pages RPC uses the same vector — pages and atoms
 * share the embedding space because both are 1536-dim
 * text-embedding-3-small.
 */
export async function embedQueryForMemories(text: string): Promise<number[]> {
  return embedQuery(text)
}
