-- =============================================================================
-- Migration 021: tenant_memories — typed, citation-backed, per-tenant memory
-- =============================================================================
--
-- The smart memory layer's substrate. Every nightly miner (derive-icp,
-- mine-personas, mine-themes, mine-competitor-plays, mine-glossary,
-- derive-sales-motion, mine-rep-playbook, mine-stage-best-practice) writes
-- typed rows here. The packer reads them through context slices
-- (icp-snapshot, persona-library, win-loss-themes, …) so the agent gets
-- per-tenant grounding without bespoke prompt engineering.
--
-- Invariants enforced at the schema level:
--   - `kind` is a closed enum so a typo can't ship a "won_themes" row
--     that's invisible to slices that filter by `win_theme`.
--   - `evidence` is NOT NULL — cite-or-shut-up applies at write time.
--   - `embedding` is optional; the embeddings cron fills it lazily so
--     mining workflows aren't blocked on the embed-API budget.
--   - `status` defaults to `proposed`; only the approval API
--     (POST /api/admin/memory/[id]) flips it to approved / pinned, and
--     every transition lands in `calibration_ledger` for audit + rollback.
--
-- pgvector is enabled by migration 002 (transcripts.embedding) and
-- already-extended by migration 020 (companies/signals/notes/skills).
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Domain category. Each kind has its own miner workflow + (eventually)
  -- its own context slice. New kinds need a new mining workflow + a
  -- new slice + a CHECK addition here — three deliberate touchpoints.
  kind VARCHAR(40) NOT NULL CHECK (kind IN (
    'icp_pattern',
    'persona',
    'win_theme',
    'loss_theme',
    'competitor_play',
    'glossary_term',
    'motion_step',
    'rep_playbook',
    'stage_best_practice'
  )),

  -- Scope axes the slice selector + retrieval RPC filter on. Examples:
  --   { industry: 'logistics' }                — ICP / persona patterns
  --   { persona_role: 'director_ops' }         — persona memories
  --   { stage: 'proposal', segment: 'mid' }    — motion / stage memories
  --   { competitor: 'workday' }                — competitor plays
  --   { rep_id: '<uuid>' }                     — per-rep playbook
  -- Empty `{}` is valid for tenant-wide memories like glossary terms.
  scope JSONB NOT NULL DEFAULT '{}',

  -- Human-readable headline + body. Both surfaced into the prompt; both
  -- shown on /admin/memory. Kept VARCHAR / TEXT so the miner doesn't
  -- need a separate translation step.
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,

  -- Provenance — non-negotiable. Every mining workflow includes the
  -- urns it derived this memory from so /admin/memory can show "this
  -- pattern was learned from these 12 won deals" with deep links.
  evidence JSONB NOT NULL DEFAULT '{}',

  -- 0..1; the miner's confidence given sample size + signal strength.
  -- Slices use this for ranking when ties on similarity. < 0.4 surfaces
  -- as "low confidence" in the admin UI.
  confidence NUMERIC(3, 2) NOT NULL DEFAULT 0.5,

  -- Filled by the embeddings cron (cron/embeddings + a new pipeline
  -- for memories) so the slice can call the match_memories RPC.
  embedding VECTOR(1536),
  embedding_updated_at TIMESTAMPTZ,

  -- Bandit prior on "useful when injected". Updated by the response_finished
  -- handler whenever a memory's URN is referenced in the assistant text.
  -- Defaults are uniform Beta(1,1) so cold-start memories aren't penalised.
  prior_alpha NUMERIC NOT NULL DEFAULT 1,
  prior_beta  NUMERIC NOT NULL DEFAULT 1,

  -- Lifecycle. Only `approved` and `pinned` are eligible for injection.
  -- Consolidation (Phase 6 in the wider plan; not Phase 1) flips weak /
  -- contradicted rows to `archived` or `superseded`.
  status VARCHAR(20) NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed', 'approved', 'pinned', 'archived', 'superseded'
  )),

  source_workflow VARCHAR(50) NOT NULL,
  derived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  superseded_by UUID REFERENCES tenant_memories(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hot lookup paths. The slice selector hits (tenant, kind, status) on
-- every load; the embeddings cron hits (tenant, embedding IS NULL); the
-- /admin/memory page hits (tenant, status, derived_at DESC).
CREATE INDEX IF NOT EXISTS idx_tenant_memories_lookup
  ON tenant_memories (tenant_id, kind, status);

CREATE INDEX IF NOT EXISTS idx_tenant_memories_industry
  ON tenant_memories (tenant_id, kind, ((scope ->> 'industry')))
  WHERE status IN ('approved', 'pinned');

CREATE INDEX IF NOT EXISTS idx_tenant_memories_recent
  ON tenant_memories (tenant_id, derived_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_memories_pending
  ON tenant_memories (tenant_id, status, derived_at DESC)
  WHERE status = 'proposed';

CREATE INDEX IF NOT EXISTS idx_tenant_memories_embed_pending
  ON tenant_memories (tenant_id)
  WHERE embedding IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_memories_embedding
  ON tenant_memories USING hnsw (embedding vector_cosine_ops);

ALTER TABLE tenant_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON tenant_memories
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- match_memories RPC
-- ---------------------------------------------------------------------------
-- Same shape as match_companies / match_notes from migration 020. Returns
-- the top-K memories for a tenant by cosine similarity, optionally filtered
-- by kind(s) and an industry scope facet. Status is fixed to approved /
-- pinned — the agent never sees `proposed` rows directly.
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding VECTOR(1536),
  match_tenant_id UUID,
  match_kinds TEXT[] DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.55,
  match_count INT DEFAULT 5,
  filter_industry TEXT DEFAULT NULL,
  filter_persona_role TEXT DEFAULT NULL,
  filter_competitor TEXT DEFAULT NULL,
  filter_stage TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  kind TEXT,
  title TEXT,
  body TEXT,
  scope JSONB,
  evidence JSONB,
  confidence NUMERIC,
  similarity FLOAT
) AS $$
  SELECT
    m.id,
    m.kind::TEXT,
    m.title::TEXT,
    m.body,
    m.scope,
    m.evidence,
    m.confidence,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM tenant_memories m
  WHERE m.tenant_id = match_tenant_id
    AND m.embedding IS NOT NULL
    AND m.status IN ('approved', 'pinned')
    AND (match_kinds IS NULL OR m.kind = ANY (match_kinds))
    AND (filter_industry IS NULL OR m.scope ->> 'industry' = filter_industry)
    AND (filter_persona_role IS NULL OR m.scope ->> 'persona_role' = filter_persona_role)
    AND (filter_competitor IS NULL OR m.scope ->> 'competitor' = filter_competitor)
    AND (filter_stage IS NULL OR m.scope ->> 'stage' = filter_stage)
    AND 1 - (m.embedding <=> query_embedding) >= match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE SQL STABLE;
