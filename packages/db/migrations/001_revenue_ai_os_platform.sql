-- ============================================
-- REVENUE AI OS — PLATFORM EXTENSION MIGRATION
-- Adds: tool_registry, connector_registry, business_profiles,
--        transcripts, tickets, account_health_snapshots, agent_citations
-- Extends: companies (CSM fields), rep_profiles (role field)
-- ============================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- BUSINESS PROFILES (per-tenant company context for agent)
-- ============================================
CREATE TABLE business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  company_name VARCHAR(255) NOT NULL,
  company_description TEXT,
  industry_context TEXT,
  target_industries TEXT[] DEFAULT '{}',
  ideal_customer_description TEXT,
  value_propositions JSONB DEFAULT '[]',
  operating_regions JSONB DEFAULT '[]',

  agent_name VARCHAR(100) DEFAULT 'AI Assistant',
  agent_mission TEXT,
  brand_voice TEXT,

  role_definitions JSONB NOT NULL DEFAULT '[]',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER business_profiles_updated_at BEFORE UPDATE ON business_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON business_profiles
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================
-- CONNECTOR REGISTRY (pluggable data sources)
-- ============================================
CREATE TABLE connector_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  connector_type VARCHAR(50) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  display_name VARCHAR(255) NOT NULL,

  auth_type VARCHAR(50) NOT NULL DEFAULT 'api_key',
  credentials_encrypted JSONB,

  field_mapping JSONB,

  sync_enabled BOOLEAN DEFAULT FALSE,
  sync_frequency VARCHAR(50),
  sync_config JSONB,
  last_sync_at TIMESTAMPTZ,
  last_sync_status VARCHAR(50),

  status VARCHAR(50) DEFAULT 'pending',
  last_health_check TIMESTAMPTZ,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, connector_type, provider)
);

CREATE TRIGGER connector_registry_updated_at BEFORE UPDATE ON connector_registry
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE connector_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON connector_registry
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================
-- TOOL REGISTRY (dynamic agent tools)
-- ============================================
CREATE TABLE tool_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  slug VARCHAR(100) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'data_query',

  tool_type VARCHAR(50) NOT NULL DEFAULT 'builtin',
  execution_config JSONB NOT NULL DEFAULT '{}',

  parameters_schema JSONB NOT NULL DEFAULT '{}',

  response_mapping JSONB,
  citation_config JSONB,

  available_to_roles TEXT[] NOT NULL DEFAULT '{}',
  requires_connector_id UUID REFERENCES connector_registry(id) ON DELETE SET NULL,

  enabled BOOLEAN DEFAULT TRUE,
  is_builtin BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

CREATE INDEX idx_tool_registry_tenant ON tool_registry(tenant_id, enabled);

CREATE TRIGGER tool_registry_updated_at BEFORE UPDATE ON tool_registry
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE tool_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON tool_registry
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================
-- TRANSCRIPTS (call/meeting content)
-- ============================================
CREATE TABLE transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source VARCHAR(50) NOT NULL,
  source_id VARCHAR(255) NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  rep_crm_id VARCHAR(255),
  call_type VARCHAR(50),
  occurred_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT,
  participants JSONB DEFAULT '[]',
  raw_text TEXT,
  summary TEXT,
  themes TEXT[] DEFAULT '{}',
  sentiment_score FLOAT,
  meddpicc_extracted JSONB,
  source_url TEXT,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, source, source_id)
);

CREATE INDEX idx_transcripts_tenant ON transcripts(tenant_id, company_id, occurred_at DESC);
CREATE INDEX idx_transcripts_rep ON transcripts(tenant_id, rep_crm_id, occurred_at DESC);
CREATE INDEX idx_transcripts_embedding ON transcripts USING hnsw (embedding vector_cosine_ops);

ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON transcripts
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================
-- TICKETS (support escalations)
-- ============================================
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source VARCHAR(50) NOT NULL,
  source_id VARCHAR(255) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subject TEXT,
  description TEXT,
  priority VARCHAR(20),
  status VARCHAR(50),
  sentiment_score FLOAT,
  opened_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  age_days INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, source, source_id)
);

CREATE INDEX idx_tickets_tenant ON tickets(tenant_id, company_id);
CREATE INDEX idx_tickets_open ON tickets(tenant_id, status) WHERE status != 'resolved';

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON tickets
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================
-- ACCOUNT HEALTH SNAPSHOTS (CSM surface)
-- ============================================
CREATE TABLE account_health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  churn_risk_score FLOAT,
  risk_factors JSONB,
  fulfillment_rate FLOAT,
  ticket_volume_7d INT,
  sentiment_7d FLOAT,
  last_exec_contact_days INT,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, company_id, snapshot_date)
);

CREATE INDEX idx_health_snapshots_tenant ON account_health_snapshots(tenant_id, company_id, snapshot_date DESC);

ALTER TABLE account_health_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON account_health_snapshots
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================
-- AGENT CITATIONS (trust and audit trail)
-- ============================================
CREATE TABLE agent_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interaction_id UUID REFERENCES agent_interaction_outcomes(id) ON DELETE SET NULL,
  claim_text TEXT NOT NULL,
  source_type VARCHAR(50),
  source_id VARCHAR(255),
  source_url TEXT,
  confidence FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_citations_tenant ON agent_citations(tenant_id, interaction_id);

ALTER TABLE agent_citations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON agent_citations
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================
-- SCHEMA EXTENSIONS (existing tables)
-- ============================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS csm_crm_id VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS churn_risk_score FLOAT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS churn_risk_factors JSONB;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_exec_engagement TIMESTAMPTZ;

ALTER TABLE rep_profiles ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'ae';
ALTER TABLE rep_profiles ADD COLUMN IF NOT EXISTS portfolio_tier VARCHAR(20);
