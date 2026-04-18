-- =============================================================================
-- Migration 012: Tool registry lifecycle — deprecation + multi-tenant sync
--
-- The tool integration audit surfaced two operational gaps:
--
--   1. Tool deprecation is impossible. When a slug is renamed
--      (`draft_message` → `draft_outreach`) the old slug is either left
--      enabled forever or hard-deleted. Hard-delete loses the historic
--      `agent_events.tool_called` rows the bandit reads from. Leaving
--      enabled keeps the agent surfacing the deprecated tool. Now we
--      have `deprecated_at`: the loader filters it out (so the agent
--      stops calling it) but the row stays for telemetry continuity.
--
--   2. New tools shipped in code only land in tenants where someone
--      manually re-runs `seed-tools.ts`. A tenant created last month
--      never sees a tool added this week — silent drift between code
--      and runtime. The `sync_builtin_tool_to_all_tenants` helper
--      makes a one-shot upsert across every tenant possible from a
--      single SQL statement, so a deploy can fan out new tools
--      without per-tenant scripting.
--
-- All changes additive + idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. tool_registry.deprecated_at — soft-deprecation
-- -----------------------------------------------------------------------------

ALTER TABLE tool_registry
  ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deprecation_replacement VARCHAR(100);

-- Hot-path index: the loader's per-turn query selects WHERE
-- enabled = true AND deprecated_at IS NULL. A partial index on
-- the live tools keeps the scan tight even as deprecated rows
-- accumulate.
CREATE INDEX IF NOT EXISTS idx_tool_registry_live
  ON tool_registry (tenant_id)
  WHERE enabled = TRUE AND deprecated_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. sync_builtin_tool_to_all_tenants
--
-- Used by ops to push a newly-shipped built-in tool to every tenant in
-- one statement. Idempotent (ON CONFLICT update).
--
-- Usage from psql:
--   SELECT public.sync_builtin_tool_to_all_tenants(
--     'my_new_tool',
--     'My New Tool',
--     'Tool description',
--     'data_query',
--     '{"handler":"my_new_tool"}'::jsonb,
--     '{"type":"object","properties":{},"required":[]}'::jsonb,
--     ARRAY['ae','nae']
--   );
--
-- Returns the number of tenants the tool was upserted into.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_builtin_tool_to_all_tenants(
  p_slug VARCHAR,
  p_display_name VARCHAR,
  p_description TEXT,
  p_category VARCHAR,
  p_execution_config JSONB,
  p_parameters_schema JSONB,
  p_available_to_roles VARCHAR[]
) RETURNS INTEGER AS $$
DECLARE
  affected INTEGER := 0;
BEGIN
  INSERT INTO tool_registry (
    tenant_id, slug, display_name, description, category,
    tool_type, execution_config, parameters_schema,
    available_to_roles, is_builtin, enabled
  )
  SELECT
    t.id, p_slug, p_display_name, p_description, p_category,
    'builtin', p_execution_config, p_parameters_schema,
    p_available_to_roles, TRUE, TRUE
  FROM tenants t
  ON CONFLICT (tenant_id, slug) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    execution_config = EXCLUDED.execution_config,
    parameters_schema = EXCLUDED.parameters_schema,
    available_to_roles = EXCLUDED.available_to_roles;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- 3. deprecate_tool — soft-deprecate a slug for every tenant in one call
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.deprecate_tool(
  p_slug VARCHAR,
  p_replacement_slug VARCHAR DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  affected INTEGER := 0;
BEGIN
  UPDATE tool_registry
     SET deprecated_at = COALESCE(deprecated_at, NOW()),
         deprecation_replacement = p_replacement_slug
   WHERE slug = p_slug
     AND deprecated_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
