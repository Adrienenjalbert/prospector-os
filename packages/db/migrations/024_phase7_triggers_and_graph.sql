-- =============================================================================
-- Migration 024: Phase 7 — Composite Triggers + Relationship Graph
-- =============================================================================
--
-- This migration implements three independent but co-shipped pieces of
-- Phase 7. See `wiki/pages/decisions/0003-composite-triggers.md` (when
-- written) and the Phase 7 plan for the architectural rationale.
--
-- ONE FIX, TWO NEW TABLE EXTENSIONS, ONE NEW TABLE:
--
--   1. signals.signal_type CHECK constraint widening — fixes a P0
--      contract-drift bug where Phase 5 transcript-signals + champion-
--      alumni-detector workflows have been writing rows that the
--      DB CHECK silently rejects. Once this lands, those previously-
--      failing inserts succeed and downstream slices start seeing
--      real data.
--   2. memory_edges.{src,dst}_kind extended to span the canonical
--      ontology (companies, contacts, opportunities), not just the
--      Phase 6 derived layer (memories, wiki_pages). Adds 4 new
--      edge kinds (bridges_to, coworked_with, alumni_of,
--      geographic_neighbor) for the relationship graph.
--   3. triggers — first-class typed composites of (signal × bridge ×
--      enrichment × time window). The "act now" event surface that
--      replaces the heuristic urgency_components scoring path with
--      explicit, debuggable, auditable rows.
--
-- Why all three in one migration:
--
-- The signal contract fix is a precondition for ANY Phase 7 mining
-- (the 4 currently-rejected types would block trigger composition).
-- The memory_edges extension is a precondition for the 3 connection
-- miners (Section 3.2). The triggers table is the destination for
-- the composite miner (Section 2.2). Splitting into 3 migrations
-- would require ordering across 3 cron ticks; bundling lets the
-- dispatcher fan out cleanly on the same night.
--
-- IDEMPOTENCY: ALTER TABLE IF EXISTS, CREATE TABLE IF NOT EXISTS,
-- DROP CONSTRAINT IF EXISTS. Re-running this migration is safe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. signals.signal_type CHECK widening (P0 fix)
-- ---------------------------------------------------------------------------
--
-- Audit (Phase 7 plan §1) found that:
--   - migration 009 set signal_type CHECK to the 8 ontology types
--   - apps/web/src/lib/workflows/transcript-signals.ts writes
--     'churn_risk', 'price_objection', 'champion_missing'
--   - apps/web/src/lib/workflows/champion-alumni-detector.ts writes
--     'champion_alumni'
--   - All 4 are silently rejected; the
--     champion-alumni-opportunities slice and transcript-signals
--     consumer have been reading empty result sets.
--
-- The Phase 7 additions (intent_topic, tech_stack_change, etc.) need
-- their slot in the same enum so the new adapters can land their
-- rows. Doing all of this in one widening keeps the schema honest.

ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_signal_type_check;
ALTER TABLE signals ADD CONSTRAINT signals_signal_type_check CHECK (signal_type IN (
  -- Phase 1-3 (existing 8, ontology.ts SignalType union)
  'hiring_surge',
  'funding',
  'leadership_change',
  'expansion',
  'temp_job_posting',
  'competitor_mention',
  'seasonal_peak',
  'negative_news',
  -- Phase 5 (currently silently rejected — fixed by this migration)
  'champion_alumni',     -- champion-alumni-detector workflow
  'churn_risk',          -- transcript-signals workflow
  'price_objection',     -- transcript-signals workflow
  'champion_missing',    -- transcript-signals workflow
  -- Phase 7 (new)
  'intent_topic',          -- topic-level B2B intent (Bombora-shaped, IntentDataAdapter)
  'tech_stack_change',     -- BuiltWith-shaped: vendor added/removed
  'job_change',            -- contact moved roles (LinkedIn SN / Apollo enrichPerson)
  'press_event',           -- news enrichment (Crunchbase News, Tavily)
  'tradeshow_attendance'   -- public conference rosters
));

COMMENT ON COLUMN signals.signal_type IS
  'Typed signal kind. The enum is the contract; new producers MUST add their type here OR the insert silently fails. Tracked across SignalType (ontology.ts), SignalTypeSchema (schemas.ts), and this CHECK — keep all three in sync.';

-- ---------------------------------------------------------------------------
-- 2. memory_edges: extend endpoints to span the canonical ontology
-- ---------------------------------------------------------------------------
--
-- Phase 6 (migration 022) restricted edges to {memory, wiki_page} —
-- only the derived layer. Phase 7 needs edges that span raw objects
-- so the relationship graph (bridges_to, coworked_with, alumni_of)
-- can manifest at the level the connection miners operate on.
--
-- We DO NOT add foreign keys for the new endpoint kinds because a
-- single edge can point at any of 5 tables (memory, wiki_page,
-- company, contact, opportunity). Polymorphic associations can't
-- have a single FK. Defence: every miner that writes an edge MUST
-- verify the target row exists at write time; lintWiki (Phase 6)
-- gets extended to garbage-collect orphan edges nightly.

ALTER TABLE memory_edges DROP CONSTRAINT IF EXISTS memory_edges_src_kind_check;
ALTER TABLE memory_edges DROP CONSTRAINT IF EXISTS memory_edges_dst_kind_check;
ALTER TABLE memory_edges DROP CONSTRAINT IF EXISTS memory_edges_edge_kind_check;

ALTER TABLE memory_edges ADD CONSTRAINT memory_edges_src_kind_check CHECK (
  src_kind IN ('memory', 'wiki_page', 'company', 'contact', 'opportunity')
);

ALTER TABLE memory_edges ADD CONSTRAINT memory_edges_dst_kind_check CHECK (
  dst_kind IN ('memory', 'wiki_page', 'company', 'contact', 'opportunity')
);

ALTER TABLE memory_edges ADD CONSTRAINT memory_edges_edge_kind_check CHECK (edge_kind IN (
  -- Phase 6 (existing)
  'derived_from',     -- compilation provenance: wiki_page derived_from atoms
  'supersedes',       -- newer replaces older
  'contradicts',      -- pair flagged by lint; never auto-resolved
  'related_to',       -- soft semantic link
  'cites',            -- explicit URN reference in body
  'see_also',         -- editorial link
  -- Phase 7 (new — relationship graph)
  'bridges_to',         -- company A bridges to company B via shared connection
  'coworked_with',      -- contact A coworked with contact B at company X
  'alumni_of',          -- contact attended school X
  'geographic_neighbor' -- companies within 50km
));

COMMENT ON COLUMN memory_edges.src_kind IS
  'Endpoint type. Extended in migration 024 (Phase 7) to span the canonical ontology — not just the Phase 6 derived layer. NO foreign key because of polymorphism; lintWiki garbage-collects orphan rows nightly.';

-- ---------------------------------------------------------------------------
-- 2b. wiki_pages.kind: add entity_company_neighbourhood (Section 3.5)
-- ---------------------------------------------------------------------------
--
-- compileWikiPages gets one new clustering rule (Phase 7 §3.5):
-- when a company accumulates >=3 inbound bridges_to edges, compile
-- a per-company neighbourhood page that narrates the warm-path
-- constellation around the account. The bridge-opportunities slice
-- reads this page first, falls back to raw edges as cold-start.

ALTER TABLE wiki_pages DROP CONSTRAINT IF EXISTS wiki_pages_kind_check;
ALTER TABLE wiki_pages ADD CONSTRAINT wiki_pages_kind_check CHECK (kind IN (
  -- Phase 6 (existing 12)
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
  'index_root',
  -- Phase 7 (Section 3.5)
  'entity_company_neighbourhood'
));

-- Index supporting the inbound-bridge lookup pattern that
-- bridge-opportunities slice + find_warm_intros tool use:
-- "give me all bridges_to edges where dst_kind='company' AND dst_id=:active_company".
-- The existing idx_memory_edges_dst already covers (tenant_id, dst_kind, dst_id),
-- so no new index is needed for that path.
-- For triangle queries (3-way joins), we add a covering index that
-- includes edge_kind so the planner doesn't have to scan all kinds.
CREATE INDEX IF NOT EXISTS idx_memory_edges_dst_kind_typed
  ON memory_edges (tenant_id, dst_kind, edge_kind, dst_id);

-- ---------------------------------------------------------------------------
-- 3. triggers — first-class composite "act now" events
-- ---------------------------------------------------------------------------
--
-- Today urgency is heuristic (composite-scorer.ts deriveUrgency:
-- count + recency + 1 type check). There is NO row that says "this
-- account has a buying trigger right now"; the rep has to mentally
-- assemble (signal_score + urgency + bridge + tier) into a decision.
--
-- Adoption-research mistake #2 ("adding cognitive load instead of
-- removing it") is the strongest argument for first-classing this:
-- the trigger row IS the smaller decision the rep should land on.
--
-- Each trigger:
--   - is keyed by a typed `pattern` (closed enum so a typo can't ship
--     a row no slice filters on)
--   - lists its `components` (signal ids, bridge edge ids, contact
--     ids that produced the match) so /admin/triggers can render the
--     chain end-to-end and so attribution can correlate the trigger
--     with downstream outcomes
--   - carries a Beta posterior (prior_alpha/beta) — same shape as
--     tenant_memories so the bandit math extracts cleanly into a
--     shared lib/bandit/beta.ts in Phase 7 §2.3
--   - has a lifecycle: open → acted | expired | dismissed

CREATE TABLE IF NOT EXISTS triggers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Optional FKs — most triggers are anchored to a company; some
  -- (e.g. tradeshow_cluster) span N companies and store the list in
  -- components instead.
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,

  -- Closed enum. Each value has its own SQL pattern matcher in
  -- mineCompositeTriggers (Phase 7 §2.2). Adding a pattern = adding
  -- one matcher + one enum value here.
  pattern VARCHAR(60) NOT NULL CHECK (pattern IN (
    'funding_plus_leadership_window',  -- funding + leadership_change <= 90d apart
    'warm_path_at_active_buyer',       -- inbound bridges_to + recent intent_topic
    'hot_lookalike_in_market',         -- tech_stack overlap with win + competitor_mention
    'multi_bridge_to_target',          -- 3+ bridges_to converging on one company
    'job_change_at_existing_account',  -- internal mover at a company we sell to
    'tradeshow_cluster',               -- N target accounts at same upcoming event
    'tech_stack_competitor_swap'       -- removed competitor; added complementary tech
  )),

  -- Provenance. Every trigger carries the URNs / IDs that produced
  -- the match so /admin/triggers can show "VP Eng joined 21d ago
  -- after Series B" with cited links to the underlying rows.
  -- Convention:
  --   { signals: [<uuid>], bridges: [<edge_id>], contacts: [<uuid>],
  --     companies: [<uuid>], opportunities: [<uuid>] }
  components JSONB NOT NULL DEFAULT '{}',

  -- Composite score 0..1 weighted by component recency + confidence.
  -- The priority queue uses >= 0.7 as the tier-1 cutoff (Phase 7 §2.4).
  trigger_score NUMERIC(3, 2) NOT NULL DEFAULT 0.5,

  -- Single agent-facing rationale (≤200 chars). Written by Sonnet
  -- via mineCompositeTriggers — the ONLY LLM call in the trigger
  -- pipeline; the matching itself is deterministic SQL.
  rationale TEXT NOT NULL,

  -- Recommended next step. recommended_tool maps to a registered
  -- agent tool slug (e.g. 'draft_alumni_intro') so the agent can
  -- chain trigger → tool invocation in one turn.
  recommended_action TEXT,
  recommended_tool VARCHAR(60),

  -- Lifecycle. Mirrors tenant_memories shape so the bandit math
  -- ports across.
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN (
    'open',       -- surfaced in priority queue + trigger-now slice
    'acted',      -- rep invoked the recommended_tool OR outcome correlates
    'expired',    -- window passed without action (lintTriggers daily)
    'dismissed'   -- explicit kill via /admin/triggers
  )),

  -- Per-trigger Beta posterior. acted = success; expired = failure.
  -- Same Beta(1,1) start as tenant_memories.
  prior_alpha NUMERIC NOT NULL DEFAULT 1,
  prior_beta  NUMERIC NOT NULL DEFAULT 1,

  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Each pattern has a natural lifespan. funding_plus_leadership =
  -- 60d; tradeshow_cluster = until event_date; etc. Set by the miner.
  expires_at TIMESTAMPTZ,
  acted_at TIMESTAMPTZ,
  acted_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  -- Attribution: which outcome event closed the loop. Set by
  -- attribution workflow when an outcome arrives within 14d of acted_at.
  acted_outcome_event_id UUID,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hot lookup paths.
-- Open triggers ordered by score — the trigger-now slice + queue.
CREATE INDEX IF NOT EXISTS idx_triggers_open
  ON triggers (tenant_id, status, trigger_score DESC)
  WHERE status = 'open';

-- Per-company triggers — /admin/wiki/[id] page detail + slice anchored on company.
CREATE INDEX IF NOT EXISTS idx_triggers_company
  ON triggers (tenant_id, company_id, status);

-- Per-pattern aggregation — reflectMemories weekly observation.
CREATE INDEX IF NOT EXISTS idx_triggers_pattern_recent
  ON triggers (tenant_id, pattern, detected_at DESC);

-- Idempotency check — mineCompositeTriggers uses a natural key
-- (pattern + earliest component id) to avoid double-inserting on
-- re-runs. We index it as a partial unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_triggers_natural_key
  ON triggers (tenant_id, pattern, ((components->>'natural_key')))
  WHERE components ? 'natural_key';

ALTER TABLE triggers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON triggers;
CREATE POLICY "tenant_isolation" ON triggers
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

COMMENT ON TABLE triggers IS
  'First-class typed composite "act now" events. Each row is one (signal × bridge × enrichment × time window) match. Replaces heuristic urgency scoring with explicit, auditable, single-decision rows. Lifecycle: open → acted | expired | dismissed. Beta posterior tracks per-pattern conversion; reflectMemories weekly observes which patterns work per tenant.';
