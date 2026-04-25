import type { SupabaseClient } from '@supabase/supabase-js'
import {
  emitAgentEvent,
  urn,
  type MemoryKind,
} from '@prospector/core'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * consolidateMemories — Phase 6 (Section 3.1) of the Two-Level
 * Second Brain.
 *
 * Nightly workflow that keeps `tenant_memories` healthy:
 *
 *   1. Decay step
 *      For every proposed/approved memory, recompute decay_score
 *      using the Ebbinghaus-style formula:
 *        decay_score = exp(-days_since_derived_at / half_life)
 *      with kind-specific half-lives (180 default, 30 for
 *      glossary_term, 90 for competitor_play). Memories whose
 *      decay_score < 0.2 AND status='proposed' get auto-archived
 *      with notes='auto_decayed'.
 *
 *   2. Dedup step
 *      For each kind, find pairs of memories within the same scope
 *      whose embeddings are cosine-similar > 0.92. The newer of the
 *      two gets superseded_by = older_id. Older memory keeps its
 *      status; newer flips to 'superseded'. Reuses the embeddings
 *      from runMemoriesEmbedder (Section 1.1).
 *
 *   3. Contradiction detection
 *      For one-truth-per-scope kinds (icp_pattern, persona,
 *      motion_step, stage_best_practice), pairs with cosine < 0.4
 *      AND both status='approved' get flagged as `contradicts` edges
 *      in memory_edges. Never auto-resolved — admins resolve via
 *      /admin/wiki?lint=contradiction.
 *
 *   4. Auto-promote
 *      Proposed memories with confidence >= 0.85 AND no
 *      contradicting pinned memory in scope flip to 'approved'.
 *      Each auto-promotion lands a calibration_ledger row so admins
 *      can audit overnight changes.
 *
 * Idempotency: per-tenant per-day key.
 *
 * Cost: bounded (no LLM calls). Pure SQL + embedding similarity.
 * Roughly 100-200 memories scanned per tenant per night.
 */

const HALF_LIFE_DAYS: Record<string, number> = {
  default: 180,
  glossary_term: 30,
  competitor_play: 90,
}

const DECAY_AUTO_ARCHIVE_THRESHOLD = 0.2
const DEDUP_SIMILARITY_THRESHOLD = 0.92
const CONTRADICTION_SIMILARITY_THRESHOLD = 0.4
const AUTO_PROMOTE_CONFIDENCE_THRESHOLD = 0.85

// One-truth-per-scope kinds — these are the kinds where two atoms
// asserting opposite things in the same scope is a real contradiction
// (vs. just two complementary observations).
const ONE_TRUTH_KINDS: ReadonlySet<MemoryKind> = new Set([
  'icp_pattern',
  'persona',
  'motion_step',
  'stage_best_practice',
])

interface AtomRow {
  id: string
  kind: MemoryKind
  status: string
  scope: Record<string, string | undefined>
  confidence: number
  derived_at: string
  embedding: string | null
  superseded_by: string | null
}

export async function enqueueConsolidateMemories(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'consolidate_memories',
    idempotencyKey: `cm:${tenantId}:${day}`,
    input: { day, source: 'cron' },
  })
}

export async function runConsolidateMemories(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_atoms',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { data: rows } = await ctx.supabase
          .from('tenant_memories')
          .select('id, kind, status, scope, confidence, derived_at, embedding, superseded_by')
          .eq('tenant_id', ctx.tenantId)
          .in('status', ['proposed', 'approved', 'pinned'])
          .limit(2000)
        return { atoms: (rows ?? []) as AtomRow[] }
      },
    },
    {
      name: 'decay',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { atoms } = ctx.stepState.load_atoms as { atoms: AtomRow[] }
        const now = Date.now()
        let recomputed = 0
        let archived = 0

        for (const atom of atoms) {
          if (atom.superseded_by) continue
          const halfLife = HALF_LIFE_DAYS[atom.kind] ?? HALF_LIFE_DAYS.default
          const daysSince =
            (now - new Date(atom.derived_at).getTime()) / (24 * 60 * 60 * 1000)
          const decayScore = Math.exp(-daysSince / halfLife)
          const rounded = Math.round(decayScore * 100) / 100

          // Always persist the decay score (so /admin/memory can show it).
          // Auto-archive only proposed rows that have decayed past the
          // threshold — approved/pinned stay regardless of decay
          // (admin opt-in for archiving high-touch rows).
          const update: Record<string, unknown> = { decay_score: rounded }
          let didArchive = false
          if (rounded < DECAY_AUTO_ARCHIVE_THRESHOLD && atom.status === 'proposed') {
            update.status = 'archived'
            update.notes = 'auto_decayed'
            update.updated_at = new Date().toISOString()
            didArchive = true
          }
          await ctx.supabase
            .from('tenant_memories')
            .update(update)
            .eq('id', atom.id)
            .eq('tenant_id', ctx.tenantId)
          recomputed += 1
          if (didArchive) {
            archived += 1
            await emitAgentEvent(ctx.supabase, {
              tenant_id: ctx.tenantId,
              event_type: 'memory_archived',
              subject_urn: urn.memory(ctx.tenantId, atom.id),
              payload: {
                memory_id: atom.id,
                kind: atom.kind,
                reason: 'auto_decayed',
                decay_score: rounded,
                days_since_derived: Math.round(daysSince),
              },
            })
          }
        }

        return { recomputed, archived }
      },
    },
    {
      name: 'dedup',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { atoms } = ctx.stepState.load_atoms as { atoms: AtomRow[] }

        // Group atoms by (kind, canonical scope key). Within each
        // group, find pairs whose embeddings are above the dedup
        // threshold. Newer one (later derived_at) gets superseded_by =
        // older.
        let supersededCount = 0
        const groups = new Map<string, AtomRow[]>()
        for (const atom of atoms) {
          if (!atom.embedding) continue
          if (atom.superseded_by) continue // already superseded
          if (atom.status === 'pinned') continue // pinned never gets demoted
          const key = `${atom.kind}|${canonicalScopeKey(atom.scope)}`
          const arr = groups.get(key) ?? []
          arr.push(atom)
          groups.set(key, arr)
        }

        for (const [, group] of groups) {
          if (group.length < 2) continue
          // Sort by derived_at ASC so older is index 0 — older wins.
          group.sort((a, b) => a.derived_at.localeCompare(b.derived_at))
          for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
              const older = group[i]
              const newer = group[j]
              if (newer.superseded_by) continue
              // Use the seed's embedding via the match_memories RPC for
              // cosine similarity. We embed-search the older against
              // its own kind+scope and check whether the newer ranks
              // above the dedup threshold. Simpler than computing
              // cosine in JS over base64-encoded vectors.
              const sim = await pairwiseSimilarity(ctx.supabase, ctx.tenantId, older.id, newer.id)
              if (sim !== null && sim > DEDUP_SIMILARITY_THRESHOLD) {
                await ctx.supabase
                  .from('tenant_memories')
                  .update({
                    status: 'superseded',
                    superseded_by: older.id,
                    notes: `auto_superseded by ${older.id} (sim=${sim.toFixed(3)})`,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', newer.id)
                  .eq('tenant_id', ctx.tenantId)

                // Edge for the audit graph.
                await ctx.supabase
                  .from('memory_edges')
                  .upsert(
                    {
                      tenant_id: ctx.tenantId,
                      src_kind: 'memory',
                      src_id: older.id,
                      dst_kind: 'memory',
                      dst_id: newer.id,
                      edge_kind: 'supersedes',
                      weight: 1.0,
                      evidence: { reason: 'consolidate dedup', similarity: sim },
                    },
                    {
                      onConflict: 'tenant_id,src_kind,src_id,dst_kind,dst_id,edge_kind',
                      ignoreDuplicates: true,
                    },
                  )

                await emitAgentEvent(ctx.supabase, {
                  tenant_id: ctx.tenantId,
                  event_type: 'memory_superseded',
                  subject_urn: urn.memory(ctx.tenantId, newer.id),
                  payload: {
                    memory_id: newer.id,
                    superseded_by: older.id,
                    similarity: sim,
                    kind: newer.kind,
                  },
                })

                newer.superseded_by = older.id
                supersededCount += 1
              }
            }
          }
        }
        return { superseded: supersededCount, groups_inspected: groups.size }
      },
    },
    {
      name: 'detect_contradictions',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { atoms } = ctx.stepState.load_atoms as { atoms: AtomRow[] }

        // Same grouping as dedup but only for ONE_TRUTH_KINDS, and
        // we look for pairs that are SEMANTICALLY DIVERGENT (cosine
        // < 0.4) rather than similar.
        let flagged = 0
        const groups = new Map<string, AtomRow[]>()
        for (const atom of atoms) {
          if (!atom.embedding) continue
          if (atom.status !== 'approved') continue // only approved-vs-approved counts
          if (!ONE_TRUTH_KINDS.has(atom.kind)) continue
          const key = `${atom.kind}|${canonicalScopeKey(atom.scope)}`
          const arr = groups.get(key) ?? []
          arr.push(atom)
          groups.set(key, arr)
        }

        for (const [, group] of groups) {
          if (group.length < 2) continue
          for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
              const a = group[i]
              const b = group[j]
              const sim = await pairwiseSimilarity(ctx.supabase, ctx.tenantId, a.id, b.id)
              if (sim !== null && sim < CONTRADICTION_SIMILARITY_THRESHOLD) {
                // Flag as contradicts edge. The unique constraint on
                // memory_edges makes re-runs no-ops.
                await ctx.supabase
                  .from('memory_edges')
                  .upsert(
                    {
                      tenant_id: ctx.tenantId,
                      src_kind: 'memory',
                      src_id: a.id,
                      dst_kind: 'memory',
                      dst_id: b.id,
                      edge_kind: 'contradicts',
                      weight: 1.0,
                      evidence: {
                        reason: 'consolidate contradiction',
                        similarity: sim,
                        kind: a.kind,
                      },
                    },
                    {
                      onConflict: 'tenant_id,src_kind,src_id,dst_kind,dst_id,edge_kind',
                      ignoreDuplicates: true,
                    },
                  )
                flagged += 1
              }
            }
          }
        }
        return { flagged }
      },
    },
    {
      name: 'auto_promote',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { atoms } = ctx.stepState.load_atoms as { atoms: AtomRow[] }

        let promoted = 0
        for (const atom of atoms) {
          if (atom.status !== 'proposed') continue
          if (atom.confidence < AUTO_PROMOTE_CONFIDENCE_THRESHOLD) continue

          // Check for contradicting PINNED memories in the same scope.
          // We don't auto-promote when a human has explicitly pinned
          // an opposite truth.
          if (ONE_TRUTH_KINDS.has(atom.kind)) {
            const { data: pinnedSameScope } = await ctx.supabase
              .from('tenant_memories')
              .select('id')
              .eq('tenant_id', ctx.tenantId)
              .eq('kind', atom.kind)
              .eq('status', 'pinned')
              .eq('scope', atom.scope)
              .limit(1)
            if (pinnedSameScope && pinnedSameScope.length > 0) continue
          }

          const beforeStatus = atom.status
          const { error } = await ctx.supabase
            .from('tenant_memories')
            .update({
              status: 'approved',
              approved_at: new Date().toISOString(),
              notes: 'auto_promoted',
              updated_at: new Date().toISOString(),
            })
            .eq('id', atom.id)
            .eq('tenant_id', ctx.tenantId)
          if (error) continue

          // Audit trail — same calibration_ledger flow that the
          // /admin/memory action API uses, so the existing rollback
          // API can reverse this overnight transition.
          await ctx.supabase.from('calibration_ledger').insert({
            tenant_id: ctx.tenantId,
            change_type: 'memory_status',
            target_path: `tenant_memories.${atom.id}.status`,
            before_value: { status: beforeStatus, confidence: atom.confidence },
            after_value: { status: 'approved', reason: 'auto_promoted' },
            observed_lift: null,
            applied_by: null,
            notes: `Auto-promoted ${atom.kind} (confidence ${atom.confidence.toFixed(2)} ≥ ${AUTO_PROMOTE_CONFIDENCE_THRESHOLD})`,
          })

          await emitAgentEvent(ctx.supabase, {
            tenant_id: ctx.tenantId,
            event_type: 'memory_approved',
            subject_urn: urn.memory(ctx.tenantId, atom.id),
            payload: {
              memory_id: atom.id,
              kind: atom.kind,
              before_status: beforeStatus,
              reason: 'auto_promoted',
            },
          })

          promoted += 1
        }
        return { promoted }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canonicalScopeKey(scope: Record<string, string | undefined>): string {
  const out: string[] = []
  for (const k of Object.keys(scope).sort()) {
    const v = scope[k]
    if (typeof v === 'string' && v.length > 0) out.push(`${k}=${v}`)
  }
  return out.join('|')
}

/**
 * Compute cosine similarity between two memories by reading both
 * embeddings via the match_memories RPC (which already exposes the
 * pgvector cosine operator). Returns null when either embedding is
 * missing (the consolidator silently skips those rows).
 *
 * We use a single round trip per pair: query match_memories with
 * memory A's embedding, filtered to A's kind, with match_count high
 * enough to include B if it exists within the threshold. Then look
 * up B's similarity from the result.
 *
 * For tenants with hundreds of memories this is N^2 RPC calls —
 * acceptable at our current scale (one tenant ~ 100-300 atoms);
 * future optimization could batch-fetch all embeddings and compute
 * cosine in JS.
 */
async function pairwiseSimilarity(
  supabase: SupabaseClient,
  tenantId: string,
  aId: string,
  bId: string,
): Promise<number | null> {
  const { data: aRow } = await supabase
    .from('tenant_memories')
    .select('embedding, kind, scope')
    .eq('tenant_id', tenantId)
    .eq('id', aId)
    .maybeSingle()
  if (!aRow?.embedding) return null

  const { data: matches } = await supabase.rpc('match_memories', {
    query_embedding: aRow.embedding,
    match_tenant_id: tenantId,
    match_kinds: [aRow.kind],
    match_threshold: 0.0, // pull everything; we'll cherry-pick B
    match_count: 50,
  })
  const found = (matches as Array<{ id: string; similarity: number }> | null)?.find(
    (m) => m.id === bId,
  )
  return found ? Number(found.similarity) : null
}
