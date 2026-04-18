import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ToolHandler, ToolHandlerContext } from '../../tool-loader'

/**
 * `record_conversation_note` — Phase 3.7 conversation memory.
 *
 * Lets the agent persist a structured observation between turns within a
 * single chat thread. The next turn's `conversation-memory` slice loads
 * the last N notes so the agent doesn't have to re-derive observations
 * the rep already shared.
 *
 * Why this matters:
 *   - Today, ROLLING_MESSAGE_LIMIT = 20 in the agent route truncates old
 *     messages. Long conversations lose specific facts ("user prefers
 *     3-line emails", "champion is Sarah, not Mike", "rep already tried
 *     the JOLT pivot last quarter").
 *   - Anthropic's "context engineering" doctrine says: give the agent a
 *     way to *write* notes between turns. The rolling summary (history
 *     compaction, separate Phase) covers narrative continuity; this
 *     covers specific structured facts.
 *   - Pairs with the Phase 3.6 CRM write-back: agent recommends a [DO]
 *     log_crm_activity → rep approves → record_conversation_note
 *     captures "logged Q4 stalled-deal-review note Mon 9am" → Wednesday
 *     turn knows what was already done without the rep re-explaining.
 *
 * The tool is non-mutating to CRM — writes only to ai_conversation_notes.
 * No writeApprovalGate gating; the agent can record notes freely.
 *
 * Conversation resolution: looks up the active ai_conversations row by
 * (user_id, tenant_id, thread_type='general'). When no conversation row
 * exists yet (first turn before persist), the call no-ops gracefully —
 * the recorded observation will be re-discovered on the next turn when
 * the conversation row is in place.
 */

const NOTE_SCOPES = [
  'user_preference',
  'intent_observation',
  'working_assumption',
  'commitment',
  'general',
] as const

export const recordConversationNoteSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(500)
    .describe('The observation to remember. Concrete and short — favour facts over interpretations.'),
  scope: z
    .enum(NOTE_SCOPES)
    .describe(
      'user_preference (rep style/format prefs), intent_observation (what the rep is actually trying to do), working_assumption (what the agent assumed; revisit if data shifts), commitment (something the rep or champion agreed to), general (catch-all).',
    ),
})

export type RecordConversationNoteArgs = z.infer<typeof recordConversationNoteSchema>

interface RecordResult {
  data: {
    note_id: string
    scope: string
    conversation_id: string
  } | null
  error?: string
  citations: never[]
  /**
   * When the conversation isn't persisted yet (first turn), we return
   * `awaiting_conversation: true` rather than an error — the agent can
   * silently move on, and the observation will be capturable next turn.
   */
  awaiting_conversation?: boolean
}

async function resolveConversationId(
  supabase: SupabaseClient,
  ctx: ToolHandlerContext,
): Promise<string | null> {
  if (ctx.conversationId) return ctx.conversationId
  // Fallback lookup — the agent route persists the conversation row on
  // onFinish of each turn. Turn 2+ within the same session reads the
  // existing row here.
  const { data } = await supabase
    .from('ai_conversations')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('user_id', ctx.userId)
    .eq('thread_type', 'general')
    .is('thread_entity_id', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

export const recordConversationNoteHandler: ToolHandler = {
  slug: 'record_conversation_note',
  schema: recordConversationNoteSchema,
  build: (toolCtx) => async (rawArgs) => {
    const args = rawArgs as RecordConversationNoteArgs

    const conversationId = await resolveConversationId(toolCtx.supabase, toolCtx)
    if (!conversationId) {
      // Graceful no-op on the first turn before the conversation row is
      // persisted. Agent should not retry — turn 2 will succeed.
      return {
        data: null,
        awaiting_conversation: true,
        citations: [],
      } satisfies RecordResult
    }

    // Per-conversation note cap. Without this, an agent that learns to
    // write a note per turn produces N rows per N turns; only the last
    // 5 are ever shown by the conversation-memory slice but every row
    // sits in `ai_conversation_notes` indefinitely. A long thread (50
    // turns) writes 50 rows of which 45 are dead weight — pure DB bloat
    // with zero prompt-window benefit.
    //
    // The cap is generous (50) so legitimate conversations with many
    // observations still work; the actual constraint is "don't blow
    // the table up". Hitting the cap returns a non-error skip
    // (`awaiting_conversation: false, capped: true`) so the agent
    // simply stops calling the tool — it never sees a hard failure
    // that would make it retry.
    const { count: existingCount } = await toolCtx.supabase
      .from('ai_conversation_notes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', toolCtx.tenantId)
      .eq('conversation_id', conversationId)

    const NOTES_PER_CONVERSATION_CAP = 50
    if ((existingCount ?? 0) >= NOTES_PER_CONVERSATION_CAP) {
      return {
        data: null,
        error: `Conversation note cap (${NOTES_PER_CONVERSATION_CAP}) reached — older notes still in memory; new ones rejected to prevent table bloat.`,
        citations: [],
      } satisfies RecordResult
    }

    const { data, error } = await toolCtx.supabase
      .from('ai_conversation_notes')
      .insert({
        tenant_id: toolCtx.tenantId,
        conversation_id: conversationId,
        user_id: toolCtx.userId,
        content: args.content,
        scope: args.scope,
      })
      .select('id')
      .single()

    if (error || !data) {
      return {
        data: null,
        error: `Failed to record note: ${error?.message ?? 'unknown error'}`,
        citations: [],
      } satisfies RecordResult
    }

    return {
      data: {
        note_id: data.id,
        scope: args.scope,
        conversation_id: conversationId,
      },
      citations: [],
    } satisfies RecordResult
  },
}
