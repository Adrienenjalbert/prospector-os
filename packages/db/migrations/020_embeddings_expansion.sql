-- =============================================================================
-- Migration 020: pgvector embedding expansion (C5.1)
-- =============================================================================
--
-- Five new embedding pipelines unlock real RAG across the ontology.
-- Today only `transcripts.embedding` exists; everywhere else the agent
-- uses recency SQL or LIKE patterns, which is the single largest
-- "smart system" gap the strategic review identified.
--
-- Five tables get embeddings:
--   1. companies          — semantic firmographic + activity match
--   2. signals            — semantic signal-similarity for urgency
--                           rules ("competitor mention" without an
--                           exact-string match)
--   3. relationship_notes — top-5-by-relevance instead of recency
--   4. business_skills    — exemplar retrieval (after exemplar miner
--                           promotion of `(role, intent_class)` rows)
--   5. framework_chunks   — chunk-level sales-framework retrieval so
--                           `consult_sales_framework` returns 2 chunks
--                           (not the whole 5k-token framework markdown)
--
-- All five use HNSW indexes (cheaper to build + query than IVFFlat at
-- our scale) on cosine-distance operator (`<=>`).
--
-- Each table also gets a `match_<name>` Supabase RPC that returns the
-- top-K rows by similarity. The agent runtime (C5.2) calls these
-- RPCs from new RAG slices.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION — re-running this migration is safe.
-- =============================================================================

-- pgvector extension is already enabled via 002 (transcripts).

-- ---------------------------------------------------------------------------
-- 1. companies.embedding
-- ---------------------------------------------------------------------------
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1536),
  ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS embedding_content_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_companies_embedding
  ON companies USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION match_companies(
  query_embedding VECTOR(1536),
  match_tenant_id UUID,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  industry TEXT,
  similarity FLOAT
) AS $$
  SELECT
    c.id,
    c.name,
    c.industry,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM companies c
  WHERE c.tenant_id = match_tenant_id
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE SQL STABLE;

-- ---------------------------------------------------------------------------
-- 2. signals.embedding
-- ---------------------------------------------------------------------------
ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1536),
  ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_signals_embedding
  ON signals USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION match_signals(
  query_embedding VECTOR(1536),
  match_tenant_id UUID,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5,
  filter_signal_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  company_id UUID,
  signal_type TEXT,
  title TEXT,
  similarity FLOAT
) AS $$
  SELECT
    s.id,
    s.company_id,
    s.signal_type::TEXT,
    s.title::TEXT,
    1 - (s.embedding <=> query_embedding) AS similarity
  FROM signals s
  WHERE s.tenant_id = match_tenant_id
    AND s.embedding IS NOT NULL
    AND (filter_signal_type IS NULL OR s.signal_type = filter_signal_type)
    AND 1 - (s.embedding <=> query_embedding) >= match_threshold
  ORDER BY s.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE SQL STABLE;

-- ---------------------------------------------------------------------------
-- 3. relationship_notes.embedding
-- ---------------------------------------------------------------------------
-- Some installs use `relationship_notes`; a few have `notes`. Skip
-- gracefully if the table doesn't exist — an admin can re-run when
-- the table lands.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'relationship_notes') THEN
    EXECUTE 'ALTER TABLE relationship_notes ADD COLUMN IF NOT EXISTS embedding VECTOR(1536)';
    EXECUTE 'ALTER TABLE relationship_notes ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_relationship_notes_embedding ON relationship_notes USING hnsw (embedding vector_cosine_ops)';
  END IF;
END $$;

-- match_notes: only created when relationship_notes exists (safe re-run pattern)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'relationship_notes') THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION match_notes(
        query_embedding VECTOR(1536),
        match_tenant_id UUID,
        match_threshold FLOAT DEFAULT 0.7,
        match_count INT DEFAULT 5,
        filter_company_id UUID DEFAULT NULL
      )
      RETURNS TABLE (
        id UUID,
        company_id UUID,
        contact_id UUID,
        body TEXT,
        similarity FLOAT
      ) AS $body$
        SELECT
          n.id,
          n.company_id,
          n.contact_id,
          n.body::TEXT,
          1 - (n.embedding <=> query_embedding) AS similarity
        FROM relationship_notes n
        WHERE n.tenant_id = match_tenant_id
          AND n.embedding IS NOT NULL
          AND (filter_company_id IS NULL OR n.company_id = filter_company_id)
          AND 1 - (n.embedding <=> query_embedding) >= match_threshold
        ORDER BY n.embedding <=> query_embedding
        LIMIT match_count;
      $body$ LANGUAGE SQL STABLE;
    $func$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. business_skills.embedding (for exemplars rows specifically)
-- ---------------------------------------------------------------------------
ALTER TABLE business_skills
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1536),
  ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_business_skills_embedding
  ON business_skills USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION match_exemplars(
  query_embedding VECTOR(1536),
  match_tenant_id UUID,
  match_threshold FLOAT DEFAULT 0.6,
  match_count INT DEFAULT 3
)
RETURNS TABLE (
  id UUID,
  skill_type TEXT,
  content_text TEXT,
  similarity FLOAT
) AS $$
  SELECT
    bs.id,
    bs.skill_type::TEXT,
    bs.content_text::TEXT,
    1 - (bs.embedding <=> query_embedding) AS similarity
  FROM business_skills bs
  WHERE bs.tenant_id = match_tenant_id
    AND bs.embedding IS NOT NULL
    AND bs.active = TRUE
    AND 1 - (bs.embedding <=> query_embedding) >= match_threshold
  ORDER BY bs.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE SQL STABLE;

-- ---------------------------------------------------------------------------
-- 5. framework_chunks (new table) for chunk-level framework retrieval
-- ---------------------------------------------------------------------------
-- Sales frameworks (16 of them) are big markdown docs. Today
-- consult_sales_framework returns the whole framework — ~5k tokens.
-- Chunked + embedded, the agent fetches the most relevant 1-2
-- sections per call (~500 tokens). Reduces consult-call token
-- spend by ~80% with no quality loss.
CREATE TABLE IF NOT EXISTS framework_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  framework_slug VARCHAR(50) NOT NULL,
  section VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  embedding VECTOR(1536),
  embedding_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Chunk content is identical for every tenant (same global
  -- frameworks), so we dedupe by (slug, section, hash). Tenant_id
  -- is intentionally absent — these are platform-wide reference
  -- chunks. RLS-exempt for the same reason.
  UNIQUE (framework_slug, section, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_framework_chunks_slug
  ON framework_chunks (framework_slug);
CREATE INDEX IF NOT EXISTS idx_framework_chunks_embedding
  ON framework_chunks USING hnsw (embedding vector_cosine_ops);

-- framework_chunks is platform-wide reference data; no RLS.
-- (The validator allowlist excludes it via the same pattern as model_pricing.)

CREATE OR REPLACE FUNCTION match_framework_chunks(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.6,
  match_count INT DEFAULT 2,
  filter_framework_slug VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  framework_slug VARCHAR,
  section VARCHAR,
  content TEXT,
  similarity FLOAT
) AS $$
  SELECT
    fc.id,
    fc.framework_slug,
    fc.section,
    fc.content,
    1 - (fc.embedding <=> query_embedding) AS similarity
  FROM framework_chunks fc
  WHERE fc.embedding IS NOT NULL
    AND (filter_framework_slug IS NULL OR fc.framework_slug = filter_framework_slug)
    AND 1 - (fc.embedding <=> query_embedding) >= match_threshold
  ORDER BY fc.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE SQL STABLE;
