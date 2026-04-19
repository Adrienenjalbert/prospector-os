-- =============================================================================
-- Migration 012: user_profiles.metadata JSONB
-- =============================================================================
--
-- Phase 3 T2.4 — supports the baseline-survey nag's snooze + future
-- per-user UI preferences (collapsed sections, dismissed welcome
-- banners, etc.) without bloating the column count of user_profiles.
--
-- Initial keys:
--
--   metadata.baseline_nag_snoozed_until  TIMESTAMPTZ as ISO string —
--                                         "do not show the baseline
--                                         survey nag before this
--                                         instant". Set by the snooze
--                                         button on the inbox nag card.
--                                         When NULL or in the past, the
--                                         nag re-shows.
--
-- Why JSONB rather than a column-per-key:
--   - Future per-user preferences (welcome-banner-dismissed, last-seen
--     changelog version, etc.) are open-ended; column proliferation
--     burns goodwill against migration count without buying anything.
--   - JSONB indexed on the keys we actually filter on if needed
--     (today: none — the snooze read is per-user, never aggregated).
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS protects re-runs.
-- =============================================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN user_profiles.metadata IS
  'Per-user UI / behavioural preferences. Schemaless on purpose. '
  'Initial keys: baseline_nag_snoozed_until (TIMESTAMPTZ ISO string). '
  'See Phase 3 T2.4.';
