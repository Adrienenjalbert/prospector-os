-- =============================================================================
-- Migration 010: Scoring freshness signal
--
-- The scoring audit identified that there was no field on `companies` that
-- told the UI / agent / workflows when a row's score was last computed.
-- Without this:
--   - the inbox can't badge "scored 30 minutes ago" vs "scored 5 days ago"
--   - the agent can't say "the priority I'm quoting was last calibrated
--     yesterday morning" (cite-or-shut-up needs honest staleness signal)
--   - operators can't detect tenants whose nightly scoring has silently
--     stalled (the cron run may finish "successfully" with 0 companies
--     scored due to a bad sub-scorer config)
--
-- We add `last_scored_at` and an index that supports the common
-- "find stale companies in this tenant" query (used by an on-demand
-- rescore path the audit recommended for follow-up).
--
-- Idempotent — re-runnable on a database where it has already been
-- applied.
-- =============================================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS last_scored_at TIMESTAMPTZ;

-- Backfill — rows that were scored before this column existed get
-- `updated_at` as a best-guess proxy. The next nightly cron run will
-- overwrite with the real value.
UPDATE companies
   SET last_scored_at = COALESCE(last_scored_at, updated_at, NOW())
 WHERE last_scored_at IS NULL;

-- Composite index for the "stale companies in this tenant" query the
-- on-demand rescore path will use. Partial because we only care about
-- companies that have at least been scored once.
CREATE INDEX IF NOT EXISTS idx_companies_last_scored
  ON companies (tenant_id, last_scored_at DESC NULLS LAST)
  WHERE last_scored_at IS NOT NULL;
