-- =============================================================================
-- Migration 015: tenants.crm_write_config
-- =============================================================================
--
-- Phase 3 T3.2 — per-tenant tier-2 enablement + per-handler config.
--
-- After T3.1 every CRM write goes through `pending_crm_writes` →
-- /api/agent/approve → executor. That's a structural safety win, but
-- it doesn't answer the procurement question "which write tools are
-- on for our tenant?". Today the answer is "all three, because
-- the tools are seeded enabled in tool_registry for every tenant".
-- T3.2 makes the answer "only what the admin has explicitly
-- enabled, with an acknowledgement on file."
--
-- HOW IT WORKS:
--
--   - Every tenant has a `crm_write_config` JSONB.
--   - Defaults to all three tools OFF + acknowledgement_signed=false.
--   - Tool-loader (`apps/web/src/lib/agent/tool-loader.ts`) reads the
--     config once per request and excludes the matching write tool
--     from the agent's available set entirely. The agent literally
--     never sees the tool until the admin enables it.
--   - Admin enables a tool via the new "Tier-2 CRM write-back" panel
--     on /admin/config. Toggling the first one ON requires the
--     acknowledgement checkbox; subsequent toggles read the existing
--     ack flag.
--   - Every toggle change writes an `admin_audit_log` row (T2.1).
--
-- WHY ALL THREE TOOLS DEFAULT OFF:
--
--   - The existing T1.1 stop-gap disabled CRM writes platform-wide.
--     T3.1 + T3.2 together replace that stop-gap with a real opt-in
--     model. Defaulting OFF preserves the safety contract: an
--     admin must explicitly say "yes, the AI can propose this".
--   - For existing tenants who had writes enabled BEFORE T1.1,
--     the operator runbook in 03-implementation-log.md walks
--     through the migration: the operator runs a one-shot script
--     that toggles the historical state into crm_write_config.
--
-- SHAPE:
--
--   {
--     "log_activity": false,
--     "update_property": false,
--     "create_task": false,
--     "_enabled_at": null,            // ISO timestamp of last
--                                     // toggle ON
--     "_enabled_by": null,            // user_id of toggler
--     "_acknowledgement_signed": false,
--     "_acknowledgement_signed_at": null,
--     "_acknowledgement_signed_by": null
--   }
--
-- The `_acknowledgement_*` fields are sticky — once signed, they
-- don't reset when a tool toggles back off. Re-enabling a tool
-- after a toggle-off doesn't require re-signing the
-- acknowledgement (the ack is about understanding the model, not
-- about the specific moment of enabling).
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS protects re-runs.
-- =============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS crm_write_config JSONB
    NOT NULL DEFAULT '{
      "log_activity": false,
      "update_property": false,
      "create_task": false,
      "_enabled_at": null,
      "_enabled_by": null,
      "_acknowledgement_signed": false,
      "_acknowledgement_signed_at": null,
      "_acknowledgement_signed_by": null
    }'::jsonb;

COMMENT ON COLUMN tenants.crm_write_config IS
  'Per-tenant tier-2 CRM write-back enablement. Three toggles + an '
  'acknowledgement marker. Read by tool-loader at request time to '
  'gate which write tools the agent sees. See Phase 3 T3.2 / OQ-8.';
