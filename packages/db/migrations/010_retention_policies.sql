-- =============================================================================
-- Migration 010: Retention policies + the table-name allowlist
-- =============================================================================
--
-- Phase 3 T1.3 — closes audit area A's retention gap (no job today purges
-- agent_events / outcome_events / transcripts / etc., so cleartext PII
-- accumulates forever — itself a GDPR breach risk).
--
-- This migration adds ONE table:
--
--   retention_policies — per-(tenant, table_name) override of the platform
--                         default retention window. Defaults live in TS at
--                         `packages/core/src/retention/defaults.ts` so a
--                         schema migration is not required to evolve them
--                         (the workflow reads defaults from code and the
--                         policy table only carries overrides).
--
-- IMPORTANT — `table_name` is a closed allowlist enforced via CHECK
-- constraint, NOT a free-form column. Adding a new retention target requires
-- both a TS defaults entry (for the platform default) and a migration entry
-- (to extend the allowlist). This is intentional: a misspelled or
-- attacker-supplied table_name should not result in a silent no-op or, worse,
-- a sweep of an unintended table. The retention-sweep workflow code branches
-- on these literal strings.
--
-- Per-tenant overrides may only LENGTHEN the retention window, never
-- shorten. Enforcement lives at the application layer
-- (`apps/web/src/app/api/admin/config/route.ts` retention-write handler)
-- because comparing against a code-side default is not expressible as a
-- DB CHECK constraint without duplicating the defaults map in SQL —
-- which would be a drift footgun. The `min_retention_days` baseline column
-- below records the platform default at write time so an audit query
-- (`SELECT WHERE retention_days < min_retention_days`) catches drift.
--
-- Hard ceiling: 7 years (2555 days) per OQ-4. Enforced via CHECK.
-- =============================================================================

CREATE TABLE IF NOT EXISTS retention_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Closed allowlist. Each value MUST have a matching entry in
  -- `RETENTION_DEFAULT_DAYS` (packages/core/src/retention/defaults.ts) AND
  -- a switch branch in the retention-sweep workflow handler. Add new values
  -- here, in defaults.ts, and in the workflow in the same PR.
  table_name VARCHAR(64) NOT NULL CHECK (
    table_name IN (
      'agent_events',
      'outcome_events',
      'attributions',
      'transcripts_raw_text',     -- column-level null at TTL (NOT row delete)
      'transcripts_summary',      -- row-level delete at TTL
      'ai_conversations',
      'ai_conversation_notes',
      'agent_citations',
      'webhook_deliveries'
    )
  ),

  -- Override window in days. CHECK enforces the floor (1 day — 0 would be
  -- "delete everything immediately") and the ceiling (7 years per OQ-4).
  retention_days INT NOT NULL CHECK (retention_days >= 1 AND retention_days <= 2555),

  -- Snapshot of the platform default at write time. The application-layer
  -- "longer-only" rule compares against the live default in code; this
  -- column is a tamper-evident record of what the floor was when the
  -- override landed. A nightly audit query
  --   SELECT * FROM retention_policies WHERE retention_days < min_retention_days
  -- catches drift if the code-side defaults change later.
  min_retention_days INT NOT NULL CHECK (min_retention_days >= 1),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tenant_id, table_name)
);

CREATE INDEX IF NOT EXISTS idx_retention_policies_tenant
  ON retention_policies (tenant_id);

CREATE TRIGGER retention_policies_updated_at BEFORE UPDATE ON retention_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON retention_policies
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
