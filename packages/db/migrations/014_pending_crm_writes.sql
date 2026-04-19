-- =============================================================================
-- Migration 014: pending_crm_writes
-- =============================================================================
--
-- Phase 3 T3.1 — staging table for the agent → user-approval → CRM-execution
-- pipeline.
--
-- The agent path NEVER calls HubSpot directly anymore. Instead, the
-- write-back tools (`log_crm_activity`, `update_crm_property`,
-- `create_crm_task`) insert a row into `pending_crm_writes` with the
-- proposed args + return `{ pending_id, status: 'pending' }` to the
-- agent. The agent surfaces a `[DO]` chip; the rep clicks it; the
-- approval endpoint marks the row `approved` and synchronously fires
-- the actual HubSpot call via `lib/crm-writes/executor.ts`.
--
-- This replaces the T1.1 "fail-closed everywhere" stop-gap with a real
-- approval surface. T1.1's `writeApprovalGate` middleware is now
-- redundant (kept around to stop tier-2 tools that are not in the
-- staging set; see middleware.ts notes).
--
-- LIFECYCLE:
--
--   pending → approved → executed   (happy path)
--   pending → rejected               (rep declined)
--   pending → expired                (24h TTL elapsed; no action)
--   pending → executed (with error)  (HubSpot rejected the call;
--                                      `error` populated)
--
-- The `expires_at` column lets a nightly cron sweep stale rows so the
-- queue doesn't grow unbounded for tenants that pile up `[DO]` chips
-- without clicking. T3.1 doesn't ship the sweep — it's a one-line
-- DELETE the operator can run if needed; tracked in 03-implementation-
-- log.md as a follow-up.
--
-- TENANT SCOPING:
--
--   Every row carries `tenant_id`. The approval endpoint enforces
--   `pending.tenant_id = caller.tenant_id` before flipping status.
--   RLS on `tenant_isolation` is the second line of defence.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pending_crm_writes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Auth user the agent was acting on behalf of. NULL only when the
  -- write was staged from a server-to-server context (cron, workflow);
  -- agent staging always populates it.
  requested_by_user_id UUID,

  -- Agent interaction id when the write was staged. Lets the audit
  -- log + the calibration ledger join back to the conversation that
  -- proposed the write.
  agent_interaction_id UUID,

  -- Tool slug (e.g. 'log_crm_activity', 'update_crm_property',
  -- 'create_crm_task'). Free-form VARCHAR so a future write tool
  -- lands without a schema migration.
  tool_slug VARCHAR(64) NOT NULL,

  -- URN of the target object (e.g. 'urn:rev:deal:abc'). Free-form
  -- TEXT because the URN scheme is open-ended.
  target_urn TEXT NOT NULL,

  -- The arguments the agent proposed. Validated against the tool's
  -- Zod schema at staging time; the executor re-uses the same shape.
  -- Capped at 64KB by the staging endpoint to prevent a malicious
  -- prompt from staging a megabyte of garbage.
  proposed_args JSONB NOT NULL,

  status VARCHAR(20) NOT NULL DEFAULT 'pending',

  -- Auth user who clicked [DO]. NULL until approval. Differs from
  -- requested_by_user_id when the rep approves a write someone else
  -- on the team triggered (e.g. a manager approves a CSM's draft).
  executed_by_user_id UUID,
  executed_at TIMESTAMPTZ,

  -- Populated by the executor on success. The crm_write executor
  -- returns the new HubSpot object id; we persist it so the
  -- post-approval response can cite the actual record.
  external_record_id TEXT,

  -- Populated by the executor on failure (e.g. HubSpot 4xx). Lets
  -- the UI surface "Approval succeeded but HubSpot rejected" without
  -- forcing the rep to re-stage.
  error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- 24h default TTL. The approval endpoint refuses to flip a row
  -- whose `expires_at` has passed — the agent must re-stage. Prevents
  -- a stale chip from executing a write the rep no longer wants.
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

-- Hot-path index: "show me my tenant's pending chips, newest first".
CREATE INDEX IF NOT EXISTS idx_pending_crm_writes_tenant_status
  ON pending_crm_writes (tenant_id, status, created_at DESC);

-- Closed-allowlist CHECK on status so a typo in a future code path
-- doesn't silently land an un-handled status. Worth the rigidity
-- because the lifecycle is small.
ALTER TABLE pending_crm_writes
  DROP CONSTRAINT IF EXISTS pending_crm_writes_status_chk,
  ADD CONSTRAINT pending_crm_writes_status_chk
    CHECK (status IN ('pending', 'approved', 'executed', 'rejected', 'expired'));

ALTER TABLE pending_crm_writes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON pending_crm_writes
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
