-- Sprint 4 (Mission–Reality Gap roadmap): team_metrics table that the
-- analytics/team page (currently a placeholder) is waiting on. The
-- placeholder explicitly told managers to "use the ontology browser
-- and ROI dashboard" because no team aggregation existed. This
-- migration ships the table; the team-aggregation workflow (in
-- apps/web/src/lib/workflows/team-aggregation.ts) writes one row per
-- (tenant, rep, metric_date) per nightly run; the page reads from
-- here.
--
-- Why daily snapshot (not on-demand aggregation): forecast/quota
-- numbers don't change minute-to-minute, and per-rep aggregation over
-- a 50-rep tenant doing on-demand queries every page load wastes
-- compute. Snapshot once per night, read for free.

CREATE TABLE IF NOT EXISTS team_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The rep this snapshot is for. Foreign-keyed to rep_profiles so a
  -- deactivated rep cleanly cascades when the row is deleted.
  rep_id UUID NOT NULL REFERENCES rep_profiles(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,

  -- Quota target for the current quarter. Pulled from the new
  -- rep_profiles.quota_quarterly column (also added below) so the
  -- aggregator and the dashboard read the same source of truth.
  quota_quarterly DECIMAL(12,2),

  -- Won + commit revenue this quarter ÷ quota. Stored as a fraction
  -- (0..2+ — over-attainment is real). The page renders × 100 for the
  -- percent display.
  attainment_quarterly DECIMAL(6,3),

  -- Open weighted pipeline (deal value × probability) divided by the
  -- gap to quota — answers "how many times my remaining quota gap am
  -- I covering?". 3× is the conventional healthy floor.
  pipeline_coverage DECIMAL(8,3),

  -- Sum of (deal value × probability) on this rep's open opps.
  weighted_pipeline DECIMAL(12,2),

  -- How many of this rep's open deals are flagged is_stalled. The
  -- placeholder's rep × stage heatmap reads this.
  stalled_deal_count INTEGER DEFAULT 0,

  -- Bootstrap forecast band (computed via packages/core/funnel/
  -- forecast.ts so the math matches the rep's own forecast page).
  forecast_low DECIMAL(12,2),
  forecast_mid DECIMAL(12,2),
  forecast_high DECIMAL(12,2),

  -- Honest staleness signal. The page renders "as of <X>" so
  -- managers know whether they're looking at fresh or 24h-old data.
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (tenant_id, rep_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_team_metrics_tenant_date
  ON team_metrics (tenant_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_team_metrics_rep
  ON team_metrics (tenant_id, rep_id, metric_date DESC);

ALTER TABLE team_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON team_metrics
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- rep_profiles.quota_quarterly — the new source-of-truth quota field.
-- Pre-this-migration the only quota-shaped column was
-- kpi_pipeline_value (an absolute pipeline target, not a sales
-- attainment quota). We add a dedicated quarterly quota so attainment
-- has an honest denominator. Existing tenants who haven't filled it
-- in see attainment_quarterly = NULL → the page renders an empty-state
-- per-panel rather than a fake percentage.
ALTER TABLE rep_profiles
  ADD COLUMN IF NOT EXISTS quota_quarterly DECIMAL(12,2);
