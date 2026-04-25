-- =============================================================================
-- Migration 023: agent_intent_quality_daily view
-- =============================================================================
--
-- Powers the "quality-gated cheap-intent routing" path in
-- `apps/web/src/lib/agent/model-registry.ts` (`chooseModel` —
-- `historicalHaikuThumbsUpRate` parameter).
--
-- The chooseModel policy already supports refusing a Haiku downgrade
-- when the historical thumbs-up rate for that intent on Haiku is
-- < 0.7 (`MIN_HAIKU_THUMBS_UP`). Until this view existed, no caller
-- had a cheap, indexed source for that rate — so the quality gate was
-- dead code. Wiring this view + the loader (`intent-quality.ts`)
-- makes the gate live and lets us safely expand
-- `HAIKU_PREFERRED_INTENTS` to additional cheap intents
-- (meeting_prep, signal_triage, stakeholder_mapping). If a tenant's
-- production data shows Haiku regresses quality on any of those
-- intents, the gate auto-engages — no rollback needed.
--
-- WHY A VIEW (not a materialized table):
--
-- Mirrors the pattern set by `agent_token_costs_daily` (migration
-- 018). Volume is bounded — `feedback_given` is at most 1/turn × N
-- turns/day, and the join target (`interaction_started`) is exactly
-- 1/turn. The aggregation hits two existing indexes
-- (`idx_agent_events_type_time` for the feedback scan,
-- `idx_agent_events_interaction` for the join) so a per-request read
-- of "rate for this (tenant, intent, model)" runs in single-digit
-- millis. Materializing would add cron complexity for marginal gain.
--
-- WINDOW CHOICE:
--
-- 30 days, fixed in the view. Long enough for sample_count to
-- accumulate above the consumer's MIN_SAMPLE_COUNT threshold (10),
-- short enough that recent prompt + tool changes dominate the rate.
-- If a tenant ships a prompt diff and quality recovers, they only
-- carry the bad-quality tail for ~4 weeks — fast enough for the
-- gate to re-open the cheap path automatically.
--
-- DUAL-FORMAT SUPPORT:
--
-- The codebase emits feedback values in two formats today:
--   - newer:   payload.value = 'positive' | 'negative'
--             (apps/web/src/app/actions/implicit-feedback.ts L113)
--   - older:   payload.value = 'thumbs_up' | 'thumbs_down'
--             (still referenced in pilot/page.tsx, roi/page.tsx,
--             eval-growth.ts, exemplar-miner.ts, prompt-optimizer.ts)
--
-- The view normalises both to a single positive/negative split so
-- the rate is consistent regardless of which writer produced the
-- row. New emitters should use 'positive' / 'negative'; the legacy
-- alias support is for the rolling window backfill.
--
-- IDEMPOTENCY: CREATE OR REPLACE VIEW is fine to re-run.
-- =============================================================================

CREATE OR REPLACE VIEW agent_intent_quality_daily AS
WITH feedback_with_context AS (
  -- Each feedback row is keyed by interaction_id; the (intent_class,
  -- model) pair lives on the matching `interaction_started` row for
  -- the same interaction. Inner-join: feedback rows without a started
  -- row are dropped (an interaction the route failed to log can't be
  -- attributed to a (intent, model) bucket anyway).
  SELECT
    fb.tenant_id,
    COALESCE(started.payload->>'intent_class', 'unknown') AS intent_class,
    COALESCE(started.payload->>'model', 'unknown') AS model,
    -- Normalise both legacy ('thumbs_up') and current ('positive')
    -- writer formats into a single boolean. Anything else is
    -- treated as missing and skipped at the aggregate step.
    CASE
      WHEN fb.payload->>'value' IN ('positive', 'thumbs_up') THEN TRUE
      WHEN fb.payload->>'value' IN ('negative', 'thumbs_down') THEN FALSE
      ELSE NULL
    END AS is_positive
  FROM agent_events fb
  INNER JOIN agent_events started
    ON started.interaction_id = fb.interaction_id
    AND started.event_type = 'interaction_started'
    AND started.tenant_id = fb.tenant_id
  WHERE fb.event_type = 'feedback_given'
    AND fb.occurred_at >= NOW() - INTERVAL '30 days'
    AND fb.interaction_id IS NOT NULL
)
SELECT
  tenant_id,
  intent_class,
  model,
  COUNT(*) FILTER (WHERE is_positive IS NOT NULL) AS sample_count,
  -- Returns NULL when sample_count is 0 — the consumer treats NULL
  -- as "no signal, fall through to default routing" exactly as it
  -- does for `undefined` from the loader.
  CASE
    WHEN COUNT(*) FILTER (WHERE is_positive IS NOT NULL) = 0 THEN NULL
    ELSE
      COUNT(*) FILTER (WHERE is_positive = TRUE)::NUMERIC
      / COUNT(*) FILTER (WHERE is_positive IS NOT NULL)::NUMERIC
  END AS thumbs_up_rate
FROM feedback_with_context
GROUP BY tenant_id, intent_class, model;

COMMENT ON VIEW agent_intent_quality_daily IS
  'Per-tenant per-intent per-model thumbs-up rate over the trailing 30 days. Powers the quality gate in chooseModel (model-registry.ts) so cheap-intent routing only downgrades to Haiku when historical quality permits. Sample_count + thumbs_up_rate are NULL-safe so the consumer can treat "no data" the same as "fall through to default policy".';

-- Views inherit RLS from base tables. `agent_events` already enforces
-- tenant_isolation via the policy in migration 002, so any consumer
-- of this view sees only their own tenant's rates by default.
-- Service-role callers (the agent route, the Slack route) bypass RLS
-- and pass `.eq('tenant_id', tenantId)` explicitly — defence in depth.
