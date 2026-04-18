-- =============================================================================
-- Migration 006: Conversation Memory
--
-- Phase 3.7 of the Context Pack rollout. Adds one table:
--
--   ai_conversation_notes — agent-writable scratchpad scoped to a single
--                            ai_conversations.id. Lets the agent record
--                            observations between turns ("user prefers
--                            short emails", "champion is X", "they've
--                            already tried solution Y", "rep agreed to
--                            send proposal Friday") so turn N+1 carries
--                            them forward without the rep re-asking.
--
-- Why this matters:
--   - Today the route uses a hard ROLLING_MESSAGE_LIMIT = 20 slice; long
--     conversations lose continuity at message 21. After history
--     compaction (separate Phase) the rolling summary covers the past,
--     but it's a lossy summary — specific facts the agent observed get
--     diluted.
--   - Anthropic's "context engineering" doctrine: give the agent a way
--     to *write* notes between turns so it doesn't have to re-derive.
--     The conversation-memory slice always loads turn 2+ and surfaces
--     the last 5 notes.
--   - Pairs naturally with Phase 3.6 CRM write-back: agent recommends
--     [DO] log activity → rep approves → record_conversation_note
--     captures "logged Q4 expansion stalled-deal-review note Mon 9am" →
--     Wednesday turn knows what was done without the rep re-explaining.
--
-- Scope enum keeps the agent's notes structured rather than free-form
-- — slices and the bandit can later weight different scopes differently
-- (e.g. weighing "user_preference" higher than "working_assumption").
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_conversation_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  -- Free-form text on purpose: the enum below is the structural axis,
  -- the actual content is whatever the agent thinks is worth carrying
  -- forward. Capped at ~500 chars by app-level validation, not schema.
  content TEXT NOT NULL,
  scope VARCHAR(50) NOT NULL CHECK (scope IN (
    'user_preference',     -- "Rep prefers 3-line emails"
    'intent_observation',  -- "Rep is researching for tomorrow's QBR"
    'working_assumption',  -- "Assuming Acme buys Q4; revisit if signals shift"
    'commitment',          -- "Rep promised follow-up to champion by Friday"
    'general'              -- catch-all for one-off observations
  )),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Lookup index for the slice — reads "last N notes for this conversation"
-- on every turn 2+ within an active conversation. Small N (~5-10 notes
-- per conversation typical), so the index sees mostly fresh inserts +
-- one ordered scan per turn.
CREATE INDEX IF NOT EXISTS idx_ai_conversation_notes_recent
  ON ai_conversation_notes (conversation_id, created_at DESC);

-- RLS: per-tenant isolation. The user_id column lets a future
-- /admin/adaptation surface filter "notes by rep" without cross-rep leakage.
ALTER TABLE ai_conversation_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON ai_conversation_notes
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
