-- Migration 002: Event sourcing + self-learning foundation
--
-- Adds:
--   agent_events          — every step in the agent loop (tool calls, citations, feedback, errors)
--   outcome_events        — every CRM/business event we can observe (deal advanced, meeting held, won/lost, renewed, churned)
--   attributions          — links agent_events -> outcome_events with confidence
--   cooldowns             — persistent cooldown entries for notifications (alert fatigue protection)
--   tenant_baselines      — time-per-task baselines for ROI denominator
--   eval_cases            — golden + failure-mined evaluation cases
--   improvement_reports   — weekly self-improvement reports from selfImproveWorkflow
--   tool_priors           — Thompson sampling priors for tool selection bandit
--   retrieval_priors      — citation usefulness priors from click tracking
--   attribution_config    — per-tenant attribution rules
--   calibration_ledger    — audit trail for prompt/weight/prior changes
--
-- Also adds:
--   CREATE FUNCTION match_transcripts  — pgvector semantic search RPC
--   RLS on tenants, user_profiles, cron_runs (missing in schema.sql)
--   Indexes on all new tables for tenant-scoped queries
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "vector";

-- =============================================================================
-- EVENT SOURCING: the substrate everything else learns from
-- =============================================================================

CREATE TABLE IF NOT EXISTS agent_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  interaction_id UUID,
  user_id UUID,
  role VARCHAR(50),
  event_type VARCHAR(50) NOT NULL,
  subject_urn TEXT,
  payload JSONB DEFAULT '{}',
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_events_tenant_time
  ON agent_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_interaction
  ON agent_events (interaction_id)
  WHERE interaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_events_type_time
  ON agent_events (tenant_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_subject
  ON agent_events (tenant_id, subject_urn, occurred_at DESC)
  WHERE subject_urn IS NOT NULL;

ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON agent_events
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

CREATE TABLE IF NOT EXISTS outcome_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  subject_urn TEXT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  source VARCHAR(30),
  user_id UUID,
  payload JSONB DEFAULT '{}',
  value_amount NUMERIC,
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outcome_events_tenant_time
  ON outcome_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_events_subject
  ON outcome_events (tenant_id, subject_urn, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_events_type
  ON outcome_events (tenant_id, event_type, occurred_at DESC);

ALTER TABLE outcome_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON outcome_events
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

CREATE TABLE IF NOT EXISTS attributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  agent_event_id UUID NOT NULL REFERENCES agent_events(id) ON DELETE CASCADE,
  outcome_event_id UUID NOT NULL REFERENCES outcome_events(id) ON DELETE CASCADE,
  attribution_rule VARCHAR(30) NOT NULL,
  confidence NUMERIC NOT NULL,
  lag_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_event_id, outcome_event_id)
);

CREATE INDEX IF NOT EXISTS idx_attributions_tenant
  ON attributions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attributions_agent_event
  ON attributions (agent_event_id);
CREATE INDEX IF NOT EXISTS idx_attributions_outcome_event
  ON attributions (outcome_event_id);

ALTER TABLE attributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON attributions
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- =============================================================================
-- WORKFLOW RUNS: durable execution state for long-running jobs
-- Stores each workflow run + its step-by-step state so retries resume from
-- the last successful step instead of from scratch. When we migrate to
-- Vercel Workflow DevKit, this table becomes redundant; kept portable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id),
  workflow_name VARCHAR(100) NOT NULL,
  subject_urn TEXT,
  idempotency_key TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  current_step VARCHAR(100),
  step_state JSONB DEFAULT '{}',
  input JSONB,
  output JSONB,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant_status
  ON workflow_runs (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_scheduled
  ON workflow_runs (status, scheduled_for)
  WHERE status IN ('pending', 'scheduled');
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_idempotency
  ON workflow_runs (tenant_id, workflow_name, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_only" ON workflow_runs
  FOR ALL USING (false);

-- =============================================================================
-- WEBHOOK DELIVERIES: idempotency + replay protection
-- =============================================================================

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  webhook_type VARCHAR(50) NOT NULL,
  idempotency_key TEXT NOT NULL,
  result_id TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant_key
  ON webhook_deliveries (tenant_id, idempotency_key);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_only" ON webhook_deliveries
  FOR ALL USING (false);

-- =============================================================================
-- COOLDOWNS: alert fatigue protection persistence
-- =============================================================================

CREATE TABLE IF NOT EXISTS cooldowns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  subject_key TEXT NOT NULL,
  trigger_type VARCHAR(50) NOT NULL,
  last_fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cooldown_until TIMESTAMPTZ NOT NULL,
  UNIQUE(tenant_id, subject_key, trigger_type)
);

CREATE INDEX IF NOT EXISTS idx_cooldowns_subject
  ON cooldowns (tenant_id, subject_key);
CREATE INDEX IF NOT EXISTS idx_cooldowns_until
  ON cooldowns (tenant_id, cooldown_until);

ALTER TABLE cooldowns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON cooldowns
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- =============================================================================
-- ROI BASELINES: time-per-task survey responses anchor time-saved claims
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_baselines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID,
  task_type VARCHAR(50) NOT NULL,
  minutes_per_task INTEGER NOT NULL,
  sample_size INTEGER DEFAULT 1,
  collected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_baselines_task
  ON tenant_baselines (tenant_id, task_type);

ALTER TABLE tenant_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON tenant_baselines
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- =============================================================================
-- EVAL CASES: golden + failure-mined eval set
-- =============================================================================

CREATE TABLE IF NOT EXISTS eval_cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id),
  origin VARCHAR(30) NOT NULL,
  category VARCHAR(50) NOT NULL,
  role VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending_review',
  question TEXT NOT NULL,
  expected_tool_calls TEXT[],
  expected_citation_types TEXT[],
  expected_structure JSONB,
  expected_answer_summary TEXT,
  source_interaction_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID
);

CREATE INDEX IF NOT EXISTS idx_eval_cases_status
  ON eval_cases (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_cases_tenant
  ON eval_cases (tenant_id, category)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE eval_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_or_global" ON eval_cases
  FOR ALL USING (
    tenant_id IS NULL
    OR tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS eval_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id),
  eval_case_id UUID NOT NULL REFERENCES eval_cases(id) ON DELETE CASCADE,
  prompt_version VARCHAR(100),
  model_id VARCHAR(100),
  passed BOOLEAN NOT NULL,
  score NUMERIC,
  response_summary TEXT,
  citation_count INTEGER,
  tool_calls_made TEXT[],
  judge_reasoning TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_case
  ON eval_runs (eval_case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_runs_version
  ON eval_runs (prompt_version, created_at DESC)
  WHERE prompt_version IS NOT NULL;

-- =============================================================================
-- IMPROVEMENT REPORTS: output of selfImproveWorkflow
-- =============================================================================

CREATE TABLE IF NOT EXISTS improvement_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  failure_cluster_count INTEGER DEFAULT 0,
  report_markdown TEXT,
  proposed_fixes JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_improvement_reports_tenant
  ON improvement_reports (tenant_id, created_at DESC);

ALTER TABLE improvement_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON improvement_reports
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- =============================================================================
-- TOOL PRIORS: Thompson sampling state for tool selection bandit
-- =============================================================================

CREATE TABLE IF NOT EXISTS tool_priors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  intent_class VARCHAR(100) NOT NULL,
  tool_id TEXT NOT NULL,
  alpha NUMERIC NOT NULL DEFAULT 1,
  beta NUMERIC NOT NULL DEFAULT 1,
  sample_count INTEGER NOT NULL DEFAULT 0,
  last_reset_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, intent_class, tool_id)
);

CREATE INDEX IF NOT EXISTS idx_tool_priors_lookup
  ON tool_priors (tenant_id, intent_class);

ALTER TABLE tool_priors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON tool_priors
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- =============================================================================
-- RETRIEVAL PRIORS: citation usefulness from clicks
-- =============================================================================

CREATE TABLE IF NOT EXISTS retrieval_priors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  source_type VARCHAR(50) NOT NULL,
  source_id TEXT,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_retrieval_priors_type
  ON retrieval_priors (tenant_id, source_type);

ALTER TABLE retrieval_priors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON retrieval_priors
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- =============================================================================
-- ATTRIBUTION CONFIG: per-tenant attribution rules
-- =============================================================================

CREATE TABLE IF NOT EXISTS attribution_config (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
  rules JSONB NOT NULL DEFAULT '{
    "direct":     {"confidence": 0.95, "max_lag_seconds": 3600},
    "assisted":   {"confidence": 0.70, "max_lag_seconds": 86400},
    "influenced": {"confidence": 0.40, "max_lag_seconds": 1209600}
  }',
  holdout_percent NUMERIC DEFAULT 10,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE attribution_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON attribution_config
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- =============================================================================
-- CALIBRATION LEDGER: audit trail for every adaptation change
-- =============================================================================

CREATE TABLE IF NOT EXISTS calibration_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  change_type VARCHAR(50) NOT NULL,
  target_path TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  observed_lift NUMERIC,
  applied_by UUID,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_calibration_ledger_tenant
  ON calibration_ledger (tenant_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_calibration_ledger_type
  ON calibration_ledger (tenant_id, change_type, applied_at DESC);

ALTER TABLE calibration_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON calibration_ledger
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- =============================================================================
-- HOLDOUT ASSIGNMENTS: causal rigour for influenced-revenue claims
-- =============================================================================

CREATE TABLE IF NOT EXISTS holdout_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL,
  cohort VARCHAR(20) NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,
  UNIQUE(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_holdout_user
  ON holdout_assignments (tenant_id, user_id);

ALTER TABLE holdout_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON holdout_assignments
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- =============================================================================
-- BUSINESS PROFILES: add exemplars + prompt_overrides columns
-- These store tenant-mined few-shot examples and approved prompt diffs
-- =============================================================================

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS exemplars JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS prompt_overrides JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(100) DEFAULT 'v1';

-- =============================================================================
-- TRANSCRIPT SEMANTIC SEARCH: the missing match_transcripts RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION match_transcripts(
  query_embedding VECTOR(1536),
  match_tenant_id UUID,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10,
  filter_company_id UUID DEFAULT NULL,
  filter_source VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  company_id UUID,
  source VARCHAR,
  source_id VARCHAR,
  summary TEXT,
  themes TEXT[],
  occurred_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.tenant_id,
    t.company_id,
    t.source,
    t.source_id,
    t.summary,
    t.themes,
    t.occurred_at,
    1 - (t.embedding <=> query_embedding) AS similarity
  FROM transcripts t
  WHERE t.tenant_id = match_tenant_id
    AND t.embedding IS NOT NULL
    AND (filter_company_id IS NULL OR t.company_id = filter_company_id)
    AND (filter_source IS NULL OR t.source = filter_source)
    AND 1 - (t.embedding <=> query_embedding) > match_threshold
  ORDER BY t.embedding <=> query_embedding ASC
  LIMIT match_count;
END;
$$;

-- =============================================================================
-- RLS GAPS: tenants / user_profiles / cron_runs were missing RLS
-- =============================================================================

-- tenants: users can read their own tenant row
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_tenant_read" ON tenants;
CREATE POLICY "own_tenant_read" ON tenants
  FOR SELECT USING (id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- user_profiles: users can read their own row
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_profile" ON user_profiles;
CREATE POLICY "own_profile" ON user_profiles
  FOR ALL USING (id = auth.uid());
DROP POLICY IF EXISTS "same_tenant_read" ON user_profiles;
CREATE POLICY "same_tenant_read" ON user_profiles
  FOR SELECT USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- cron_runs: service role only (no user access)
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_only" ON cron_runs;
CREATE POLICY "service_only" ON cron_runs
  FOR ALL USING (false);

-- implicit_signals / weekly_pulse_responses / trigger_overrides / calibration_proposals /
-- agent_interaction_outcomes / adoption_metrics / relationship_notes — catch missing RLS
ALTER TABLE relationship_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON relationship_notes;
CREATE POLICY "tenant_isolation" ON relationship_notes
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

ALTER TABLE implicit_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON implicit_signals;
CREATE POLICY "tenant_isolation" ON implicit_signals
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

ALTER TABLE weekly_pulse_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON weekly_pulse_responses;
CREATE POLICY "tenant_isolation" ON weekly_pulse_responses
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

ALTER TABLE trigger_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON trigger_overrides;
CREATE POLICY "tenant_isolation" ON trigger_overrides
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

ALTER TABLE calibration_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON calibration_proposals;
CREATE POLICY "tenant_isolation" ON calibration_proposals
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

ALTER TABLE agent_interaction_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON agent_interaction_outcomes;
CREATE POLICY "tenant_isolation" ON agent_interaction_outcomes
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

ALTER TABLE adoption_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON adoption_metrics;
CREATE POLICY "tenant_isolation" ON adoption_metrics
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
