-- =============================================================================
-- Migration 008: Account hierarchy / family tree
--
-- Phase 3.10. Today subsidiaries and their parent are unrelated rows in
-- `companies`. So when the rep wins Acme Logistics, the agent has no idea
-- Acme Manufacturing is a "we already won the parent" play, not a cold
-- prospect. HubSpot's Companies API exposes a `parent_company`
-- association we don't currently sync; Salesforce has Account.ParentId
-- natively (Phase 4 / 5 for SF parity).
--
-- Three columns added to `companies`:
--
--   parent_company_id      Self-FK to the canonical parent's row. NULL
--                          for unrelated/standalone accounts.
--   parent_crm_id          Raw HubSpot id of the parent, captured on sync
--                          before we have its canonical id resolved.
--                          A second sync pass walks parent_crm_id and
--                          fills parent_company_id where it can.
--   is_account_family_root TRUE for the top-most company in a family
--                          (parent_company_id IS NULL but at least one
--                          other row points to it). Maintained by the
--                          sync workflow.
--
-- Why two parent columns instead of one: HubSpot's parent_company is a
-- crm_id, not our canonical id. The sync writes parent_crm_id first
-- (always available), then a follow-up resolution pass fills
-- parent_company_id. The agent reads parent_company_id (resolved); the
-- sync owns the bookkeeping.
-- =============================================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS parent_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_crm_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS is_account_family_root BOOLEAN DEFAULT FALSE;

-- Index for the family-tree slice's typical query: "give me all rows whose
-- parent_company_id = this row's parent_company_id" — siblings are the
-- common case, plus the parent + this row itself. A simple b-tree on the
-- parent column handles this well.
CREATE INDEX IF NOT EXISTS idx_companies_parent_company_id
  ON companies (tenant_id, parent_company_id)
  WHERE parent_company_id IS NOT NULL;

-- Index for the post-sync resolution pass that walks parent_crm_id rows
-- and fills parent_company_id. Partial index to keep it tiny — most
-- companies won't have a parent_crm_id.
CREATE INDEX IF NOT EXISTS idx_companies_parent_crm_id
  ON companies (tenant_id, parent_crm_id)
  WHERE parent_crm_id IS NOT NULL;
