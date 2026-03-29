-- ============================================
-- PROSPECTOR OS v3.0 — MULTI-TENANT SCHEMA
-- Supabase Postgres with Row Level Security
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TENANTS
-- ============================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  domain VARCHAR(255),

  crm_type VARCHAR(20) NOT NULL DEFAULT 'salesforce',
  crm_credentials_encrypted JSONB,

  enrichment_providers JSONB DEFAULT '["apollo"]',
  enrichment_budget_monthly DECIMAL(10,2) DEFAULT 500.00,
  enrichment_spend_current DECIMAL(10,2) DEFAULT 0.00,

  ai_provider VARCHAR(20) DEFAULT 'anthropic',
  ai_token_budget_monthly INTEGER DEFAULT 1000000,
  ai_tokens_used_current INTEGER DEFAULT 0,

  icp_config JSONB NOT NULL,
  funnel_config JSONB NOT NULL,
  signal_config JSONB NOT NULL,
  scoring_config JSONB NOT NULL,
  business_config JSONB NOT NULL DEFAULT '{}',

  active BOOLEAN DEFAULT TRUE,
  onboarded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- USER PROFILES (linked to Supabase Auth)
-- ============================================
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'rep',
  rep_profile_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_tenant ON user_profiles(tenant_id);

-- ============================================
-- COMPANIES
-- ============================================
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  crm_id VARCHAR(50) NOT NULL,
  crm_source VARCHAR(20) NOT NULL DEFAULT 'salesforce',

  name VARCHAR(255) NOT NULL,
  domain VARCHAR(255),
  website VARCHAR(500),

  industry VARCHAR(100),
  industry_group VARCHAR(100),
  employee_count INTEGER,
  employee_range VARCHAR(50),
  annual_revenue DECIMAL(15,2),
  revenue_range VARCHAR(50),
  founded_year INTEGER,

  hq_city VARCHAR(100),
  hq_country VARCHAR(100),
  location_count INTEGER DEFAULT 1,
  locations JSONB DEFAULT '[]',

  tech_stack JSONB DEFAULT '[]',

  owner_crm_id VARCHAR(50),
  owner_name VARCHAR(255),
  owner_email VARCHAR(255),

  icp_score DECIMAL(5,2) DEFAULT 0,
  icp_tier VARCHAR(1) DEFAULT 'D',
  icp_dimensions JSONB DEFAULT '{}',
  signal_score DECIMAL(5,2) DEFAULT 0,
  engagement_score DECIMAL(5,2) DEFAULT 0,
  contact_coverage_score DECIMAL(5,2) DEFAULT 0,
  velocity_score DECIMAL(5,2) DEFAULT 0,
  win_rate_score DECIMAL(5,2) DEFAULT 0,
  propensity DECIMAL(5,2) DEFAULT 0,
  expected_revenue DECIMAL(12,2) DEFAULT 0,
  priority_tier VARCHAR(10) DEFAULT 'MONITOR',
  priority_reason TEXT,
  urgency_multiplier DECIMAL(4,2) DEFAULT 1.0,

  enriched_at TIMESTAMP WITH TIME ZONE,
  enrichment_source VARCHAR(50),
  enrichment_data JSONB DEFAULT '{}',
  last_signal_check TIMESTAMP WITH TIME ZONE,
  icp_config_version VARCHAR(20),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_activity_date TIMESTAMP WITH TIME ZONE,
  last_crm_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(tenant_id, crm_id)
);

CREATE INDEX idx_companies_tenant ON companies(tenant_id);
CREATE INDEX idx_companies_owner ON companies(tenant_id, owner_crm_id);
CREATE INDEX idx_companies_priority ON companies(tenant_id, expected_revenue DESC);
CREATE INDEX idx_companies_tier ON companies(tenant_id, icp_tier);

-- ============================================
-- CONTACTS
-- ============================================
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  crm_id VARCHAR(50),
  apollo_id VARCHAR(50),

  email VARCHAR(255),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  title VARCHAR(255),
  seniority VARCHAR(50),
  department VARCHAR(100),
  phone VARCHAR(50),
  linkedin_url VARCHAR(500),

  engagement_score DECIMAL(5,2) DEFAULT 0,
  relevance_score DECIMAL(5,2) DEFAULT 0,

  is_champion BOOLEAN DEFAULT FALSE,
  is_decision_maker BOOLEAN DEFAULT FALSE,
  is_economic_buyer BOOLEAN DEFAULT FALSE,
  role_tag VARCHAR(50),

  birthday DATE,
  work_anniversary DATE,
  timezone VARCHAR(50),
  location_city VARCHAR(100),
  photo_url VARCHAR(500),
  twitter_url VARCHAR(500),
  personal_interests JSONB DEFAULT '[]',
  communication_preference VARCHAR(20),
  preferred_contact_time VARCHAR(50),
  alma_mater VARCHAR(255),
  previous_companies JSONB DEFAULT '[]',
  years_in_role INTEGER,

  last_activity_date TIMESTAMP WITH TIME ZONE,
  enriched_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_contacts_tenant ON contacts(tenant_id);
CREATE INDEX idx_contacts_company ON contacts(tenant_id, company_id);
CREATE INDEX idx_contacts_birthday ON contacts(tenant_id, birthday)
  WHERE birthday IS NOT NULL;
CREATE INDEX idx_contacts_anniversary ON contacts(tenant_id, work_anniversary)
  WHERE work_anniversary IS NOT NULL;

-- ============================================
-- RELATIONSHIP NOTES (rep-logged personal context)
-- ============================================
CREATE TABLE relationship_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  rep_crm_id VARCHAR(50) NOT NULL,

  note_type VARCHAR(30) NOT NULL,
  content TEXT NOT NULL,
  source VARCHAR(20) DEFAULT 'manual',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_rel_notes_contact ON relationship_notes(tenant_id, contact_id);
CREATE INDEX idx_rel_notes_company ON relationship_notes(tenant_id, company_id);

ALTER TABLE relationship_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON relationship_notes
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================
-- SIGNALS
-- ============================================
CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,

  signal_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  source_url VARCHAR(500),
  source VARCHAR(50) NOT NULL,

  relevance_score DECIMAL(3,2) DEFAULT 0,
  weight_multiplier DECIMAL(3,2) DEFAULT 1.0,
  recency_days INTEGER DEFAULT 0,
  weighted_score DECIMAL(5,2) DEFAULT 0,

  recommended_action TEXT,
  urgency VARCHAR(20) DEFAULT 'this_month',

  led_to_action BOOLEAN DEFAULT FALSE,
  led_to_deal_progress BOOLEAN DEFAULT FALSE,

  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_signals_tenant ON signals(tenant_id);
CREATE INDEX idx_signals_company ON signals(tenant_id, company_id);
CREATE INDEX idx_signals_detected ON signals(tenant_id, detected_at DESC);

-- ============================================
-- OPPORTUNITIES
-- ============================================
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  crm_id VARCHAR(50) NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  owner_crm_id VARCHAR(50),

  name VARCHAR(255) NOT NULL,
  value DECIMAL(12,2),
  currency VARCHAR(3) DEFAULT 'GBP',
  stage VARCHAR(100),
  stage_order INTEGER,
  probability INTEGER,

  days_in_stage INTEGER DEFAULT 0,
  stage_entered_at TIMESTAMP WITH TIME ZONE,
  expected_close_date DATE,

  is_stalled BOOLEAN DEFAULT FALSE,
  stall_reason TEXT,
  next_best_action TEXT,

  is_closed BOOLEAN DEFAULT FALSE,
  is_won BOOLEAN DEFAULT FALSE,
  closed_at TIMESTAMP WITH TIME ZONE,
  lost_reason TEXT,

  win_probability_ai DECIMAL(5,2),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_crm_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(tenant_id, crm_id)
);

CREATE INDEX idx_opps_tenant ON opportunities(tenant_id);
CREATE INDEX idx_opps_company ON opportunities(tenant_id, company_id);
CREATE INDEX idx_opps_owner ON opportunities(tenant_id, owner_crm_id);
CREATE INDEX idx_opps_stalled ON opportunities(tenant_id, is_stalled) WHERE is_stalled = true;

-- ============================================
-- FUNNEL BENCHMARKS
-- ============================================
CREATE TABLE funnel_benchmarks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  stage_name VARCHAR(100) NOT NULL,
  period VARCHAR(20) NOT NULL,
  scope VARCHAR(20) NOT NULL,
  scope_id VARCHAR(50) NOT NULL,

  conversion_rate DECIMAL(5,2),
  drop_rate DECIMAL(5,2),

  deal_count INTEGER DEFAULT 0,
  total_value DECIMAL(12,2) DEFAULT 0,
  avg_deal_value DECIMAL(12,2) DEFAULT 0,

  avg_days_in_stage DECIMAL(5,1),
  median_days_in_stage DECIMAL(5,1),

  impact_score DECIMAL(12,2) DEFAULT 0,
  stall_count INTEGER DEFAULT 0,
  stall_value DECIMAL(12,2) DEFAULT 0,

  computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(tenant_id, stage_name, period, scope, scope_id)
);

CREATE INDEX idx_funnel_tenant ON funnel_benchmarks(tenant_id);
CREATE INDEX idx_funnel_scope ON funnel_benchmarks(tenant_id, scope, scope_id);

-- ============================================
-- REP PROFILES
-- ============================================
CREATE TABLE rep_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  user_id UUID REFERENCES user_profiles(id),
  crm_id VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  slack_user_id VARCHAR(50),

  market VARCHAR(10) DEFAULT 'uk',
  team VARCHAR(100),

  comm_style VARCHAR(20) DEFAULT 'brief',
  alert_frequency VARCHAR(20) DEFAULT 'medium',
  focus_stage VARCHAR(100),
  outreach_tone VARCHAR(20) DEFAULT 'consultative',

  kpi_meetings_monthly INTEGER,
  kpi_proposals_monthly INTEGER,
  kpi_pipeline_value DECIMAL(12,2),
  kpi_win_rate DECIMAL(5,2),

  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(tenant_id, crm_id)
);

CREATE INDEX idx_reps_tenant ON rep_profiles(tenant_id);

ALTER TABLE user_profiles
  ADD CONSTRAINT fk_user_rep FOREIGN KEY (rep_profile_id)
  REFERENCES rep_profiles(id) ON DELETE SET NULL;

-- ============================================
-- SCORING SNAPSHOTS
-- ============================================
CREATE TABLE scoring_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,

  icp_fit DECIMAL(5,2),
  signal_momentum DECIMAL(5,2),
  engagement_depth DECIMAL(5,2),
  contact_coverage DECIMAL(5,2),
  stage_velocity DECIMAL(5,2),
  profile_win_rate DECIMAL(5,2),
  propensity DECIMAL(5,2),
  deal_value DECIMAL(12,2),
  expected_revenue DECIMAL(12,2),

  snapshot_trigger VARCHAR(50),
  config_version VARCHAR(20),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_snapshots_tenant ON scoring_snapshots(tenant_id);
CREATE INDEX idx_snapshots_company ON scoring_snapshots(tenant_id, company_id);

-- ============================================
-- NOTIFICATIONS
-- ============================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  user_id UUID NOT NULL,
  trigger_event_id UUID,

  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  channel VARCHAR(20) NOT NULL DEFAULT 'web_push',

  account_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  action_url VARCHAR(500),

  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP WITH TIME ZONE,
  acted_on BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(tenant_id, user_id, read, created_at DESC);

-- ============================================
-- AI CONVERSATIONS
-- ============================================
CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  user_id UUID NOT NULL,

  thread_type VARCHAR(20) DEFAULT 'general',
  thread_entity_id UUID,

  messages JSONB NOT NULL DEFAULT '[]',
  message_count INTEGER DEFAULT 0,
  total_tokens_used INTEGER DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_conversations_user ON ai_conversations(tenant_id, user_id, updated_at DESC);
CREATE INDEX idx_conversations_entity ON ai_conversations(thread_entity_id)
  WHERE thread_entity_id IS NOT NULL;

-- ============================================
-- ENRICHMENT JOBS
-- ============================================
CREATE TABLE enrichment_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  job_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  result JSONB,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_enrichment_jobs_pending ON enrichment_jobs(tenant_id, status, priority DESC)
  WHERE status = 'pending';

-- ============================================
-- ALERT FEEDBACK
-- ============================================
CREATE TABLE alert_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  rep_crm_id VARCHAR(50) NOT NULL,
  alert_type VARCHAR(50) NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  reaction VARCHAR(10),
  feedback_reason VARCHAR(100),
  action_taken BOOLEAN DEFAULT FALSE,
  outcome_action VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_feedback_tenant ON alert_feedback(tenant_id);

-- ============================================
-- IMPLICIT SIGNALS (zero-disruption tracking)
-- ============================================
CREATE TABLE implicit_signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  rep_crm_id VARCHAR(50) NOT NULL,
  signal_type VARCHAR(30) NOT NULL,
  entity_type VARCHAR(20),
  entity_id VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_implicit_signals_tenant ON implicit_signals(tenant_id, rep_crm_id, created_at DESC);

ALTER TABLE implicit_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON implicit_signals
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================
-- WEEKLY PULSE RESPONSES (power-user feedback)
-- ============================================
CREATE TABLE weekly_pulse_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  rep_crm_id VARCHAR(50) NOT NULL,
  week_start DATE NOT NULL,
  top_account_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  account_outcome VARCHAR(20),
  priority_accuracy VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(tenant_id, rep_crm_id, week_start)
);

ALTER TABLE weekly_pulse_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON weekly_pulse_responses
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================
-- DEAL OUTCOMES (for recalibration)
-- ============================================
CREATE TABLE deal_outcomes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,

  icp_score_at_entry DECIMAL(5,2),
  signal_score_at_entry DECIMAL(5,2),
  engagement_score_at_entry DECIMAL(5,2),
  contact_coverage_at_entry DECIMAL(5,2),
  velocity_at_entry DECIMAL(5,2),
  win_rate_at_entry DECIMAL(5,2),
  propensity_at_entry DECIMAL(5,2),

  stage_velocities JSONB,
  outcome VARCHAR(10) NOT NULL,
  lost_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_outcomes_tenant ON deal_outcomes(tenant_id);

-- ============================================
-- TRIGGER OVERRIDES (learning loop — feedback-driven)
-- ============================================
CREATE TABLE trigger_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  rep_crm_id VARCHAR(50),
  trigger_type VARCHAR(50) NOT NULL,
  override_action VARCHAR(20) NOT NULL,
  threshold_adjustment JSONB,
  reason TEXT,
  feedback_summary JSONB,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, COALESCE(rep_crm_id, '__tenant__'), trigger_type)
);

CREATE INDEX idx_trigger_overrides_tenant ON trigger_overrides(tenant_id, active);

-- ============================================
-- CALIBRATION PROPOSALS (offline recalibration)
-- ============================================
CREATE TABLE calibration_proposals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  config_type VARCHAR(20) NOT NULL,
  current_config JSONB NOT NULL,
  proposed_config JSONB NOT NULL,
  analysis JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  reviewed_by UUID,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  applied_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_calibration_proposals_tenant ON calibration_proposals(tenant_id, status);

-- ============================================
-- AGENT INTERACTION OUTCOMES (agent learning)
-- ============================================
CREATE TABLE agent_interaction_outcomes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  conversation_id UUID REFERENCES ai_conversations(id) ON DELETE SET NULL,
  rep_crm_id VARCHAR(50) NOT NULL,
  query_type VARCHAR(30) NOT NULL,
  query_summary TEXT,
  response_summary TEXT,
  feedback VARCHAR(10),
  downstream_outcome VARCHAR(30),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_agent_outcomes_tenant ON agent_interaction_outcomes(tenant_id, rep_crm_id);
CREATE INDEX idx_agent_outcomes_feedback ON agent_interaction_outcomes(tenant_id, feedback)
  WHERE feedback IS NOT NULL;

-- ============================================
-- TRIGGERS: auto-update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER opportunities_updated_at BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER rep_profiles_updated_at BEFORE UPDATE ON rep_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- CRON RUNS (observability)
-- ============================================
CREATE TABLE cron_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  route VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL,
  duration_ms INTEGER,
  records_processed INTEGER DEFAULT 0,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cron_runs_route ON cron_runs(route, created_at DESC);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE rep_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrichment_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON companies
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "tenant_isolation" ON contacts
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "tenant_isolation" ON signals
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "tenant_isolation" ON opportunities
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "tenant_isolation" ON funnel_benchmarks
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "tenant_isolation" ON rep_profiles
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "tenant_isolation" ON scoring_snapshots
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "tenant_isolation" ON notifications
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "tenant_isolation" ON ai_conversations
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "tenant_isolation" ON enrichment_jobs
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "tenant_isolation" ON alert_feedback
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "tenant_isolation" ON deal_outcomes
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

ALTER TABLE trigger_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON trigger_overrides
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

ALTER TABLE calibration_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON calibration_proposals
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

ALTER TABLE agent_interaction_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON agent_interaction_outcomes
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================
-- TABLE: Adoption metrics (leading adoption indicator)
-- ============================================
CREATE TABLE adoption_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  rep_crm_id VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  briefing_opened BOOLEAN DEFAULT FALSE,
  briefing_responded BOOLEAN DEFAULT FALSE,
  agent_queries INTEGER DEFAULT 0,
  alerts_sent INTEGER DEFAULT 0,
  alerts_responded INTEGER DEFAULT 0,
  pull_to_push_ratio DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (tenant_id, rep_crm_id, date)
);

ALTER TABLE adoption_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON adoption_metrics
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================
-- VIEW: Rep priority accounts (preassembled)
-- ============================================
CREATE OR REPLACE VIEW v_rep_priority_accounts AS
SELECT
  c.*,
  (
    SELECT json_agg(s.* ORDER BY s.weighted_score DESC)
    FROM signals s
    WHERE s.company_id = c.id
      AND s.tenant_id = c.tenant_id
      AND s.detected_at > NOW() - INTERVAL '14 days'
  ) AS recent_signals,
  (
    SELECT json_agg(o.* ORDER BY o.value DESC)
    FROM opportunities o
    WHERE o.company_id = c.id
      AND o.tenant_id = c.tenant_id
      AND o.is_closed = false
  ) AS open_opportunities,
  (
    SELECT json_agg(ct.* ORDER BY ct.relevance_score DESC)
    FROM contacts ct
    WHERE ct.company_id = c.id
      AND ct.tenant_id = c.tenant_id
      AND ct.is_decision_maker = true
    LIMIT 5
  ) AS key_contacts
FROM companies c
ORDER BY c.expected_revenue DESC;
