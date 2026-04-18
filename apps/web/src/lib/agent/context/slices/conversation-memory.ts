import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import { fmtAge } from './_helpers'

/**
 * `conversation-memory` — Phase 3.7. Always-on slice that surfaces the
 * agent's own structured notes from this conversation so it doesn't have
 * to re-derive observations the rep already shared.
 *
 * Scope resolution: looks up the active ai_conversations row by
 * (user_id, tenant_id, thread_type='general'). When no conversation row
 * exists yet (first turn), the slice loads zero rows — that's the
 * intended behaviour, since the agent has nothing to remember on turn 1.
 *
 * Token budget is small (~150 tokens for 5 notes) — this slice's
 * leverage is in the *count* of observations the agent stops re-asking
 * the rep, not the depth of any single note.
 *
 * Triggered for AE/NAE/growth_AE/CSM/AD on every intent — it's a
 * universal "what we've learned in this conversation" surface.
 */

interface ConversationNoteRow {
  id: string
  content: string
  scope: string
  created_at: string
}

export const conversationMemorySlice: ContextSlice<ConversationNoteRow> = {
  slug: 'conversation-memory',
  title: "What we've established this conversation",
  category: 'meta',

  triggers: {
    // Useful on every intent — the agent should always carry forward
    // observations it recorded earlier in this thread. Roles include
    // CSM/AD because long renewal/expansion conversations benefit
    // most from cross-turn memory.
    roles: ['ae', 'nae', 'growth_ae', 'csm', 'ad'],
    intents: [
      'draft_outreach',
      'meeting_prep',
      'risk_analysis',
      'diagnosis',
      'forecast',
      'signal_triage',
      'stakeholder_mapping',
      'portfolio_health',
      'lookup',
      'general_query',
    ],
  },

  staleness: {
    ttl_ms: 60 * 1000, // refresh every minute — the agent itself is the writer
    invalidate_on: [],
  },

  token_budget: 200,
  soft_timeout_ms: 1000,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<ConversationNoteRow>> {
    const startedAt = Date.now()

    // Resolve the active conversation by the same convention the agent
    // route uses on persist: per (tenant, user, thread_type='general').
    const { data: convo } = await ctx.supabase
      .from('ai_conversations')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('user_id', ctx.userId)
      .eq('thread_type', 'general')
      .is('thread_entity_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!convo) {
      // First turn — nothing to remember yet.
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
      }
    }

    const { data: notes, error } = await ctx.supabase
      .from('ai_conversation_notes')
      .select('id, content, scope, created_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('conversation_id', convo.id)
      .order('created_at', { ascending: false })
      .limit(5)

    if (error) {
      throw new Error(`conversation-memory query failed: ${error.message}`)
    }

    return {
      rows: notes ?? [],
      // No citations — these are agent's own observations, not external
      // facts. The agent should treat them as remembered context, not
      // sources to quote with URN pills.
      citations: [],
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
    }
  },

  formatForPrompt(rows: ConversationNoteRow[]): string {
    if (rows.length === 0) return ''
    const lines = rows.map((r) => {
      return `- [${r.scope}] ${r.content} (${fmtAge(r.created_at)})`
    })
    return `### What we've established this conversation
${lines.join('\n')}

_Carry these forward — don't re-ask the rep about anything captured here. If the rep contradicts a note, prefer the latest signal and call \`record_conversation_note\` to update with the corrected fact._`
  },

  citeRow(_row) {
    // Conversation notes are not citable external facts; they're the
    // agent's own observations. Return a synthetic citation type
    // ('memory') so the existing citation pipeline doesn't choke.
    return {
      claim_text: "Earlier in this conversation",
      source_type: 'memory',
    }
  },
}
