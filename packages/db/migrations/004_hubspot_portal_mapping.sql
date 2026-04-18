-- =============================================================================
-- MIGRATION 004 — HubSpot portal mapping
--
-- Adds hubspot_portal_id to tenants so the meeting webhook can route inbound
-- events to the correct tenant. Previously the route used .eq('crm_type',
-- 'hubspot').limit(1) which returned the first HubSpot tenant — a multi-tenant
-- correctness bug (events would be attributed to the wrong customer).
--
-- After this migration: every HubSpot tenant must have hubspot_portal_id set
-- to the numeric portal id from their HubSpot account. The webhook reads it
-- from the event payload (event.portalId) and looks up the tenant by it.
-- =============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS hubspot_portal_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_hubspot_portal_id
  ON tenants (hubspot_portal_id)
  WHERE hubspot_portal_id IS NOT NULL;
