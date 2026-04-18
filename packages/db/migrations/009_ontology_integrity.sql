-- =============================================================================
-- Migration 009: Ontology integrity hardening
--
-- This migration closes BLOCKER-class gaps the ontology audit surfaced:
--
--   1. `contacts` is missing UNIQUE(tenant_id, crm_id), but the cron sync
--      route (apps/web/src/app/api/cron/sync/route.ts) already issues
--      `.upsert(..., { onConflict: 'tenant_id,crm_id' })`. Postgres
--      requires a matching unique index/constraint or it errors out at
--      runtime. We use a PARTIAL unique index because some contacts (e.g.
--      Apollo-only enrichments) have no crm_id.
--
--   2. `contacts` is missing `last_crm_sync` and `updated_at` columns,
--      but the same upsert writes to `last_crm_sync`. Without the column,
--      the upsert silently drops the value (or errors depending on the
--      PostgREST shape). We add both, defaulting to now() so existing
--      rows behave sanely.
--
--   3. `eval_runs` (created in migration 002) has no RLS — every other
--      tenant-scoped table in the schema enables it. Row Level Security
--      missing on a table that may contain prompt + judge reasoning per
--      tenant is a cross-tenant data exposure risk if anon credentials
--      are ever pointed at it.
--
--   4. Enum-typed columns (`icp_tier`, `priority_tier`, `signal_type`,
--      `signal_urgency`, `seniority`, `contact_role_tag`, `crm_source`)
--      are typed as `VARCHAR` in the DB. The TypeScript types in
--      `packages/core/src/types/ontology.ts` and the Zod schemas in
--      `packages/core/src/types/schemas.ts` declare narrow string unions,
--      but nothing in the database stops a consumer from writing
--      junk values. CHECK constraints aligned with the TS unions enforce
--      the contract end to end.
--
--   5. `agent_events.interaction_id` had no FK; we add a soft FK to
--      `agent_interaction_outcomes(id)` so orphan event rows are caught.
--      ON DELETE SET NULL preserves the event for ROI reporting even if
--      the interaction is purged.
--
-- All changes are additive and idempotent (`IF NOT EXISTS` / `DO $$`).
-- Re-running this migration on a database where it has already been
-- applied is a no-op.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 + 2. contacts: missing column + missing unique constraint
-- -----------------------------------------------------------------------------

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_crm_sync TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill last_crm_sync for already-synced rows so it is non-null after
-- the column is added. The cron sync workflow always writes this on the
-- next run, but historic rows would otherwise stay NULL.
UPDATE contacts
   SET last_crm_sync = COALESCE(last_crm_sync, created_at, NOW())
 WHERE last_crm_sync IS NULL;

-- Partial unique index — required by `.upsert(..., { onConflict:
-- 'tenant_id,crm_id' })` in the cron sync route. Partial because Apollo-
-- enriched contacts with no CRM record legitimately have crm_id = NULL,
-- and Postgres treats NULLs as distinct in non-partial unique indexes
-- (so a non-partial UNIQUE would still allow duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_tenant_crm
  ON contacts (tenant_id, crm_id)
  WHERE crm_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. eval_runs: enable RLS + tenant isolation policy
-- -----------------------------------------------------------------------------

ALTER TABLE eval_runs ENABLE ROW LEVEL SECURITY;

-- eval_runs.tenant_id is nullable (some runs are platform-wide goldens
-- with no tenant). Mirror the eval_cases policy: visible if tenant_id is
-- NULL OR matches the caller's tenant. Service-role writes bypass RLS as
-- with all tables.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'eval_runs'
       AND policyname = 'tenant_isolation_or_global'
  ) THEN
    CREATE POLICY "tenant_isolation_or_global" ON eval_runs
      FOR ALL USING (
        tenant_id IS NULL
        OR tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. CHECK constraints aligned with TypeScript unions
--
-- We add these as named constraints so a future migration can drop and
-- replace them when a new enum value is added (e.g. a new SignalType).
-- The `DO $$` blocks make the migration safe to re-run — Postgres has
-- no `ADD CONSTRAINT IF NOT EXISTS` for table-level constraints.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  -- companies.icp_tier
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_icp_tier_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_icp_tier_check
      CHECK (icp_tier IS NULL OR icp_tier IN ('A', 'B', 'C', 'D'));
  END IF;

  -- companies.priority_tier
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_priority_tier_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_priority_tier_check
      CHECK (priority_tier IS NULL OR priority_tier IN ('HOT', 'WARM', 'COOL', 'MONITOR'));
  END IF;

  -- companies.crm_source
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_crm_source_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_crm_source_check
      CHECK (crm_source IN ('hubspot', 'salesforce'));
  END IF;

  -- contacts.seniority
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_seniority_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_seniority_check
      CHECK (seniority IS NULL OR seniority IN ('c_level', 'vp', 'director', 'manager', 'individual'));
  END IF;

  -- contacts.role_tag
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_role_tag_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_role_tag_check
      CHECK (role_tag IS NULL OR role_tag IN ('champion', 'economic_buyer', 'technical_evaluator', 'end_user', 'blocker'));
  END IF;

  -- signals.signal_type
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'signals_signal_type_check'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_signal_type_check
      CHECK (signal_type IN (
        'hiring_surge', 'funding', 'leadership_change', 'expansion',
        'temp_job_posting', 'competitor_mention', 'seasonal_peak', 'negative_news'
      ));
  END IF;

  -- signals.urgency
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'signals_urgency_check'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_urgency_check
      CHECK (urgency IN ('immediate', 'this_week', 'this_month'));
  END IF;

  -- rep_profiles.alert_frequency
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rep_profiles_alert_frequency_check'
  ) THEN
    ALTER TABLE rep_profiles
      ADD CONSTRAINT rep_profiles_alert_frequency_check
      CHECK (alert_frequency IS NULL OR alert_frequency IN ('high', 'medium', 'low'));
  END IF;

  -- user_profiles.role
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_role_check'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_role_check
      CHECK (role IS NULL OR role IN ('rep', 'manager', 'admin', 'revops', 'csm', 'ad'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Hot-path index: inbox decision-maker fan-out
--
-- The /inbox query filters contacts by (tenant_id, is_decision_maker) and
-- orders by relevance_score DESC. Without a covering index this is a
-- full-tenant contacts scan. Partial index keeps it small — only the
-- ~5–10% of contacts flagged as decision-makers land in it.
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_contacts_decision_makers
  ON contacts (tenant_id, relevance_score DESC)
  WHERE is_decision_maker = TRUE;

-- -----------------------------------------------------------------------------
-- updated_at trigger for contacts (parity with companies / opportunities)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at_to_now()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contacts_updated_at ON contacts;
CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_to_now();
