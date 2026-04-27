-- =============================================================================
-- Migration 022: Wiki layer (Phase 6 — Two-Level Second Brain)
-- =============================================================================
--
-- This migration implements the per-tenant wiki layer that compiles
-- `tenant_memories` atoms into navigable, interlinked wiki pages.
-- See `wiki/pages/decisions/0002-two-level-second-brain.md` for the
-- decision rationale and `wiki/pages/projects/phase-6-second-brain.md`
-- for the project status board.
--
-- THREE NEW TABLES, TWO TABLE MUTATIONS, ONE NEW RPC:
--
--   1. wiki_pages — compiled, interlinked markdown pages with YAML
--      frontmatter, [[wikilinks]], and inline urn:rev citations. One
--      page per entity / concept / playbook. Pages are what slices
--      read first; atoms are the fallback for cold-start tenants.
--   2. memory_edges — typed graph relationships between atoms and
--      pages. Used for backlinks, contradictions, supersession,
--      compilation provenance.
--   3. tenant_wiki_schema — per-tenant `CLAUDE.md` content. The
--      compileWikiPages workflow loads this into the system prompt
--      so each tenant's brain is shaped by its own conventions.
--   4. tenant_memories: + embedding_content_hash, + decay_score,
--      + notes columns; CHECK constraint extended to include
--      'reflection' kind for the weekly reflectMemories workflow.
--   5. match_wiki_pages RPC — cosine similarity over wiki_pages
--      embeddings, mirroring match_memories.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION. Re-running
-- this migration is safe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. tenant_memories: extend for embedding idempotency, decay, notes,
--    and the new 'reflection' kind.
-- ---------------------------------------------------------------------------
--
-- embedding_content_hash mirrors the companies pipeline pattern: re-
-- embedding the same text short-circuits with no API call. Without
-- this, runMemoriesEmbedder would re-embed every approved/pinned row
-- on every cron tick.
--
-- decay_score is the Ebbinghaus-style retention factor maintained by
-- consolidateMemories nightly. 1.0 = freshly derived; < 0.2 = stale
-- and (if proposed) auto-archived.
--
-- notes is a free-form audit trail for automated transitions:
-- 'auto_decayed', 'auto_promoted', 'auto_superseded'. /admin/memory
-- surfaces it in the row detail.
--
-- The 'reflection' kind unlocks reflectMemories weekly to write
-- cross-deal observations as proper memory atoms (in addition to a
-- reflection_weekly wiki page).

ALTER TABLE tenant_memories
  ADD COLUMN IF NOT EXISTS embedding_content_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS decay_score NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Drop and re-create the kind CHECK constraint to include 'reflection'.
-- Postgres doesn't support ALTER ... CHECK in place; we drop the
-- constraint by name (auto-generated as `tenant_memories_kind_check`)
-- and add a fresh one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'tenant_memories_kind_check'
  ) THEN
    ALTER TABLE tenant_memories DROP CONSTRAINT tenant_memories_kind_check;
  END IF;
END $$;

ALTER TABLE tenant_memories
  ADD CONSTRAINT tenant_memories_kind_check CHECK (kind IN (
    'icp_pattern',
    'persona',
    'win_theme',
    'loss_theme',
    'competitor_play',
    'glossary_term',
    'motion_step',
    'rep_playbook',
    'stage_best_practice',
    'reflection'
  ));

-- Decay-aware index helps consolidateMemories find decayed-but-not-
-- yet-archived rows in O(log n) without a full scan.
CREATE INDEX IF NOT EXISTS idx_tenant_memories_decay
  ON tenant_memories (tenant_id, decay_score)
  WHERE status IN ('proposed', 'approved');

-- ---------------------------------------------------------------------------
-- 1. wiki_pages — the compiled wiki layer
-- ---------------------------------------------------------------------------
--
-- One row per compiled wiki page. The compileWikiPages workflow
-- writes these nightly by clustering atoms per entity (industry,
-- persona role, competitor, stage) and asking Sonnet to compile a
-- dense markdown page with YAML frontmatter and [[wikilinks]].
--
-- Pages are what agent slices read FIRST. Atoms are the fallback for
-- cold-start tenants (first 7 days, before the first compile).
--
-- Per the Wiki v2 lessons in `wiki/pages/sources/llm-wiki-v2.md`,
-- pages carry the lifecycle metadata atoms have:
--   - confidence  (weighted mean of source atom confidences, capped)
--   - decay_score (Ebbinghaus, half_life=120d for pages)
--   - status      (draft/published/pinned/archived/superseded)
--   - prior_alpha/beta (Beta posterior, updated by memory_cited events)
--   - superseded_by (page-to-page replacement)

CREATE TABLE IF NOT EXISTS wiki_pages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Page kind. Enum kept narrow — every kind has either a
  -- compileWikiPages clustering rule or a workflow that writes it
  -- (reflection_weekly, log_session). New kinds need a deliberate
  -- update here + in compileWikiPages.
  kind VARCHAR(40) NOT NULL CHECK (kind IN (
    'entity_industry',
    'entity_persona',
    'entity_competitor',
    'entity_stage',
    'concept_motion',
    'concept_icp',
    'concept_glossary',
    'playbook_rep',
    'playbook_stage',
    'reflection_weekly',
    'log_session',
    'index_root'
  )),

  -- URL-safe handle. (tenant_id, kind, slug) is unique. Examples:
  -- 'manufacturing', 'champion-vp-rd', 'workday', '2026-W17'.
  slug VARCHAR(80) NOT NULL,

  -- Human-readable. Surfaced in /admin/wiki and in the agent's
  -- rendered markdown when the page is loaded by a slice.
  title VARCHAR(200) NOT NULL,

  -- Compiled markdown body with [[wikilinks]] and inline `urn:rev:`
  -- citations. The agent injects this directly into its prompt; the
  -- citation pill UI parses inline URNs.
  body_md TEXT NOT NULL,

  -- YAML frontmatter as structured JSON. Examples of fields:
  --   { kind, scope, source_atoms, confidence, last_compiled_at,
  --     compiler_version, quality_score, lint_warnings: [] }
  -- The export endpoint (Section 4.1) reconstructs YAML from this.
  frontmatter JSONB NOT NULL DEFAULT '{}',

  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'published', 'pinned', 'archived', 'superseded'
  )),

  -- Lifecycle scoring. confidence comes from compile (weighted mean
  -- of source atom confidences, capped). decay_score from lintWiki
  -- (Ebbinghaus, half_life=120d). prior_alpha/beta from the
  -- per-page bandit (memory_cited / wiki_page_cited events).
  confidence NUMERIC(3, 2) NOT NULL DEFAULT 0.5,
  decay_score NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
  prior_alpha NUMERIC NOT NULL DEFAULT 1,
  prior_beta  NUMERIC NOT NULL DEFAULT 1,

  -- Compilation provenance. source_atoms is the array of
  -- tenant_memories.id values this page was compiled from. The hash
  -- of (sorted source_atoms + max(updated_at)) is what lets
  -- compileWikiPages skip unchanged pages on re-run.
  source_atoms UUID[] NOT NULL DEFAULT '{}',
  source_atoms_hash VARCHAR(64),
  last_compiled_at TIMESTAMPTZ,
  compiler_version VARCHAR(40),

  -- Supersession (Wiki v2 lifecycle). When lintWiki detects a page
  -- that has been replaced by a newer / higher-confidence page, the
  -- loser's superseded_by points at the winner. The page is kept for
  -- history but slices stop loading it.
  superseded_by UUID REFERENCES wiki_pages(id),

  -- Embedding for match_wiki_pages RPC. The same content-hash
  -- pattern as tenant_memories so re-embedding is idempotent.
  embedding VECTOR(1536),
  embedding_content_hash VARCHAR(64),
  embedding_updated_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (tenant_id, kind, slug)
);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_lookup
  ON wiki_pages (tenant_id, kind, status);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_recent
  ON wiki_pages (tenant_id, last_compiled_at DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_embed_pending
  ON wiki_pages (tenant_id)
  WHERE embedding IS NULL;

CREATE INDEX IF NOT EXISTS idx_wiki_pages_embedding
  ON wiki_pages USING hnsw (embedding vector_cosine_ops);

ALTER TABLE wiki_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON wiki_pages;
CREATE POLICY "tenant_isolation" ON wiki_pages
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 2. memory_edges — the typed graph
-- ---------------------------------------------------------------------------
--
-- One row per typed relationship between atoms and pages. Bidirectional
-- queries (backlinks, "what cites this?") use the dst_idx; outbound
-- queries ("what does this point at?") use the src_idx.
--
-- Edge kinds (the only enum allowed):
--   derived_from — page → atom (compilation provenance)
--   supersedes   — newer → older (supersession trail)
--   contradicts  — pair flagged by lint; never auto-resolved
--   related_to   — soft semantic link (extracted on edge_proposal)
--   cites        — explicit URN reference in body_md
--   see_also     — editorial link (humans can add via /admin/wiki)
--
-- src_kind / dst_kind constrain endpoints to either 'memory' or
-- 'wiki_page'. Cross-tenant edges are impossible: tenant_id is
-- enforced and the UNIQUE constraint includes it.

CREATE TABLE IF NOT EXISTS memory_edges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  src_kind VARCHAR(20) NOT NULL CHECK (src_kind IN ('memory', 'wiki_page')),
  src_id UUID NOT NULL,
  dst_kind VARCHAR(20) NOT NULL CHECK (dst_kind IN ('memory', 'wiki_page')),
  dst_id UUID NOT NULL,
  edge_kind VARCHAR(20) NOT NULL CHECK (edge_kind IN (
    'derived_from', 'supersedes', 'contradicts', 'related_to', 'cites', 'see_also'
  )),
  weight NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
  -- Free-form provenance: the LLM call's reasoning, the workflow
  -- name, similarity score, etc. Audit trail for /admin/wiki.
  evidence JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, src_kind, src_id, dst_kind, dst_id, edge_kind)
);

CREATE INDEX IF NOT EXISTS idx_memory_edges_src
  ON memory_edges (tenant_id, src_kind, src_id);
CREATE INDEX IF NOT EXISTS idx_memory_edges_dst
  ON memory_edges (tenant_id, dst_kind, dst_id);
CREATE INDEX IF NOT EXISTS idx_memory_edges_kind
  ON memory_edges (tenant_id, edge_kind);

ALTER TABLE memory_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON memory_edges;
CREATE POLICY "tenant_isolation" ON memory_edges
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. tenant_wiki_schema — the per-tenant CLAUDE.md
-- ---------------------------------------------------------------------------
--
-- One row per tenant. Contains the "schema doc" the compileWikiPages
-- workflow loads into its system prompt — Karpathy's "schema is the
-- product" rule, applied per-tenant. Bootstrapped on tenant create
-- from a template; co-evolved by the auto-revision proposer.
--
-- Versioning is monotonic. The full body_md is overwritten on each
-- save (no diff history); auto_revisions counts how many times the
-- LLM proposed a change and admins approved it.

CREATE TABLE IF NOT EXISTS tenant_wiki_schema (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  body_md TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES user_profiles(id),
  auto_revisions INT NOT NULL DEFAULT 0
);

ALTER TABLE tenant_wiki_schema ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON tenant_wiki_schema;
CREATE POLICY "tenant_isolation" ON tenant_wiki_schema
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 4. match_wiki_pages RPC
-- ---------------------------------------------------------------------------
-- Mirrors match_memories. Returns top-K wiki_pages by cosine
-- similarity, filtered to published/pinned only (drafts are
-- pre-publication; archived/superseded are out of band).
-- Optional kind filter for slices that want only concept_icp pages,
-- only entity_persona pages, etc.

CREATE OR REPLACE FUNCTION match_wiki_pages(
  query_embedding VECTOR(1536),
  match_tenant_id UUID,
  match_kinds TEXT[] DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.55,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  kind TEXT,
  slug TEXT,
  title TEXT,
  body_md TEXT,
  frontmatter JSONB,
  confidence NUMERIC,
  decay_score NUMERIC,
  similarity FLOAT
) AS $$
  SELECT
    p.id,
    p.kind::TEXT,
    p.slug::TEXT,
    p.title::TEXT,
    p.body_md,
    p.frontmatter,
    p.confidence,
    p.decay_score,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM wiki_pages p
  WHERE p.tenant_id = match_tenant_id
    AND p.embedding IS NOT NULL
    AND p.status IN ('published', 'pinned')
    AND (match_kinds IS NULL OR p.kind = ANY (match_kinds))
    AND 1 - (p.embedding <=> query_embedding) >= match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE SQL STABLE;
