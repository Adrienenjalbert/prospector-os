-- =============================================================================
-- Migration 016: attributions.is_control_cohort
-- =============================================================================
--
-- A1.4 of the strategic-review remediation. Honest holdout enforcement
-- on /admin/roi.
--
-- Today: attribution.ts inserts every matched (agent_event, outcome_event)
-- pair into `attributions` regardless of whether the user was in the
-- holdout control cohort. The /admin/roi page sums attribution.confidence ×
-- outcome.value_amount with NO holdout filter — but the page subtitle
-- reads "Control-cohort users are attributed but excluded from
-- influenced-ARR lift". The disclaimer overstates what the SQL does.
--
-- After this migration:
--   - `attributions.is_control_cohort` BOOLEAN NOT NULL DEFAULT FALSE
--   - Attribution workflow looks up `holdout_assignments.cohort` per
--     outcome's user_id and sets the flag at insert-time.
--   - /admin/roi filters `WHERE is_control_cohort = FALSE` for the
--     influenced-ARR loop.
--   - The control-cohort attributions stay in the table so ROI can
--     compute treatment-vs-control LIFT (not just treatment ARR) once
--     the dashboard surfaces it (Sprint 7 D-bucket work).
--
-- DEFENCE IN DEPTH:
--
-- We flag at WRITE-TIME, not at READ-TIME. A new dashboard surface
-- that forgets to add the filter still gets correct numbers because
-- no attribution row appears in /admin/roi until the workflow has
-- evaluated the cohort. Read-time-only filtering is fragile — every
-- new query has to remember the WHERE clause.
--
-- BACKFILL:
--
-- All existing rows default to is_control_cohort = FALSE. That is
-- correct UNLESS the historical data contains attributions for
-- control-cohort users — which it does (this is the bug). To avoid
-- mis-reporting historical ARR, the migration also runs a
-- one-shot UPDATE that flags existing rows whose `agent_event.user_id`
-- is in the control cohort.
--
-- IDEMPOTENCY: ADD COLUMN IF NOT EXISTS + the UPDATE only flips FALSE
-- → TRUE so re-running the migration is safe.
-- =============================================================================

ALTER TABLE attributions
  ADD COLUMN IF NOT EXISTS is_control_cohort BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index speeds up the dashboard's `WHERE is_control_cohort = FALSE`
-- filter on the typical hot path (treatment cohort attributions only).
CREATE INDEX IF NOT EXISTS idx_attributions_treatment
  ON attributions (tenant_id, created_at DESC)
  WHERE is_control_cohort = FALSE;

-- One-shot backfill. For every existing attribution, look up the
-- agent_event's user_id and flag if that user is currently assigned
-- to the control cohort. We use the CURRENT cohort assignment (not a
-- historical one) because `holdout_assignments` is append-only with
-- deterministic hash-based assignment — a user's cohort doesn't change
-- once assigned.
UPDATE attributions a
SET is_control_cohort = TRUE
FROM agent_events ae
JOIN holdout_assignments ha
  ON ha.tenant_id = ae.tenant_id
 AND ha.user_id = ae.user_id
 AND ha.cohort = 'control'
WHERE a.agent_event_id = ae.id
  AND a.is_control_cohort = FALSE;
