-- =============================================================================
-- Migration 019: improvement_reports.kind for typed report categories
-- =============================================================================
--
-- P0.2 of the strategic-review remediation. Today every row in
-- `improvement_reports` is treated identically: the self-improve
-- weekly markdown report and the new baseline-metrics snapshot would
-- both land as opaque rows. Without a typed `kind`, the
-- /admin/adaptation page can't filter (and the new
-- baseline-snapshot script can't dedupe its own re-runs cleanly).
--
-- After this migration:
--   - `kind` VARCHAR(40) DEFAULT 'self_improve' for back-compat
--   - Index on (tenant_id, kind, created_at DESC) so the most-recent
--     snapshot per tenant per kind is a fast lookup
--   - `metrics` JSONB column holds the structured baseline payload
--     (north-star metric values at snapshot time)
--
-- IDEMPOTENCY: ALTER ... ADD COLUMN IF NOT EXISTS so re-runs are safe.
-- =============================================================================

ALTER TABLE improvement_reports
  ADD COLUMN IF NOT EXISTS kind VARCHAR(40) NOT NULL DEFAULT 'self_improve',
  ADD COLUMN IF NOT EXISTS metrics JSONB;

CREATE INDEX IF NOT EXISTS idx_improvement_reports_kind
  ON improvement_reports (tenant_id, kind, created_at DESC);

COMMENT ON COLUMN improvement_reports.kind IS
  'self_improve | baseline_snapshot | failure_cluster | prompt_diff (extend as workflows multiply)';
COMMENT ON COLUMN improvement_reports.metrics IS
  'Structured metric payload (P0.2). Used by baseline_snapshot rows; null for legacy markdown-only rows.';
