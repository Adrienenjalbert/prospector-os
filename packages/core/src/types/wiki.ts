/**
 * Wiki Layer (migration 022, Phase 6 — Two-Level Second Brain).
 *
 * `wiki_pages` are compiled, interlinked markdown pages derived
 * nightly from `tenant_memories` atoms by the compileWikiPages
 * workflow. They are what slices read first; atoms are the fallback.
 *
 * `memory_edges` is the typed graph between atoms and pages. Edges
 * carry compilation provenance (`derived_from`), supersession
 * (`supersedes`), contradictions (`contradicts`, never
 * auto-resolved), and soft semantic links (`related_to`, `cites`,
 * `see_also`).
 *
 * `tenant_wiki_schema` is the per-tenant `CLAUDE.md` content. The
 * compileWikiPages workflow loads this into its system prompt so
 * each tenant's brain is shaped by its own conventions. Karpathy's
 * "schema is the product" rule, applied per-tenant.
 *
 * Authoritative schema: `packages/db/migrations/022_wiki_layer.sql`.
 */

// ---------------------------------------------------------------------------
// wiki_pages
// ---------------------------------------------------------------------------

export const WIKI_PAGE_KINDS = [
  // Entity pages — one per concrete entity the tenant cares about.
  'entity_industry', // industry the tenant sells into
  'entity_persona', // role / archetype (champion, EB, decision_maker)
  'entity_competitor', // named competitor
  'entity_stage', // pipeline stage
  // Phase 7 (Section 3.5) — per-company neighbourhood page,
  // compiled when a company accumulates >=3 inbound bridges_to
  // edges. Surfaces the warm-path constellation around the account.
  'entity_company_neighbourhood',

  // Concept pages — tenant-wide tenets.
  'concept_motion', // the tenant's sales motion (compiled from motion_step atoms)
  'concept_icp', // the tenant's ICP (compiled from icp_pattern atoms)
  'concept_glossary', // tenant-specific vocabulary (compiled from glossary_term atoms)

  // Playbook pages — procedural memory ("how things are done here").
  'playbook_rep', // per-rep playbook (compiled from rep_playbook atoms)
  'playbook_stage', // per-stage best practices (compiled from stage_best_practice atoms)

  // Time-bounded pages.
  'reflection_weekly', // weekly cross-deal reflection (compiled by reflectMemories)
  'log_session', // crystallized high-value session digest (Phase 7+ scope)

  // Navigational.
  'index_root', // root index page (the tenant's landing in /admin/wiki)
] as const

export type WikiPageKind = (typeof WIKI_PAGE_KINDS)[number]

export const WIKI_PAGE_STATUSES = [
  'draft', // compiled but not yet ready to inject
  'published', // active, slices may load it
  'pinned', // never auto-archived; admin-promoted
  'archived', // out of band; lint-decayed or admin-archived
  'superseded', // replaced by a newer page (see superseded_by)
] as const

export type WikiPageStatus = (typeof WIKI_PAGE_STATUSES)[number]

/**
 * Frontmatter on each wiki page. Persisted as JSONB (`frontmatter`
 * column) so the export endpoint can reconstruct YAML on demand
 * without re-parsing the body.
 *
 * lint_warnings is set by lintWiki nightly. quality_score is the
 * self-eval (0..1, < 0.5 triggers re-compile with stricter prompt).
 */
export interface WikiPageFrontmatter {
  kind?: WikiPageKind
  scope?: Record<string, string | undefined>
  source_atoms?: string[]
  confidence?: number
  decay_score?: number
  last_compiled_at?: string
  compiler_version?: string
  quality_score?: number
  lint_warnings?: string[]
  related?: string[] // [[wikilinks]] for the export
  // Free-form additions are allowed; the compiler may write more.
  [key: string]: unknown
}

export interface WikiPage {
  id: string
  tenant_id: string
  kind: WikiPageKind
  slug: string
  title: string
  body_md: string
  frontmatter: WikiPageFrontmatter
  status: WikiPageStatus
  confidence: number
  decay_score: number
  prior_alpha: number
  prior_beta: number
  source_atoms: string[]
  source_atoms_hash?: string | null
  last_compiled_at?: string | null
  compiler_version?: string | null
  superseded_by?: string | null
  embedding?: number[] | null
  embedding_content_hash?: string | null
  embedding_updated_at?: string | null
  created_at: string
  updated_at: string
}

/**
 * Stable label map for /admin/wiki and the export's index.md.
 */
export const WIKI_PAGE_KIND_LABELS: Record<WikiPageKind, string> = {
  entity_industry: 'Industry',
  entity_persona: 'Persona',
  entity_competitor: 'Competitor',
  entity_stage: 'Pipeline stage',
  entity_company_neighbourhood: 'Company neighbourhood',
  concept_motion: 'Sales motion',
  concept_icp: 'ICP',
  concept_glossary: 'Glossary',
  playbook_rep: 'Rep playbook',
  playbook_stage: 'Stage playbook',
  reflection_weekly: 'Weekly reflection',
  log_session: 'Session log',
  index_root: 'Index',
}

// ---------------------------------------------------------------------------
// memory_edges
// ---------------------------------------------------------------------------

export const MEMORY_EDGE_ENDPOINTS = ['memory', 'wiki_page'] as const
export type MemoryEdgeEndpoint = (typeof MEMORY_EDGE_ENDPOINTS)[number]

export const MEMORY_EDGE_KINDS = [
  'derived_from', // page -> atom (compilation provenance, written by compile)
  'supersedes', // newer -> older (written by consolidate / lint)
  'contradicts', // pair flagged by lint; never auto-resolved
  'related_to', // soft semantic link (extracted on edge_proposal)
  'cites', // explicit URN reference in body_md
  'see_also', // editorial link (humans can add via /admin/wiki)
] as const

export type MemoryEdgeKind = (typeof MEMORY_EDGE_KINDS)[number]

export interface MemoryEdge {
  id: string
  tenant_id: string
  src_kind: MemoryEdgeEndpoint
  src_id: string
  dst_kind: MemoryEdgeEndpoint
  dst_id: string
  edge_kind: MemoryEdgeKind
  weight: number
  // Free-form provenance. Common fields:
  //   { reason: string, similarity?: number, source_workflow?: string }
  evidence: Record<string, unknown>
  created_at: string
}

/**
 * Stable label map for /admin/wiki edge rendering.
 */
export const MEMORY_EDGE_KIND_LABELS: Record<MemoryEdgeKind, string> = {
  derived_from: 'derived from',
  supersedes: 'supersedes',
  contradicts: 'contradicts',
  related_to: 'related to',
  cites: 'cites',
  see_also: 'see also',
}

// ---------------------------------------------------------------------------
// tenant_wiki_schema
// ---------------------------------------------------------------------------

export interface TenantWikiSchema {
  tenant_id: string
  body_md: string
  version: number
  updated_at: string
  updated_by?: string | null
  auto_revisions: number
}
