-- =============================================================================
-- Migration 007: Conversation summary (history compaction)
--
-- Phase 3.9. Adds three columns to ai_conversations so the route can
-- replace its hard ROLLING_MESSAGE_LIMIT = 20 message-slice with a
-- Haiku-summarised "earlier in this conversation" preamble.
--
-- Without compaction, message 21+ silently drops from the prompt and
-- the agent loses continuity it explicitly recorded earlier (working
-- assumptions, commitments, user preferences). With compaction, the
-- older half of a long thread becomes a single ≤500-token system
-- message that the prompt cache can keep in the cached prefix.
--
-- Columns:
--   summary_text          — the Haiku-generated summary (NULL when
--                            messages.length <= 12; the route doesn't
--                            bother summarising short threads).
--   summary_message_count — how many messages the summary covers, so
--                            the route can verify the summary is still
--                            valid before re-using it.
--   summary_updated_at    — when the summary was last regenerated, used
--                            for cache invalidation + observability.
--
-- The summary itself is small (max ~2KB text) and lives on the
-- conversation row rather than a separate table because (a) it's 1:1
-- with the conversation, (b) we always read it together with messages
-- on the same query, (c) cleanup is automatic via the existing
-- conversation deletion path.
-- =============================================================================

ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS summary_text TEXT,
  ADD COLUMN IF NOT EXISTS summary_message_count INTEGER,
  ADD COLUMN IF NOT EXISTS summary_updated_at TIMESTAMPTZ;

-- No index needed — the column is read alongside the row on every turn
-- via the existing conversation lookup query (per user/tenant/thread_type).
