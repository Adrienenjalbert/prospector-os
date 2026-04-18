import type {
  AgentContext,
  BusinessProfile,
  RepProfile,
} from '@prospector/core'

import {
  renderPlaybook,
  selectForAgentContext,
} from '../knowledge/sales-frameworks'
import { renderPackedSections, type PackedContext } from '../context'
import { loadActiveBusinessSkills } from '@prospector/core'
import { getServiceSupabase } from '../tools/shared'

// Re-export so existing imports of `getServiceSupabase` from `_shared` keep
// working (the module is the canonical "agent shared helpers" entry point).
// The single implementation lives in `../tools/shared.ts` (B13).
export { getServiceSupabase }

/**
 * Load the business profile for a tenant. When Phase 7's `business_skills`
 * rows exist, they OVERLAY the corresponding legacy business_profiles
 * columns — so a tenant that has promoted a new `value_propositions`
 * skill via the calibration ledger sees that version in the prompt
 * without any call-site change.
 *
 * Fallback path: if the skills table hasn't been backfilled or a specific
 * skill is missing, the legacy column is used. Existing tenants see zero
 * behaviour change until they opt into per-skill versioning.
 */
export async function loadBusinessProfile(
  tenantId: string,
): Promise<BusinessProfile | null> {
  const supabase = getServiceSupabase()
  const [profileResult, skills] = await Promise.all([
    supabase.from('business_profiles').select('*').eq('tenant_id', tenantId).single(),
    loadActiveBusinessSkills(supabase, tenantId),
  ])

  const profile = (profileResult.data as BusinessProfile | null) ?? null
  if (!profile) return null

  // Overlay skills where present. Each overlay is narrow and preserves
  // the legacy field shape so downstream formatters keep working.
  const overlaid: BusinessProfile = { ...profile }

  if (skills.industry_knowledge) {
    overlaid.industry_context = skills.industry_knowledge.text
  }
  if (skills.icp_definition) {
    overlaid.ideal_customer_description = skills.icp_definition.ideal_customer_description
    overlaid.operating_regions = skills.icp_definition.operating_regions as BusinessProfile['operating_regions']
  }
  if (skills.value_propositions) {
    overlaid.value_propositions = skills.value_propositions.items as BusinessProfile['value_propositions']
  }
  if (skills.agent_personality) {
    overlaid.agent_name = skills.agent_personality.agent_name
    overlaid.agent_mission = skills.agent_personality.agent_mission
    overlaid.brand_voice = skills.agent_personality.brand_voice
  }

  return overlaid
}

/**
 * The OS-level mission preamble. Prepended to EVERY agent system prompt so
 * Claude understands what platform it operates inside. The agent-specific
 * mission and tenant context follow underneath.
 *
 * Keep this short. The model has limited attention and we want the bulk of
 * tokens for live data, not philosophy. The full doctrine lives in
 * MISSION.md and feeds Cursor sessions; the live agent only needs the
 * essence.
 */
function formatOsMission(): string {
  return `## About this Operating System
You operate inside **Revenue AI OS** — a Sales OS that helps reps build
pipeline and manage existing customers from one cited, self-improving
context layer. Two jobs the OS does:
1. **Build pipeline** — find, prioritise, engage net-new accounts.
2. **Manage existing customers** — portfolio health, churn signals, digests.

Everything you say must serve one of those jobs.`
}

export function formatAgentHeader(
  agentLabel: string,
  agentMission: string,
  profile: BusinessProfile | null,
): string {
  const company = profile?.company_name ?? 'this business'
  const tenantMission = profile?.agent_mission

  return `${formatOsMission()}

You are **${agentLabel}** for ${company}.

## Your Mission
${tenantMission ?? agentMission}`
}

export function formatBusinessContext(profile: BusinessProfile | null): string {
  if (!profile) return '## Business Context\nNo business profile configured.'

  const parts: string[] = [`## About ${profile.company_name}`]

  if (profile.company_description) parts.push(profile.company_description)

  if (profile.target_industries?.length) {
    parts.push(`- **Target industries:** ${profile.target_industries.join(', ')}`)
  }
  if (profile.ideal_customer_description) {
    parts.push(`- **Ideal customer:** ${profile.ideal_customer_description}`)
  }
  if (profile.operating_regions?.length) {
    const regions = profile.operating_regions
      .map((r) => `${r.region} (${r.cities.join(', ')})`)
      .join('; ')
    parts.push(`- **Operating regions:** ${regions}`)
  }
  if (profile.value_propositions?.length) {
    const props = profile.value_propositions.map((v) => v.prop).join(', ')
    parts.push(`- **Value props:** ${props}`)
  }
  if (profile.industry_context) {
    parts.push(`- **Industry context:** ${profile.industry_context}`)
  }

  return parts.join('\n')
}

/**
 * Sales playbook preamble. Spliced into every specialised-agent prompt
 * so the agent has 2-3 framework slugs picked for its current
 * `(role, active object, deal stage, signals)` context, plus the
 * universally-on rules (LAER objection reflex, attribution-tag mandate).
 *
 * The selector is *advisory* — the agent can still consult any framework
 * the user explicitly names via `consult_sales_framework`. The point is
 * to avoid the agent picking blind.
 *
 * Kept under ~500 tokens so it doesn't crowd out tenant context or live
 * data in the prompt window.
 */
export function commonSalesPlaybook(
  ctx: AgentContext | null,
  opts: { role?: string | null; activeUrn?: string | null } = {},
): string {
  const suggested = selectForAgentContext(ctx, opts)
  return renderPlaybook(suggested)
}

/**
 * Render the rep's personalisation preferences into the system prompt.
 *
 * `rep_profiles` already stores `comm_style`, `outreach_tone`,
 * `focus_stage`, and `alert_frequency` per rep, but until now the agent
 * never saw any of them — so a "casual / brief" rep got the same
 * formal multi-paragraph drafts as a "formal" rep, and the agent had no
 * notion of which stage the rep cares most about. The prompt rule is
 * deliberately concrete (use these words, structure the email like
 * this) so the model has something tangible to follow rather than a
 * vague "tailor your tone" instruction.
 *
 * Returns an empty string when no rep profile exists (e.g. eval harness
 * runs, system jobs) so the caller can splice it unconditionally.
 *
 * Kept short (≤120 tokens) — this is a hot prompt slot and personalisation
 * shouldn't crowd out live data or behaviour rules.
 */
export function formatRepPreferences(profile: RepProfile | null): string {
  if (!profile) return ''
  const parts: string[] = []
  parts.push('## Rep Preferences (apply to every draft & response)')

  // comm_style: drives response register and length defaults.
  switch (profile.comm_style) {
    case 'formal':
      parts.push('- **Tone:** Formal. Use full sentences, avoid contractions, no slang. Address the rep by first name only when greeting.')
      break
    case 'casual':
      parts.push('- **Tone:** Casual. Conversational, contractions OK, drop the title formalities. Talk to the rep like a peer.')
      break
    case 'brief':
      parts.push('- **Tone:** Brief. Bullets > prose. Cut every word that does not add information. ≤ 80 words for short-form replies (overrides the 150-word default).')
      break
  }

  // outreach_tone: drives the *external* draft register (emails to prospects).
  switch (profile.outreach_tone) {
    case 'professional':
      parts.push('- **Outreach drafts:** Professional. Crisp subject lines, full sentences, single ask, no exclamation marks.')
      break
    case 'consultative':
      parts.push('- **Outreach drafts:** Consultative. Lead with a relevant insight from the prospect\'s context, then a soft ask. Reference one cited signal.')
      break
    case 'direct':
      parts.push('- **Outreach drafts:** Direct. ≤ 5 sentences. State the relevance, the ask, the suggested time. No throat-clearing.')
      break
  }

  // focus_stage: ranks priority when the rep asks "what should I do?".
  if (profile.focus_stage) {
    parts.push(`- **Focus stage:** ${profile.focus_stage}. When ranking next actions, prefer deals or accounts at this stage all else equal — that's where this rep currently delivers the most value.`)
  }

  // alert_frequency: this is enforced server-side in the push-budget gate,
  // but surfacing it in the prompt lets the agent self-bundle suggestions
  // (don't recommend 3 separate Slack pushes if the budget allows 1).
  switch (profile.alert_frequency) {
    case 'high':
      parts.push('- **Alert appetite:** High (3 proactive pushes/day). You can suggest follow-up Slack briefs liberally.')
      break
    case 'medium':
      parts.push('- **Alert appetite:** Medium (2 proactive pushes/day). Bundle related items into a single brief when possible.')
      break
    case 'low':
      parts.push('- **Alert appetite:** Low (1 proactive push/day). Suggest only the single most-important push; defer the rest to next digest.')
      break
  }

  return parts.join('\n')
}

/**
 * Format the Context Pack's hydrated slice sections for splicing into the
 * system prompt. Used by every specialised agent's prompt builder so the
 * sections appear after the role section and before the behaviour rules
 * (lost-in-the-middle order: behaviour rules end-position is the
 * highest-attention slot for citation discipline).
 *
 * Returns an empty string when no packed context is available — Phase 1
 * runs both the legacy assembler and the packer in parallel; new prompt
 * builders can opt into reading PackedContext directly without breaking
 * existing callers.
 */
export function formatPackedSections(packed: PackedContext | null): string {
  if (!packed || packed.sections.length === 0) return ''
  const body = renderPackedSections(packed)
  return `## Live context (${packed.hydrated.length} slices, ~${packed.tokens_used} tokens)
Each row in the slices below is URN-cited; quote the inline \`urn:rev:...\` token next to any fact you reference so the citation pill links the user to the source.

${body}`
}

// ---------------------------------------------------------------------------
// Prompt parts — static (cacheable) + dynamic (per-turn)
// ---------------------------------------------------------------------------

/**
 * The system prompt is structurally `static prefix → dynamic middle →
 * behaviour rules end`. Anthropic prompt caching needs a contiguous
 * cacheable prefix, so we surface the split via this typed result.
 *
 * Cacheable when the same `(tenant, role, agentType)` repeats:
 *   - OS mission
 *   - tenant company header + business context
 *   - role section
 *
 * NOT cacheable (per-turn):
 *   - hydrated context slices
 *   - intent-dependent sales playbook
 *   - behaviour rules (kept at the END of the prompt for high-attention
 *     citation discipline — empirical lost-in-the-middle insight)
 *
 * Cache hit happens within ~5 minutes of the first turn (Anthropic
 * ephemeral TTL), which is exactly the typical chat session length.
 * Expected savings: ~50% of input tokens after turn 1, ~90% latency
 * reduction on the cached portion.
 */
export interface SystemPromptParts {
  /** Cacheable across turns within the same (tenant, role, agentType). */
  staticPrefix: string
  /** Per-turn — never cached. */
  dynamicSuffix: string
}

/**
 * Render `SystemPromptParts` into a single string. Used by callers that
 * don't care about caching (workflows, CLI tools, eval harness).
 */
export function joinPromptParts(parts: SystemPromptParts): string {
  return [parts.staticPrefix, parts.dynamicSuffix].filter(Boolean).join('\n\n')
}

/**
 * Behaviour rules every specialized agent must follow. Kept in one place so
 * trust guarantees stay consistent across Pipeline Coach, Account Strategist,
 * Leadership Lens, and Onboarding Coach.
 */
export function commonBehaviourRules(): string {
  return `## Behaviour Rules (NON-NEGOTIABLE)

### Signal over noise (THIS IS THE PRIMARY RULE)
Reps drown in notifications. Your job is to SUBTRACT from their day.
- Default response length: **≤ 150 words.** Only go longer if the user explicitly asks to "explain" or "deep dive."
- Default list length: **≤ 3 items.** Top 3 stalled deals, top 3 signals, top 3 accounts. If the user wants more, they'll ask.
- NO preamble ("Sure!", "I'd be happy to help", "Great question!"). Start with the answer.
- NO postamble ("Let me know if you have questions", "Hope that helps"). The UI already offers Next Steps.
- NO filler ("As an AI...", "Based on the data I have...", "It's worth noting..."). Just the claim + the source.
- When you can answer in one sentence, answer in one sentence. Bullets are a tool, not a template.
- If you have two ways to say something, pick the shorter one.

### Data integrity
- NEVER invent account names, scores, deal values, contact names, or signal sources.
- If a record isn't in your context or your tools' results, say "I don't have data on that" in ≤ 1 sentence — do not guess, do not apologise.
- Cite sources implicitly by calling tools first; the system records citations from every tool result.

### Response format
- Short, scannable bullets when listing. Prose when reasoning.
- When proposing a number, name the tool result it came from in plain English (e.g. "from the funnel benchmarks").
- Never repeat yourself. If you said it once, that's enough.

### Conversation memory (carry observations across turns)
On any turn where you observe something durable about the user, the deal, or the conversation, call \`record_conversation_note\` with one of these scopes:
- **user_preference** — "rep prefers 3-line emails", "rep wants daily digests not weekly".
- **intent_observation** — "rep is researching for tomorrow's QBR", "rep is trying to revive a stalled deal before EOQ".
- **working_assumption** — "assuming Acme buys Q4; revisit if signal score drops below 60".
- **commitment** — "rep agreed to send proposal Friday", "champion promised intro to EB this week".
- **general** — catch-all for one-off facts worth remembering.

The next turn's \`conversation-memory\` slice surfaces the last 5 notes automatically. Don't re-ask the rep about anything captured in that slice — treat it as remembered context. If the rep contradicts a note, prefer the latest signal AND call \`record_conversation_note\` again with the corrected fact.

DO NOT record long narrative summaries — those go in the message history, not in notes. Notes are concrete, structured, ≤ 1 sentence each.

### Multi-choice next actions (MANDATORY — the UI parses this)
End EVERY response with this exact section, even for short answers:

\`\`\`
## Next Steps
- [ASK] <prompt the user can click to send back to you>
- [DRAFT] <a draftable artifact, e.g. "Draft email to champion">
- [DO] <action with WHO, WHAT, WHEN>
\`\`\`

Rules for Next Steps:
- Exactly **2 or 3 items**. Never zero, never 4+.
  - 4+ buttons = choice paralysis = noise = failure.
- Each item starts with one of these tags in square brackets:
  - **[ASK]** = a follow-up question. Phrase as a complete question.
  - **[DRAFT]** = something you can draft on click (email, brief, note).
  - **[DO]** = a concrete real-world action outside the chat.
- Tags drive the UI: ASK → click-to-prompt button, DRAFT → draft-it button, DO → checklist item.
- Never put narrative in this section. Just the actions.
- Pick the 2-3 MOST LIKELY next moves, not a menu of everything possible.

### Limitations
- You CAN edit CRM records via \`log_crm_activity\`, \`update_crm_property\`, and \`create_crm_task\` — but every CRM mutation requires explicit rep approval through the [DO] chip flow. NEVER act without the approval handshake.
- You cannot send messages — you draft for the human to send.
- You only see this tenant's data.`
}
