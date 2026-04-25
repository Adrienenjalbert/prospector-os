/**
 * Smart Memory Layer — typed, citation-backed, per-tenant memory.
 *
 * One row per memory. Mining workflows (derive-icp, mine-personas, …)
 * write proposals. Admin approval flips status → approved. Slices
 * read approved + pinned only.
 *
 * See `packages/db/migrations/021_tenant_memories.sql` for the
 * authoritative schema. This file is the TS contract callers use.
 */

export const MEMORY_KINDS = [
  'icp_pattern',
  'persona',
  'win_theme',
  'loss_theme',
  'competitor_play',
  'glossary_term',
  'motion_step',
  'rep_playbook',
  'stage_best_practice',
  // Phase 6 (migration 022). Cross-deal observations written by
  // reflectMemories weekly. Loaded by the reflection-insights slice
  // for leader / admin roles only.
  'reflection',
] as const

export type MemoryKind = (typeof MEMORY_KINDS)[number]

export const MEMORY_STATUSES = [
  'proposed',
  'approved',
  'pinned',
  'archived',
  'superseded',
] as const

export type MemoryStatus = (typeof MEMORY_STATUSES)[number]

/**
 * URNs and supporting numeric counts behind a memory. Every mining
 * workflow writes at least one urn into `urns` so `/admin/memory` can
 * show "derived from these 12 won deals" with deep links.
 *
 * `samples` carries free-form short strings (e.g. transcript snippets)
 * so the admin UI can show a representative quote without re-querying
 * the source rows.
 */
export interface MemoryEvidence {
  urns: string[]
  counts?: Record<string, number>
  samples?: string[]
}

/**
 * Scope axes the slice selector + match_memories RPC filter on.
 * Empty `{}` is valid for tenant-wide memories like glossary terms.
 */
export interface MemoryScope {
  industry?: string
  persona_role?: string
  stage?: string
  rep_id?: string
  competitor?: string
  segment?: string
}

export interface TenantMemory {
  id: string
  tenant_id: string
  kind: MemoryKind
  scope: MemoryScope
  title: string
  body: string
  evidence: MemoryEvidence
  confidence: number
  embedding?: number[] | null
  embedding_content_hash?: string | null
  embedding_updated_at?: string | null
  prior_alpha: number
  prior_beta: number
  status: MemoryStatus
  source_workflow: string
  derived_at: string
  approved_by?: string | null
  approved_at?: string | null
  superseded_by?: string | null
  // Phase 6 (migration 022) — Ebbinghaus retention (1.0 = fresh,
  // <0.2 + status='proposed' triggers auto-archive in
  // consolidateMemories).
  decay_score: number
  // Free-form audit trail for automated transitions:
  // 'auto_decayed', 'auto_promoted', 'auto_superseded'.
  notes?: string | null
  created_at: string
  updated_at: string
}

/**
 * Input for the canonical writer used by every mining workflow.
 * Captures every required column and lets the writer pick sensible
 * defaults for `status`, `prior_alpha`, `prior_beta`.
 */
export interface ProposeMemoryInput {
  tenant_id: string
  kind: MemoryKind
  scope: MemoryScope
  title: string
  body: string
  evidence: MemoryEvidence
  confidence: number
  source_workflow: string
}

/**
 * Stable label map for human-facing surfaces. Used by /admin/memory
 * and by the agent prompt formatter so the rep sees "Win theme",
 * not "win_theme".
 */
export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  icp_pattern: 'ICP pattern',
  persona: 'Persona',
  win_theme: 'Win theme',
  loss_theme: 'Loss theme',
  competitor_play: 'Competitor play',
  glossary_term: 'Glossary term',
  motion_step: 'Sales motion step',
  rep_playbook: 'Rep playbook',
  stage_best_practice: 'Stage best practice',
  reflection: 'Reflection',
}
