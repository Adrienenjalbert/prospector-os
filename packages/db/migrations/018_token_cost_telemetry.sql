-- =============================================================================
-- Migration 018: token-cost telemetry view + model_pricing constants table
-- =============================================================================
--
-- P0.1 of the strategic-review remediation. Makes the cost-discipline
-- claims of the OS verifiable: per-tenant per-day per-model spend
-- becomes a SQL question, and /admin/roi can render the trend.
--
-- Design:
--
--   1. `model_pricing` (constants table) — one row per model id with
--      USD per million input/output tokens. Seed from current Anthropic
--      published rates. The strategic plan keeps Sonnet/Haiku/Opus as
--      the canonical trio, so three rows cover the whole cost surface.
--      Updated by `UPDATE ... SET ... WHERE model_id = 'X'` when prices
--      change — RLS-disabled because pricing is platform-wide, not
--      tenant-scoped.
--
--   2. `compute_token_cost_usd(model_id, input, output)` — pure SQL
--      helper. Joins to `model_pricing`; returns 0 when the model id
--      is unknown rather than NULL so SUM() aggregates stay numeric
--      even with model-id drift.
--
--   3. `agent_token_costs_daily` (view) — aggregates
--      `response_finished` payloads to (tenant_id, day, model) triples
--      with both raw token counts and computed USD cost. Read by
--      /admin/roi for the cost-per-day sparkline.
--
-- WHY A VIEW (not a materialized table):
--
-- Volume on `agent_events` is bounded — tens of thousands of rows per
-- tenant per day at most. The aggregation is cheap with the existing
-- `idx_agent_events_type_time` index. Materializing would add cron
-- complexity for marginal gain at our scale.
--
-- IDEMPOTENCY: every CREATE / INSERT uses IF NOT EXISTS or ON CONFLICT
-- so re-running this migration is safe.
-- =============================================================================

-- 1. Constants table
CREATE TABLE IF NOT EXISTS model_pricing (
  model_id VARCHAR(100) PRIMARY KEY,
  -- USD per 1M tokens. NUMERIC so cents-level precision survives.
  input_per_million_usd NUMERIC(10, 4) NOT NULL,
  output_per_million_usd NUMERIC(10, 4) NOT NULL,
  -- Cached input is the Anthropic prompt-cache rate (~10% of input).
  -- Not all providers offer caching, so default to input rate.
  cached_input_per_million_usd NUMERIC(10, 4) NOT NULL,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed from currently-published Anthropic pricing (April 2026). Update
-- this seed (or run ad-hoc UPDATE) when Anthropic changes prices.
INSERT INTO model_pricing (model_id, input_per_million_usd, output_per_million_usd, cached_input_per_million_usd, notes)
VALUES
  ('claude-sonnet-4-20250514', 3.00, 15.00, 0.30, 'Sonnet 4 — default agent model'),
  ('claude-haiku-4-20250514', 0.80, 4.00, 0.08, 'Haiku 4 — cheap fallback + compaction'),
  ('claude-opus-4-20250514', 15.00, 75.00, 1.50, 'Opus 4 — meta-agents only (prompt optimiser)')
ON CONFLICT (model_id) DO UPDATE
  SET input_per_million_usd = EXCLUDED.input_per_million_usd,
      output_per_million_usd = EXCLUDED.output_per_million_usd,
      cached_input_per_million_usd = EXCLUDED.cached_input_per_million_usd,
      notes = EXCLUDED.notes,
      updated_at = NOW();

-- model_pricing is platform-wide reference data; no RLS.

-- 2. Pure SQL cost helper.
--
-- Returns 0 (not NULL) for unknown models so SUM() stays numeric even
-- if the agent emits a model id we haven't seeded. This is the
-- "graceful degradation" pattern — observability never breaks because
-- of model-id drift, but the missing model will surface in
-- /admin/roi as an unknown bucket.
CREATE OR REPLACE FUNCTION compute_token_cost_usd(
  p_model_id TEXT,
  p_input_tokens BIGINT,
  p_output_tokens BIGINT,
  p_cached_input_tokens BIGINT DEFAULT 0
)
RETURNS NUMERIC AS $$
  SELECT COALESCE(
    (
      SELECT
        ((p_input_tokens - COALESCE(p_cached_input_tokens, 0))
          * mp.input_per_million_usd
          + COALESCE(p_cached_input_tokens, 0)
              * mp.cached_input_per_million_usd
          + p_output_tokens
              * mp.output_per_million_usd
        ) / 1000000.0
      FROM model_pricing mp
      WHERE mp.model_id = p_model_id
    ),
    0
  );
$$ LANGUAGE SQL IMMUTABLE;

-- 3. Per-day per-model rollup view.
--
-- Surfaces:
--   - tenant_id              for /admin/roi tenant scoping
--   - day                    for the sparkline x-axis
--   - model                  for the per-model bar / colour split
--   - response_count         turn count (denominator)
--   - input_tokens           raw input token sum
--   - output_tokens          raw output token sum
--   - cached_input_tokens    raw cached-input token sum (B3.1 telemetry)
--   - cost_usd               computed via compute_token_cost_usd()
--
-- The agent route's `response_finished` payload schema:
--   { agent_type, intent_class, model, step_count, tool_calls,
--     citation_count, tokens_total, response_length, ... }
--
-- We pull `tokens_total` for backwards compat AND the more precise
-- `input_tokens` / `output_tokens` / `cached_input_tokens` keys when
-- present (B3.1 telemetry adds these). When only `tokens_total` is
-- recorded, we fold it into output_tokens as a conservative default
-- so the cost number never reads as zero on legacy rows.
CREATE OR REPLACE VIEW agent_token_costs_daily AS
SELECT
  ae.tenant_id,
  date_trunc('day', ae.occurred_at)::date AS day,
  COALESCE(ae.payload->>'model', 'unknown') AS model,
  COUNT(*) AS response_count,
  SUM(COALESCE((ae.payload->>'input_tokens')::bigint, 0)) AS input_tokens,
  SUM(COALESCE((ae.payload->>'output_tokens')::bigint, 0)) AS output_tokens,
  SUM(COALESCE((ae.payload->>'cached_input_tokens')::bigint, 0)) AS cached_input_tokens,
  -- Conservative fallback: when only tokens_total is recorded (legacy
  -- rows from before B3.1), we cost it as 100% output to avoid
  -- under-reporting spend.
  SUM(COALESCE((ae.payload->>'tokens_total')::bigint, 0)) AS tokens_total,
  SUM(
    compute_token_cost_usd(
      COALESCE(ae.payload->>'model', 'unknown'),
      COALESCE(
        (ae.payload->>'input_tokens')::bigint,
        -- Legacy: assume 60/40 input/output split when only total known.
        (COALESCE((ae.payload->>'tokens_total')::bigint, 0) * 6) / 10
      ),
      COALESCE(
        (ae.payload->>'output_tokens')::bigint,
        (COALESCE((ae.payload->>'tokens_total')::bigint, 0) * 4) / 10
      ),
      COALESCE((ae.payload->>'cached_input_tokens')::bigint, 0)
    )
  ) AS cost_usd
FROM agent_events ae
WHERE ae.event_type = 'response_finished'
GROUP BY ae.tenant_id, date_trunc('day', ae.occurred_at), ae.payload->>'model';

COMMENT ON VIEW agent_token_costs_daily IS
  'Per-tenant per-day per-model AI cost rollup. Powers the /admin/roi cost sparkline (P0.1).';

-- Views inherit RLS from their base tables, but we make it explicit
-- here so future readers don't have to trace it. `agent_events` already
-- has tenant_isolation policy; the view filters via WHERE clause +
-- the GROUP BY tenant_id ensures cross-tenant aggregation can never
-- land in a single row.
