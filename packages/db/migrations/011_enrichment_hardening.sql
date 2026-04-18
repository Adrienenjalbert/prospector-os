-- =============================================================================
-- Migration 011: Enrichment hardening — tier gating, cost ledger, no-match
--
-- Closes the four cost-effectiveness gaps the enrichment audit surfaced:
--
--   1. `companies` has no way to record "Apollo has no match for this domain"
--      so the cron re-enriches dead domains forever, burning credits. We
--      add `enrichment_status` ('pending' | 'enriched' | 'no_match' |
--      'error') with a partial index so the cron can skip `no_match` rows
--      cheaply.
--
--   2. `tenants.enrichment_spend_current` is a single number with no
--      breakdown by operation. A tenant burning $400 in phone unlocks looks
--      identical to one burning $400 in cheap company enrichments. We add
--      `enrichment_spend_by_op JSONB` keyed by operation slug
--      (`company_enrich`, `contact_search`, `phone_unlock`, `job_postings`,
--      `person_match`) so admins can see where credits go.
--
--   3. `tenants.enrichment_spend_reset_at TIMESTAMPTZ` records the last
--      monthly reset. Without it, `enrichment_spend_current` grows
--      forever — month 2 the budget is already exhausted from month 1
--      spend and the cron stops working. The cron now resets when the
--      reset_at is older than 30 days.
--
--   4. `companies.last_employee_count` lets the firmographic-delta detector
--      compare new vs old employee_count and emit a `hiring_surge` signal
--      automatically when the count jumps materially. Otherwise enrichment
--      is a one-way data dump that never feeds back into scoring.
--
-- All changes are additive, idempotent, and safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. companies.enrichment_status — drives cron skip + admin visibility
-- -----------------------------------------------------------------------------

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS enrichment_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS last_employee_count INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_enrichment_status_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_enrichment_status_check
      CHECK (enrichment_status IS NULL OR enrichment_status IN (
        'pending', 'enriched', 'no_match', 'error'
      ));
  END IF;
END $$;

-- Backfill from `enriched_at` so existing rows get the right status.
-- Companies that already have data → 'enriched'. The rest stay null
-- until the cron sees them.
UPDATE companies
   SET enrichment_status = 'enriched'
 WHERE enrichment_status IS NULL
   AND enriched_at IS NOT NULL;

-- Hot-path partial index: cron's eligibility query becomes a fast scan
-- when the table grows. Excludes `no_match` rows so the cron never
-- considers them; excludes already-enriched rows that aren't stale.
CREATE INDEX IF NOT EXISTS idx_companies_enrich_eligible
  ON companies (tenant_id, propensity DESC NULLS LAST)
  WHERE enrichment_status IS NULL
     OR (enrichment_status = 'enriched' AND enriched_at < NOW() - INTERVAL '30 days');

-- -----------------------------------------------------------------------------
-- 2 + 3. tenants: spend breakdown by operation + monthly reset timestamp
-- -----------------------------------------------------------------------------

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS enrichment_spend_by_op JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_spend_reset_at TIMESTAMPTZ;

-- Initialise the reset timestamp so the next cron run treats this as
-- the start of the current billing period rather than instantly resetting.
UPDATE tenants
   SET enrichment_spend_reset_at = COALESCE(enrichment_spend_reset_at, NOW())
 WHERE enrichment_spend_reset_at IS NULL;
