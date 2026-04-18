-- =============================================================================
-- MIGRATION 003 — Business skills (modular business_profiles)
--
-- Phase 7 of sales-harness-v2. Breaks the monolithic business_profiles JSONB
-- columns into named, independently-versioned "skill" rows so each can be
-- A/B-tested via the calibration_ledger without entangling others.
--
-- Today: business_profiles holds company_description, industry_context,
-- target_industries, value_propositions, ideal_customer_description,
-- agent_name, agent_mission, brand_voice, role_definitions as sibling
-- columns. A prompt change bundles 5 concerns.
--
-- After this migration: business_skills has one row per (tenant, skill_type,
-- version). Only one version is marked active at a time. Prompt builder
-- composes the active versions.
--
-- Backward compat: business_profiles columns are LEFT IN PLACE. The prompt
-- builder reads from skills first, falls back to business_profiles when no
-- active skill is present. Existing tenants see no behaviour change until
-- their skills table is populated (backfill step below).
-- =============================================================================

-- ============================================
-- BUSINESS SKILLS — modular agent context
-- ============================================

CREATE TABLE IF NOT EXISTS business_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Which of the five canonical skill types this row is. Keep the list
  -- closed so prompt builders can rely on stable composition.
  skill_type VARCHAR(50) NOT NULL CHECK (
    skill_type IN (
      'industry_knowledge',
      'icp_definition',
      'value_propositions',
      'objection_handlers',
      'agent_personality'
    )
  ),

  -- Version id. Multiple versions per skill_type may exist; exactly one
  -- per tenant+skill_type has active = true at a time. Rolling out a new
  -- version = insert new row, set old active=false, new active=true in a
  -- single txn (enforced by the index below).
  version VARCHAR(100) NOT NULL DEFAULT 'v1',
  active BOOLEAN NOT NULL DEFAULT TRUE,

  -- The skill payload. For text-y skills (industry_knowledge, value_props,
  -- objection_handlers, agent_personality) this is prose / markdown the
  -- prompt builder splices in. For structured skills (icp_definition) this
  -- is JSON the scoring engine reads.
  content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('text', 'json')),
  content_text TEXT,
  content_json JSONB,

  -- Link to the calibration_ledger row that promoted this version to
  -- active, so rollbacks are traceable. Null for the first seeded version.
  source_ledger_id UUID REFERENCES calibration_ledger(id),

  -- Shipping metadata.
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT business_skills_content_consistent CHECK (
    (content_type = 'text' AND content_text IS NOT NULL)
    OR
    (content_type = 'json' AND content_json IS NOT NULL)
  )
);

-- Only one active version per tenant + skill_type at a time. This is the
-- key invariant the prompt builder relies on — no composition ambiguity.
CREATE UNIQUE INDEX IF NOT EXISTS ux_business_skills_active
  ON business_skills (tenant_id, skill_type)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_business_skills_tenant_type
  ON business_skills (tenant_id, skill_type, created_at DESC);

CREATE TRIGGER business_skills_updated_at BEFORE UPDATE ON business_skills
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE business_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON business_skills
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================
-- BACKFILL — seed business_skills from the existing business_profiles rows
-- so every tenant already has a v1 of each skill post-migration.
--
-- Each INSERT uses "ON CONFLICT DO NOTHING" on the (tenant_id, skill_type,
-- version) tuple so re-runs are idempotent. The unique index above is
-- partial (only enforces uniqueness on active rows) so the same
-- (tenant, skill_type, 'v1') insert would succeed twice; we guard via
-- NOT EXISTS on the plain (tenant, type, version) instead.
-- ============================================

-- 1. industry_knowledge — merged industry_context + target_industries.
INSERT INTO business_skills (tenant_id, skill_type, version, active, content_type, content_text)
SELECT
  bp.tenant_id,
  'industry_knowledge',
  'v1',
  TRUE,
  'text',
  COALESCE(
    NULLIF(bp.industry_context, '')
      || CASE
           WHEN bp.target_industries IS NOT NULL AND array_length(bp.target_industries, 1) > 0
           THEN E'\n\nTarget industries: ' || array_to_string(bp.target_industries, ', ')
           ELSE ''
         END,
    'No industry context provided yet.'
  )
FROM business_profiles bp
WHERE NOT EXISTS (
  SELECT 1 FROM business_skills bs
  WHERE bs.tenant_id = bp.tenant_id AND bs.skill_type = 'industry_knowledge' AND bs.version = 'v1'
);

-- 2. icp_definition — merged ideal_customer_description + operating_regions.
INSERT INTO business_skills (tenant_id, skill_type, version, active, content_type, content_json)
SELECT
  bp.tenant_id,
  'icp_definition',
  'v1',
  TRUE,
  'json',
  jsonb_build_object(
    'ideal_customer_description', COALESCE(bp.ideal_customer_description, ''),
    'operating_regions', COALESCE(bp.operating_regions, '[]'::jsonb)
  )
FROM business_profiles bp
WHERE NOT EXISTS (
  SELECT 1 FROM business_skills bs
  WHERE bs.tenant_id = bp.tenant_id AND bs.skill_type = 'icp_definition' AND bs.version = 'v1'
);

-- 3. value_propositions — direct lift from the existing JSONB column.
INSERT INTO business_skills (tenant_id, skill_type, version, active, content_type, content_json)
SELECT
  bp.tenant_id,
  'value_propositions',
  'v1',
  TRUE,
  'json',
  COALESCE(bp.value_propositions, '[]'::jsonb)
FROM business_profiles bp
WHERE NOT EXISTS (
  SELECT 1 FROM business_skills bs
  WHERE bs.tenant_id = bp.tenant_id AND bs.skill_type = 'value_propositions' AND bs.version = 'v1'
);

-- 4. objection_handlers — seeded empty. Net-new field. Tenants populate
--    this via /admin/adaptation as real objections come in from transcripts.
INSERT INTO business_skills (tenant_id, skill_type, version, active, content_type, content_json)
SELECT
  bp.tenant_id,
  'objection_handlers',
  'v1',
  TRUE,
  'json',
  '[]'::jsonb
FROM business_profiles bp
WHERE NOT EXISTS (
  SELECT 1 FROM business_skills bs
  WHERE bs.tenant_id = bp.tenant_id AND bs.skill_type = 'objection_handlers' AND bs.version = 'v1'
);

-- 5. agent_personality — merged agent_name + agent_mission + brand_voice.
INSERT INTO business_skills (tenant_id, skill_type, version, active, content_type, content_json)
SELECT
  bp.tenant_id,
  'agent_personality',
  'v1',
  TRUE,
  'json',
  jsonb_build_object(
    'agent_name', COALESCE(bp.agent_name, 'AI Assistant'),
    'agent_mission', COALESCE(bp.agent_mission, ''),
    'brand_voice', COALESCE(bp.brand_voice, '')
  )
FROM business_profiles bp
WHERE NOT EXISTS (
  SELECT 1 FROM business_skills bs
  WHERE bs.tenant_id = bp.tenant_id AND bs.skill_type = 'agent_personality' AND bs.version = 'v1'
);
