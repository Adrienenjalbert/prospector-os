-- ============================================
-- PROSPECTOR OS — SUPABASE SCHEMA
-- Intelligence layer that sits between CRM and AI agent
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- COMPANIES (enriched mirror of CRM accounts)
-- ============================================
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  crm_id VARCHAR(50) UNIQUE NOT NULL,
  crm_source VARCHAR(20) NOT NULL DEFAULT 'salesforce',
  
  -- Basic
  name VARCHAR(255) NOT NULL,
  domain VARCHAR(255),
  website VARCHAR(500),
  
  -- Firmographics (from Apollo)
  industry VARCHAR(100),
  industry_group VARCHAR(100),
  employee_count INTEGER,
  employee_range VARCHAR(50),
  annual_revenue DECIMAL(15,2),
  revenue_range VARCHAR(50),
  founded_year INTEGER,
  
  -- Location
  hq_city VARCHAR(100),
  hq_country VARCHAR(100),
  location_count INTEGER DEFAULT 1,
  locations JSONB DEFAULT '[]',
  
  -- Tech
  tech_stack JSONB DEFAULT '[]',
  
  -- Ownership (CRM rep)
  owner_crm_id VARCHAR(50),
  owner_name VARCHAR(255),
  owner_email VARCHAR(255),
  
  -- SCORES (all 0-100)
  icp_score DECIMAL(5,2) DEFAULT 0,
  icp_tier VARCHAR(1) DEFAULT 'D',
  icp_dimensions JSONB DEFAULT '{}',
  signal_score DECIMAL(5,2) DEFAULT 0,
  engagement_score DECIMAL(5,2) DEFAULT 0,
  composite_priority_score DECIMAL(5,2) DEFAULT 0,
  priority_tier VARCHAR(10) DEFAULT 'MONITOR',
  priority_reason TEXT,
  
  -- Enrichment metadata
  enriched_at TIMESTAMP WITH TIME ZONE,
  enrichment_source VARCHAR(50),
  enrichment_data JSONB DEFAULT '{}',
  last_signal_check TIMESTAMP WITH TIME ZONE,
  icp_config_version VARCHAR(20),
  
  -- Temporal
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_activity_date TIMESTAMP WITH TIME ZONE,
  last_crm_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_companies_crm_id ON companies(crm_id);
CREATE INDEX idx_companies_owner ON companies(owner_crm_id);
CREATE INDEX idx_companies_priority ON companies(composite_priority_score DESC);
CREATE INDEX idx_companies_tier ON companies(icp_tier);
CREATE INDEX idx_companies_priority_tier ON companies(priority_tier);

-- ============================================
-- CONTACTS (decision makers from Apollo)
-- ============================================
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  crm_id VARCHAR(50),
  apollo_id VARCHAR(50),
  
  email VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  title VARCHAR(255),
  seniority VARCHAR(50),
  department VARCHAR(100),
  phone VARCHAR(50),
  linkedin_url VARCHAR(500),
  
  -- Scoring
  engagement_score DECIMAL(5,2) DEFAULT 0,
  relevance_score DECIMAL(5,2) DEFAULT 0,
  
  -- Flags
  is_champion BOOLEAN DEFAULT FALSE,
  is_decision_maker BOOLEAN DEFAULT FALSE,
  
  -- Temporal
  last_activity_date TIMESTAMP WITH TIME ZONE,
  enriched_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_contacts_crm ON contacts(crm_id);

-- ============================================
-- SIGNALS (buying intent events)
-- ============================================
CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  
  signal_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  source_url VARCHAR(500),
  source VARCHAR(50) NOT NULL,
  
  -- Scoring
  relevance_score DECIMAL(3,2) DEFAULT 0,
  weight_multiplier DECIMAL(3,2) DEFAULT 1.0,
  recency_days INTEGER DEFAULT 0,
  weighted_score DECIMAL(5,2) DEFAULT 0,
  
  -- Action
  recommended_action TEXT,
  urgency VARCHAR(20) DEFAULT 'this_month',
  
  -- Temporal
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_signals_company ON signals(company_id);
CREATE INDEX idx_signals_detected ON signals(detected_at DESC);
CREATE INDEX idx_signals_urgency ON signals(urgency);

-- ============================================
-- OPPORTUNITIES (pipeline mirror from CRM)
-- ============================================
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  crm_id VARCHAR(50) UNIQUE NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  owner_crm_id VARCHAR(50),
  
  name VARCHAR(255) NOT NULL,
  value DECIMAL(12,2),
  currency VARCHAR(3) DEFAULT 'GBP',
  stage VARCHAR(100),
  stage_order INTEGER,
  probability INTEGER,
  
  -- Velocity
  days_in_stage INTEGER DEFAULT 0,
  stage_entered_at TIMESTAMP WITH TIME ZONE,
  expected_close_date DATE,
  
  -- Flags
  is_stalled BOOLEAN DEFAULT FALSE,
  stall_reason TEXT,
  next_best_action TEXT,
  
  -- Outcome
  is_closed BOOLEAN DEFAULT FALSE,
  is_won BOOLEAN DEFAULT FALSE,
  closed_at TIMESTAMP WITH TIME ZONE,
  lost_reason TEXT,
  
  -- AI
  win_probability_ai DECIMAL(5,2),
  
  -- Temporal
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_crm_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_opps_company ON opportunities(company_id);
CREATE INDEX idx_opps_owner ON opportunities(owner_crm_id);
CREATE INDEX idx_opps_stage ON opportunities(stage);
CREATE INDEX idx_opps_stalled ON opportunities(is_stalled) WHERE is_stalled = true;

-- ============================================
-- FUNNEL BENCHMARKS (computed weekly)
-- ============================================
CREATE TABLE funnel_benchmarks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stage_name VARCHAR(100) NOT NULL,
  period VARCHAR(20) NOT NULL,
  scope VARCHAR(20) NOT NULL,
  scope_id VARCHAR(50) NOT NULL,
  
  -- Rates
  conversion_rate DECIMAL(5,2),
  drop_rate DECIMAL(5,2),
  
  -- Volume
  deal_count INTEGER DEFAULT 0,
  total_value DECIMAL(12,2) DEFAULT 0,
  avg_deal_value DECIMAL(12,2) DEFAULT 0,
  
  -- Velocity
  avg_days_in_stage DECIMAL(5,1),
  median_days_in_stage DECIMAL(5,1),
  
  -- Impact
  impact_score DECIMAL(12,2) DEFAULT 0,
  stall_count INTEGER DEFAULT 0,
  stall_value DECIMAL(12,2) DEFAULT 0,
  
  computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(stage_name, period, scope, scope_id)
);

CREATE INDEX idx_funnel_scope ON funnel_benchmarks(scope, scope_id);

-- ============================================
-- REP PROFILES (preferences + KPIs)
-- ============================================
CREATE TABLE rep_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  crm_id VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  slack_user_id VARCHAR(50),
  
  -- Context
  market VARCHAR(10) DEFAULT 'uk',
  team VARCHAR(100),
  
  -- Preferences
  comm_style VARCHAR(20) DEFAULT 'brief',
  alert_frequency VARCHAR(20) DEFAULT 'medium',
  focus_stage VARCHAR(100),
  outreach_tone VARCHAR(20) DEFAULT 'consultative',
  
  -- KPIs
  kpi_meetings_monthly INTEGER,
  kpi_proposals_monthly INTEGER,
  kpi_pipeline_value DECIMAL(12,2),
  kpi_win_rate DECIMAL(5,2),
  
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- CONFIG TABLES (replaces JSON files for easier updates)
-- ============================================
CREATE TABLE icp_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version VARCHAR(20) NOT NULL,
  business VARCHAR(50) NOT NULL,
  dimensions JSONB NOT NULL,
  tier_thresholds JSONB NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE signal_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version VARCHAR(20) NOT NULL,
  business VARCHAR(50) NOT NULL,
  signal_types JSONB NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE funnel_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version VARCHAR(20) NOT NULL,
  business VARCHAR(50) NOT NULL,
  stages JSONB NOT NULL,
  benchmark_config JSONB NOT NULL,
  stall_config JSONB NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- FEEDBACK TRACKING (for self-improvement)
-- ============================================
CREATE TABLE alert_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rep_crm_id VARCHAR(50) NOT NULL,
  alert_type VARCHAR(50) NOT NULL,
  company_id UUID REFERENCES companies(id),
  reaction VARCHAR(10),  -- 'positive', 'negative', 'ignored'
  action_taken BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE deal_outcomes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  opportunity_id UUID REFERENCES opportunities(id),
  company_id UUID REFERENCES companies(id),
  icp_score_at_entry DECIMAL(5,2),
  signal_score_at_entry DECIMAL(5,2),
  engagement_score_at_entry DECIMAL(5,2),
  composite_score_at_entry DECIMAL(5,2),
  stage_velocities JSONB,
  outcome VARCHAR(10) NOT NULL,  -- 'won', 'lost'
  lost_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- HELPER: Auto-update updated_at
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

-- ============================================
-- VIEW: Rep context (pre-assembled for speed)
-- ============================================
CREATE OR REPLACE VIEW v_rep_priority_accounts AS
SELECT 
  c.*,
  (
    SELECT json_agg(s.* ORDER BY s.weighted_score DESC)
    FROM signals s 
    WHERE s.company_id = c.id 
      AND s.detected_at > NOW() - INTERVAL '14 days'
  ) as recent_signals,
  (
    SELECT json_agg(o.* ORDER BY o.value DESC)
    FROM opportunities o 
    WHERE o.company_id = c.id 
      AND o.is_closed = false
  ) as open_opportunities,
  (
    SELECT json_agg(ct.* ORDER BY ct.relevance_score DESC)
    FROM contacts ct
    WHERE ct.company_id = c.id
      AND ct.is_decision_maker = true
    LIMIT 5
  ) as key_contacts
FROM companies c
ORDER BY c.composite_priority_score DESC;
