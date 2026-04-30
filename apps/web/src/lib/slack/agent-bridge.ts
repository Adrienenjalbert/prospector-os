import { createClient } from '@supabase/supabase-js'
import { generateText } from 'ai'
import { getModel } from '@/lib/agent/model-registry'
import { assembleAgentRun } from '@/lib/agent/run-agent'
import type { IntentClass } from '@/lib/agent/context'

/**
 * Slack → agent bridge. Both `/api/slack/events` (mentions, DMs) and
 * `/api/slack/commands` (slash commands) call this function. It does
 * exactly one thing: turn a free-text rep prompt into an agent
 * response, going through the same `assembleAgentRun` the dashboard
 * uses (parity contract — see MISSION §9.4).
 *
 * Differences from the dashboard route, intentionally narrow:
 *   - generateText (final) instead of streamText (incremental) — Slack
 *     posts strings, not deltas.
 *   - no compaction — Slack DMs are single-turn from the model's POV.
 *   - no per-rep rate limit at this layer — the SlackDispatcher
 *     cooldown owns rate-limiting for proactive pushes; reactive DMs
 *     are user-initiated so a separate cap is not needed.
 *   - repCommStyle defaults to 'brief' — Slack DMs render best ≤150
 *     words on a phone screen.
 *
 * Pre-Sprint-3 the slash commands route was missing entirely, so
 * `/brief Acme` didn't exist as a Slack action. The agent-bridge is
 * shared so a future protocol refactor (e.g. moving from generateText
 * to streamText for incremental Slack rendering) lands in one place.
 */
export async function callAgentForText(
  tenantId: string,
  repId: string,
  messageText: string,
): Promise<string> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('crm_type, ai_token_budget_monthly, ai_tokens_used_current, business_config')
    .eq('id', tenantId)
    .maybeSingle()

  const tokensUsed = (tenantRow?.ai_tokens_used_current as number | null) ?? 0
  const budget = (tenantRow?.ai_token_budget_monthly as number | null) ?? 1_000_000
  const modelRouting =
    ((tenantRow?.business_config as Record<string, unknown> | null)?.model_routing as
      | Record<string, string>
      | null) ?? null

  // Lightweight intent classification kept inline to mirror the
  // dashboard route's regex set without a circular import.
  const t = messageText.toLowerCase()
  const intentClass: IntentClass = /(draft|write|email|outreach)/.test(t)
    ? 'draft_outreach'
    : /(stall|risk|stuck)/.test(t)
      ? 'risk_analysis'
      : /(brief|prep|meeting)/.test(t)
        ? 'meeting_prep'
        : /(why|cause|diagnose)/.test(t)
          ? 'diagnosis'
          : 'general_query'

  const interactionId = crypto.randomUUID()

  const assembled = await assembleAgentRun({
    supabase,
    tenantId,
    repId,
    userId: repId,
    role: 'ae',
    agentTypeOverride: 'pipeline-coach',
    activeUrn: null,
    pageContext: undefined,
    userMessageText: messageText,
    intentClass,
    messages: [{ role: 'user', content: messageText }],
    interactionId,
    crmType: (tenantRow?.crm_type as string | null) ?? null,
    tokensUsedThisMonth: tokensUsed,
    monthlyBudget: budget,
    tenantModelRouting: modelRouting,
    repCommStyle: 'brief',
  })

  const result = await generateText({
    model: getModel(assembled.modelId),
    messages: assembled.messages,
    tools: assembled.tools,
    maxSteps: 8,
    temperature: 0.3,
    maxTokens: assembled.responseTokenCap,
  })

  return result.text || 'Sorry, I could not generate a response.'
}
