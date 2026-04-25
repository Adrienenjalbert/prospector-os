-- =============================================================================
-- Migration 017: eval_cases dedup on (tenant_id, source_interaction_id)
-- =============================================================================
--
-- A2.4 of the strategic-review remediation. Eval-growth promotion
-- becomes safe to re-run.
--
-- Today: `runEvalGrowth` runs nightly and re-promotes the SAME failure
-- interactions every night until the lookback window expires (24h
-- today, but the rolling re-evaluation keeps producing duplicate
-- pending_review rows). Reviewers see the same case appearing under
-- different ids, status='pending_review' piles up, and accepting one
-- copy doesn't dedupe the others.
--
-- After this migration:
--   - Unique partial index on (tenant_id, source_interaction_id) WHERE
--     source_interaction_id IS NOT NULL.
--   - Re-runs of the workflow that try to insert a duplicate
--     (tenant, source_interaction_id) are rejected with `23505`. The
--     workflow handles this by upserting on conflict (already idempotent
--     for nightly runs).
--   - Manually-added eval cases (no source_interaction_id) keep working
--     because the index is partial.
--
-- BACKFILL:
--
-- Existing duplicate rows are kept — collapsing them retroactively
-- would lose review history. Instead we mark all but the OLDEST per
-- (tenant, source_interaction_id) as `superseded` so reviewers focus
-- on a single canonical row going forward.
-- =============================================================================

-- Enforce uniqueness for future inserts.
CREATE UNIQUE INDEX IF NOT EXISTS ux_eval_cases_source_interaction
  ON eval_cases (tenant_id, source_interaction_id)
  WHERE source_interaction_id IS NOT NULL;

-- Backfill: mark non-canonical duplicates as `superseded` so reviewers
-- only see the canonical row (the oldest one). The unique index above
-- will prevent re-occurrence.
UPDATE eval_cases ec
SET status = 'superseded',
    notes = COALESCE(notes, '') || E'\n[migration 017] superseded by older row for the same source_interaction_id'
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, source_interaction_id
           ORDER BY created_at ASC
         ) AS rn
  FROM eval_cases
  WHERE source_interaction_id IS NOT NULL
    AND status IN ('pending_review', 'pending')
) ranked
WHERE ec.id = ranked.id
  AND ranked.rn > 1
  AND ec.status IN ('pending_review', 'pending');
