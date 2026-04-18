-- =============================================================================
-- Migration 005: Context Pack — slice priors for the bandit
--
-- Phase 3 of the Context Pack rollout. Adds one table:
--
--   context_slice_priors — Beta-Bernoulli priors per (tenant, intent, role,
--                          slice_slug). The selector reads these and applies
--                          a Thompson-sampling weight adjustment so slices
--                          that historically correlated with thumbs-up
--                          responses get loaded more often per tenant.
--
-- Mirrors the existing `tool_priors` shape (002_event_sourcing_and_foundation.sql)
-- so the calibration workflow can reuse the same Beta-Bernoulli update logic
-- the tool bandit will use. Per-tenant scoped — no cross-tenant leakage.
--
-- The calibration workflow (lib/workflows/context-slice-calibration.ts) updates
-- `alpha` (success counter) when a slice was consumed AND the response got
-- positive feedback, `beta` (failure counter) when a slice was consumed AND
-- the response got negative feedback, and increments `sample_count` on each
-- update so the workflow can detect when a (intent, role, slice) combination
-- has enough signal to start influencing selection.
-- =============================================================================

CREATE TABLE IF NOT EXISTS context_slice_priors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  intent_class VARCHAR(100) NOT NULL,
  role VARCHAR(50) NOT NULL,
  slice_slug VARCHAR(100) NOT NULL,
  -- Beta-Bernoulli parameters. alpha = wins + 1, beta = losses + 1.
  -- Default (1, 1) = uniform prior; selector falls back to heuristic
  -- scoring until enough samples accumulate (sample_count >= MIN_SAMPLES).
  alpha NUMERIC NOT NULL DEFAULT 1,
  beta NUMERIC NOT NULL DEFAULT 1,
  sample_count INTEGER NOT NULL DEFAULT 0,
  last_reset_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, intent_class, role, slice_slug)
);

-- Lookup index for the selector — it reads all priors for a given tenant
-- in one query per turn (small N: at most |intents| * |roles| * |slices|).
CREATE INDEX IF NOT EXISTS idx_context_slice_priors_lookup
  ON context_slice_priors (tenant_id, intent_class, role);

-- RLS: per-tenant isolation. Service role (workflows) bypasses RLS by design.
ALTER TABLE context_slice_priors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON context_slice_priors
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
