import type { SupabaseClient } from '@supabase/supabase-js'
import { generateObject } from 'ai'
import { z } from 'zod'
import {
  emitAgentEvent,
  urn,
  MEMORY_EDGE_KINDS,
  type MemoryEdgeKind,
  type MemoryKind,
} from '@prospector/core'
import { getModel } from '@/lib/agent/model-registry'

/**
 * Phase 6 (Section 2.2) — typed memory-edge extraction.
 *
 * After every proposeMemory call, this module:
 *
 *   1. Loads the new memory's embedding (skip if NULL — the embeddings
 *      cron will fill it overnight; the next nightly mining cycle will
 *      re-attempt edge extraction with the embedding present).
 *   2. Loads the 10 nearest existing approved/pinned memories of the
 *      same kind via match_memories RPC, excluding the seed itself.
 *   3. Asks Sonnet (one generateObject call) to identify up to 5 typed
 *      edges to those candidates: related_to, contradicts, or supersedes.
 *   4. Inserts each edge into memory_edges with src_kind='memory',
 *      dst_kind='memory'. The UNIQUE constraint on
 *      (tenant_id, src_kind, src_id, dst_kind, dst_id, edge_kind)
 *      makes the insert idempotent — re-running the extractor for the
 *      same memory is a no-op.
 *
 * Cost is bounded: one Sonnet call per *new* memory (or per refresh
 * that gained an embedding). Roughly 100 atoms/tenant/night × ~700
 * tokens per call ≈ 70k tokens/tenant/night. ~$0.50/tenant/night at
 * Sonnet pricing.
 *
 * Edges between WIKI PAGES are written by compileWikiPages (Section
 * 2.3), not here. This module only produces atom→atom edges.
 *
 * Failure modes:
 *
 *   - No embedding on the seed → skipped silently (re-attempt next
 *     night).
 *   - No candidates returned → no edges to extract; skipped silently.
 *   - Edges already exist → upsert pattern means re-runs are no-ops.
 *   - LLM call fails → logged, the proposeMemory call still succeeds
 *     (this is fire-and-forget — never load-bearing for the writer).
 *   - Sonnet returns dst_id not in candidates set → filtered out
 *     (defence against hallucinated ids).
 */

const MAX_CANDIDATES = 10
const MAX_EDGES_PER_CALL = 5

const EdgeSchema = z.object({
  edges: z
    .array(
      z.object({
        // Restrict to candidate ids the model was given. We re-validate
        // against the candidate set after the call.
        dst_id: z.string().uuid(),
        // Only the three kinds that make sense for atom→atom edges
        // extracted from a new derivation. Other kinds (derived_from,
        // cites, see_also) are written by compile / human / lint, not
        // by this extractor.
        edge_kind: z.enum(['related_to', 'contradicts', 'supersedes']),
        // 1-sentence justification — surfaced on /admin/wiki and
        // /admin/memory edge detail.
        evidence: z.string().min(1).max(500),
      }),
    )
    .max(MAX_EDGES_PER_CALL),
})

type EdgeProposal = z.infer<typeof EdgeSchema>['edges'][number]

interface SeedRow {
  id: string
  kind: MemoryKind
  title: string
  body: string
  embedding: string | null
}

interface CandidateRow {
  id: string
  kind: string
  title: string
  body: string
  similarity: number
}

/**
 * Extract typed edges for a single newly-derived (or newly-embedded)
 * memory. Idempotent — safe to call from proposeMemory on every upsert.
 *
 * Returns a small result object so callers (proposeMemory, tests) can
 * see what happened without re-querying.
 */
export interface ExtractMemoryEdgesResult {
  skipped: boolean
  reason?: string
  candidate_count?: number
  edges_inserted?: number
}

export async function extractMemoryEdges(
  supabase: SupabaseClient,
  newMemoryId: string,
  tenantId: string,
): Promise<ExtractMemoryEdgesResult> {
  // --- 1. Load the seed.
  const { data: seed, error: seedErr } = await supabase
    .from('tenant_memories')
    .select('id, kind, title, body, embedding')
    .eq('tenant_id', tenantId)
    .eq('id', newMemoryId)
    .maybeSingle<SeedRow>()
  if (seedErr || !seed) {
    return { skipped: true, reason: 'seed_not_found' }
  }
  if (!seed.embedding) {
    // First-pass insertion without an embedding — re-attempted on the
    // next nightly mining cycle once the embeddings cron has filled
    // tenant_memories.embedding for this row.
    return { skipped: true, reason: 'no_embedding_yet' }
  }

  // --- 2. Skip if outbound edges already exist for this memory.
  // The unique constraint would catch double-inserts anyway, but
  // checking here saves the LLM call entirely on re-runs.
  const { data: existingEdges } = await supabase
    .from('memory_edges')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('src_kind', 'memory')
    .eq('src_id', newMemoryId)
    .limit(1)
  if (existingEdges && existingEdges.length > 0) {
    return { skipped: true, reason: 'edges_already_present' }
  }

  // --- 3. Pull the 10 nearest candidates of the same kind.
  // match_memories takes a vector parameter, but the seed's embedding
  // column is stored as a vector type — pass it through unchanged.
  const { data: candidatesRaw, error: matchErr } = await supabase.rpc('match_memories', {
    query_embedding: seed.embedding,
    match_tenant_id: tenantId,
    match_kinds: [seed.kind],
    match_threshold: 0.5,
    match_count: MAX_CANDIDATES + 1, // +1 because the seed will match itself; we filter
  })
  if (matchErr) {
    return { skipped: true, reason: `match_memories_failed: ${matchErr.message}` }
  }
  const candidates = (candidatesRaw as CandidateRow[] | null)?.filter((c) => c.id !== newMemoryId) ?? []
  if (candidates.length === 0) {
    return { skipped: true, reason: 'no_candidates', candidate_count: 0 }
  }

  // --- 4. Single Sonnet call. Tight prompt; structured output via
  // generateObject + Zod schema so we don't have to parse JSON ourselves.
  const candidateList = candidates
    .slice(0, MAX_CANDIDATES)
    .map(
      (c, i) =>
        `## CANDIDATE ${i + 1} (id: ${c.id}, similarity: ${c.similarity.toFixed(2)})\nTitle: ${c.title}\nBody: ${c.body.slice(0, 600)}`,
    )
    .join('\n\n')

  const prompt = `You are an edge-extraction assistant for a sales-AI knowledge graph.

You are given ONE new memory and up to ${MAX_CANDIDATES} CANDIDATE memories of the same kind. Identify which candidates have a meaningful typed relationship to the new memory.

Edge kinds you may emit (and ONLY these three):

- related_to: same topic / scope, complementary observations. Use this when both memories shed light on the same entity from different angles.
- contradicts: makes the OPPOSITE claim about the same scope. Use sparingly — only when one memory clearly refutes another (e.g. "Acme's champion is the VP of Eng" vs "Acme's champion is the CFO").
- supersedes: NEW memory replaces the OLD candidate. Use when the candidate is older / lower-confidence AND the new memory clearly updates or replaces its claim.

Constraints:
- Maximum ${MAX_EDGES_PER_CALL} edges total.
- dst_id MUST be one of the candidate ids listed below — verbatim.
- Skip candidates that are merely textually similar but not relationally meaningful. An empty edges array is a valid output.
- evidence MUST be a single sentence justifying the edge (≤200 chars).

# NEW MEMORY (id: ${seed.id})
Kind: ${seed.kind}
Title: ${seed.title}
Body: ${seed.body.slice(0, 800)}

# CANDIDATES
${candidateList}
`

  let proposed: EdgeProposal[]
  try {
    const result = await generateObject({
      model: getModel('anthropic/claude-sonnet-4'),
      schema: EdgeSchema,
      prompt,
      maxTokens: 600,
    })
    proposed = result.object.edges
  } catch (err) {
    // Non-load-bearing: if the LLM call fails, the memory still lives;
    // edges just don't attach this round.
    return { skipped: true, reason: `llm_call_failed: ${String(err).slice(0, 200)}` }
  }

  // --- 5. Validate dst_ids against candidate set. Defence against
  // hallucinated ids the LLM may invent despite the schema.
  const candidateIdSet = new Set(candidates.map((c) => c.id))
  const validEdges = proposed.filter((e) => candidateIdSet.has(e.dst_id))

  if (validEdges.length === 0) {
    return { skipped: true, reason: 'no_valid_edges', candidate_count: candidates.length }
  }

  // --- 6. Insert. The UNIQUE constraint on (src_kind, src_id, dst_kind,
  // dst_id, edge_kind) makes a re-run of the same edge a no-op.
  const rows = validEdges.map((e) => ({
    tenant_id: tenantId,
    src_kind: 'memory' as const,
    src_id: newMemoryId,
    dst_kind: 'memory' as const,
    dst_id: e.dst_id,
    edge_kind: e.edge_kind as MemoryEdgeKind,
    weight: 1.0,
    evidence: { reason: e.evidence, source_workflow: 'edge_extractor' },
  }))
  const { error: insertErr } = await supabase
    .from('memory_edges')
    .upsert(rows, {
      onConflict: 'tenant_id,src_kind,src_id,dst_kind,dst_id,edge_kind',
      ignoreDuplicates: true,
    })
  if (insertErr) {
    return { skipped: true, reason: `insert_failed: ${insertErr.message}` }
  }

  // Light telemetry — one event per memory processed (not per edge,
  // to keep the agent_events table small). The payload carries the
  // edge count so /admin/wiki can render "X new edges last 24h".
  await emitAgentEvent(supabase, {
    tenant_id: tenantId,
    event_type: 'memory_derived',
    subject_urn: urn.memory(tenantId, newMemoryId),
    payload: {
      memory_id: newMemoryId,
      kind: seed.kind,
      source_workflow: 'edge_extractor',
      edges_inserted: validEdges.length,
    },
  })

  return {
    skipped: false,
    candidate_count: candidates.length,
    edges_inserted: validEdges.length,
  }
}

/**
 * Re-export the constant so call sites have a stable handle on the
 * full edge-kind enum without importing from @prospector/core
 * (the writer.ts imports stay narrow).
 */
export { MEMORY_EDGE_KINDS }
