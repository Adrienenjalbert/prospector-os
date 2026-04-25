import type { SupabaseClient } from '@supabase/supabase-js'
import {
  emitAgentEvent,
  urn,
  type MemoryKind,
  type MemoryScope,
  type ProposeMemoryInput,
  type TenantMemory,
} from '@prospector/core'
import { extractMemoryEdges } from './edge-extractor'

/**
 * Canonical writer used by every memory mining workflow (derive-icp,
 * mine-personas, mine-themes, …). Centralising this so:
 *
 *   1. Every memory lands with the same defaults (status='proposed',
 *      uniform Beta(1,1) bandit prior, evidence schema preserved).
 *   2. Idempotency via (tenant_id, kind, scope, title) — re-running a
 *      miner the same night updates the existing row (refreshes
 *      `body`, `evidence`, `confidence`, `derived_at`) instead of
 *      duplicating it. Pinned rows are protected: an idempotent
 *      re-run leaves the pinned status alone but refreshes the body.
 *   3. Telemetry is emitted exactly once per derivation — the
 *      `memory_derived` event drives /admin/adaptation's "what was
 *      learned this week" panel.
 *
 * Returns the upserted row's `id` so callers can record provenance
 * (e.g. the derive-icp workflow keeps a list of memory ids per run
 * for the workflow_runs.output trail).
 */
export interface ProposeMemoryResult {
  memory_id: string
  was_new: boolean
}

export async function proposeMemory(
  supabase: SupabaseClient,
  input: ProposeMemoryInput,
): Promise<ProposeMemoryResult> {
  const scopeKey = canonicalScopeKey(input.scope)

  const { data: existing } = await supabase
    .from('tenant_memories')
    .select('id, status, prior_alpha, prior_beta')
    .eq('tenant_id', input.tenant_id)
    .eq('kind', input.kind)
    .eq('title', input.title)
    .eq('scope', scopeKey)
    .maybeSingle()

  const nowIso = new Date().toISOString()

  if (existing) {
    // Refresh — preserve status (pinned/approved/archived stay) and the
    // accumulated bandit posterior, but update body / evidence /
    // confidence / derived_at so admins see the latest data.
    await supabase
      .from('tenant_memories')
      .update({
        body: input.body,
        evidence: input.evidence,
        confidence: input.confidence,
        derived_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', existing.id)

    await emitAgentEvent(supabase, {
      tenant_id: input.tenant_id,
      event_type: 'memory_derived',
      subject_urn: urn.memory(input.tenant_id, existing.id as string),
      payload: {
        memory_id: existing.id,
        kind: input.kind,
        scope: input.scope,
        confidence: input.confidence,
        source_workflow: input.source_workflow,
        was_new: false,
      },
    })

    // Phase 6 (2.2) — fire-and-forget edge extraction. Idempotent
    // (existing edges are skipped) so a refresh that didn't actually
    // change body is a near-no-op. Re-runs let edges attach once the
    // embeddings cron has filled the seed's vector.
    void extractMemoryEdges(supabase, existing.id as string, input.tenant_id).catch((err) => {
      console.warn('[proposeMemory] edge extraction failed (refresh):', err)
    })

    return { memory_id: existing.id as string, was_new: false }
  }

  const { data: inserted, error } = await supabase
    .from('tenant_memories')
    .insert({
      tenant_id: input.tenant_id,
      kind: input.kind,
      scope: input.scope,
      title: input.title,
      body: input.body,
      evidence: input.evidence,
      confidence: input.confidence,
      source_workflow: input.source_workflow,
      derived_at: nowIso,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    throw new Error(
      `proposeMemory insert failed (kind=${input.kind}, title=${input.title.slice(0, 60)}): ${error?.message ?? 'no row returned'}`,
    )
  }

  await emitAgentEvent(supabase, {
    tenant_id: input.tenant_id,
    event_type: 'memory_derived',
    subject_urn: urn.memory(input.tenant_id, inserted.id as string),
    payload: {
      memory_id: inserted.id,
      kind: input.kind,
      scope: input.scope,
      confidence: input.confidence,
      source_workflow: input.source_workflow,
      was_new: true,
    },
  })

  // Phase 6 (2.2) — first-pass edge extraction. The seed has no
  // embedding yet; the extractor will skip silently and try again on
  // the next nightly mining cycle once cron/embeddings has filled it.
  void extractMemoryEdges(supabase, inserted.id as string, input.tenant_id).catch((err) => {
    console.warn('[proposeMemory] edge extraction failed (insert):', err)
  })

  return { memory_id: inserted.id as string, was_new: true }
}

/**
 * Stable JSON form of the scope so the dedupe lookup matches even when
 * the miner serialises keys in a different order.
 */
function canonicalScopeKey(scope: MemoryScope): MemoryScope {
  const out: Record<string, string> = {}
  for (const k of Object.keys(scope).sort()) {
    const v = (scope as Record<string, unknown>)[k]
    if (typeof v === 'string' && v.length > 0) out[k] = v
  }
  return out as MemoryScope
}

/**
 * Lookup-side helper used by slices that need approved+pinned memories
 * with a kind + scope filter and no embedding. Embedded RAG goes
 * through the `match_memories` RPC instead.
 */
export async function loadMemoriesByScope(
  supabase: SupabaseClient,
  opts: {
    tenant_id: string
    kind: MemoryKind
    industry?: string | null
    persona_role?: string | null
    competitor?: string | null
    stage?: string | null
    limit?: number
  },
): Promise<Pick<TenantMemory, 'id' | 'kind' | 'title' | 'body' | 'scope' | 'evidence' | 'confidence'>[]> {
  let q = supabase
    .from('tenant_memories')
    .select('id, kind, title, body, scope, evidence, confidence')
    .eq('tenant_id', opts.tenant_id)
    .eq('kind', opts.kind)
    .in('status', ['approved', 'pinned'])
    .order('confidence', { ascending: false })
    .order('derived_at', { ascending: false })
    .limit(opts.limit ?? 5)

  if (opts.industry) q = q.eq('scope->>industry', opts.industry)
  if (opts.persona_role) q = q.eq('scope->>persona_role', opts.persona_role)
  if (opts.competitor) q = q.eq('scope->>competitor', opts.competitor)
  if (opts.stage) q = q.eq('scope->>stage', opts.stage)

  const { data } = await q
  return (data ?? []) as Pick<
    TenantMemory,
    'id' | 'kind' | 'title' | 'body' | 'scope' | 'evidence' | 'confidence'
  >[]
}
