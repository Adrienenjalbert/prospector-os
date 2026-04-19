-- =============================================================================
-- Migration 013: tenants.region + tenants.allow_vendor_training
-- =============================================================================
--
-- Phase 3 T2.5 — future-proofing schema additions. Both columns are
-- read by code paths that don't ship in T2.5 itself; the columns
-- exist so that turning the path on for a customer is a row update,
-- not a migration.
--
-- WHY ADD COLUMNS NOW THAT NOTHING READS:
--
--   - Migrations are coordinated, downtime-able events. Adding a
--     column when we discover we need it next quarter triggers an
--     ops handshake; adding both columns now while we already have
--     downtime budget for migration 012 is free.
--
--   - The "future-proofing" failure mode that hurts is the column
--     that's missing. Customers ask "can you keep our data in EU?"
--     and we'd rather answer "yes, we set tenants.region='eu-west-1'
--     and route accordingly" than "we'd need to migrate first".
--
-- COLUMN: region
--
--   Default 'us-east-1' — matches today's actual production region.
--   Until T7 (multi-region routing) ships, the column is
--   informational: it documents intent but doesn't influence query
--   routing. The /admin/roi page can surface it so customers see
--   what they're on.
--
--   Acceptable values today: 'us-east-1', 'eu-west-1'. Open to
--   extension; not enum-constrained because routing logic is
--   per-tenant and may add regions opportunistically.
--
-- COLUMN: allow_vendor_training
--
--   Default FALSE — privacy-preserving by default. Per OQ-7 the
--   policy is "off by default, on by explicit opt-in". When a
--   vendor (Anthropic, OpenAI) exposes a per-request opt-out flag,
--   the agent route + ingest pipeline read this column and pass
--   the flag accordingly.
--
--   Today (April 2026): Anthropic API does NOT log conversations
--   submitted via the API by default for training; OpenAI's
--   embedding endpoint does not train on submitted content.
--   So the flag is documentary today. The column exists so a
--   procurement reviewer can see "off by default" in the
--   /admin/config UI without us building it now.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS protects re-runs.
-- =============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS region VARCHAR(20) NOT NULL DEFAULT 'us-east-1';

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS allow_vendor_training BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tenants.region IS
  'Future-proofs multi-region routing. Today single-region us-east-1; '
  'column exists so an EU tenant requires a row update, not a migration. '
  'See Phase 3 T2.5 / OQ-3.';

COMMENT ON COLUMN tenants.allow_vendor_training IS
  'Per-tenant model-training opt-in. Defaults FALSE (privacy-preserving). '
  'Read at the agent route + ingest pipeline once vendor APIs expose '
  'a per-request opt-out flag. See Phase 3 T2.5 / OQ-7.';
