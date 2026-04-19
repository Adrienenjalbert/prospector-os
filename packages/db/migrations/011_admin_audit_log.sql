-- =============================================================================
-- Migration 011: Admin audit log
-- =============================================================================
--
-- Phase 3 T2.1 — closes audit area A's "no admin audit log" gap.
-- The audit found: every admin write to a tenant config or proposal goes
-- straight through `tenants` / `calibration_proposals` updates with no shadow
-- row. Without this, "who changed the ICP weights last Tuesday?" or "who
-- approved the prompt diff that broke the pilot?" has no answer.
--
-- Adds ONE table:
--
--   admin_audit_log — append-only record of every admin write. Keyed by
--                      (tenant_id, occurred_at) so the typical
--                      "show last 50 admin actions for tenant X" query is a
--                      single index scan.
--
-- WHAT IS RECORDED:
--
--   action       — slug like 'config.upsert', 'calibration.approve',
--                  'calibration.reject', 'onboarding.apply_icp',
--                  'onboarding.apply_funnel'. (Future: 'tier2.toggle',
--                  'retention.override.set', 'holdout.percent.set',
--                  'tenant.export'.)
--   target       — free-text description of WHAT was changed
--                  (e.g. 'tenants.icp_config', 'calibration_proposals[uuid]').
--                  Tied to the action slug; the audit-log UI parses both.
--   before/after — JSONB snapshots of the config / row state. NULL on
--                  inserts (before only) or rejections (after only).
--                  Capped at 256KB by the application layer.
--   metadata     — caller-supplied extras (proposal_id, ip, user agent
--                  hash, tier-2 acknowledgement signature, etc.).
--                  Schemaless on purpose — actions evolve.
--
-- WHAT IS NOT RECORDED:
--
--   - Read-only admin actions (page views, list filters). Out of scope —
--     the audit's concern is mutations, not reads.
--   - Cron / workflow writes. Those have their own observability via
--     `cron_runs` and `agent_events`. Adding a log row per nightly
--     workflow run would swamp the table.
--
-- TAMPER-EVIDENCE: not in scope for T2.1. The proposal explicitly defers
-- hash-chain tamper-evidence to the SOC 2 work later. For pilot tenants the
-- append-only convention + RLS + service-role-only writes is sufficient.
-- =============================================================================

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Auth user who performed the action. NULL only for system-level admin
  -- actions (e.g. a workflow that promotes a calibration proposal — none
  -- ship in T2.1, but the column allows it).
  user_id UUID,

  -- Slug like 'config.upsert', 'calibration.approve'. Free-form on
  -- purpose so new admin actions can land without a migration; the UI
  -- shows both raw + human-rendered versions.
  action VARCHAR(80) NOT NULL,

  -- Description of WHAT changed (table.column or table[id]). Free-form.
  target TEXT NOT NULL,

  -- JSONB snapshots. NULL is meaningful:
  --   before NULL  → insert (no prior state)
  --   after NULL   → delete or rejection (no resulting state)
  before JSONB,
  after JSONB,

  -- Caller-supplied extras: proposal_id, request id, etc.
  metadata JSONB DEFAULT '{}',

  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hot-path index: "show last N admin actions for this tenant".
CREATE INDEX IF NOT EXISTS idx_admin_audit_tenant_time
  ON admin_audit_log (tenant_id, occurred_at DESC);

-- Filter index: "show all calibration approvals for this tenant".
CREATE INDEX IF NOT EXISTS idx_admin_audit_tenant_action
  ON admin_audit_log (tenant_id, action, occurred_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Read access: anyone in the tenant can read their own audit log. The
-- /admin/audit-log UI is gated to admin/revops roles at the route, but
-- RLS allows the rest of the tenant's users a peek if they hit the
-- table directly (read-only).
CREATE POLICY "tenant_isolation" ON admin_audit_log
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
