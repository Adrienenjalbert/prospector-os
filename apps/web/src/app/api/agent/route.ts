import { streamText, convertToCoreMessages } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { assembleAgentContext } from '@/lib/agent/context-builder'
import { buildSystemPrompt } from '@/lib/agent/prompt-builder'
import { createAgentTools } from '@/lib/agent/tools'

const THREAD_TYPE = 'general'
const ROLLING_MESSAGE_LIMIT = 20

const SONNET_MODEL = 'claude-sonnet-4-20250514'
const HAIKU_MODEL = 'claude-haiku-4-20250514'

const USAGE_MONTH_KEY = 'prospector_ai_usage_month'

function currentUsageMonthKey(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const requestSchema = z.object({
  messages: z.array(
    z.object({ role: z.string(), content: z.string() })
  ),
  context: z.object({
    pageContext: z
      .object({
        page: z.string(),
        accountId: z.string().optional(),
        dealId: z.string().optional(),
      })
      .optional(),
  }),
})

export async function POST(req: Request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const token = authHeader.slice(7)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id, rep_profile_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return new Response(JSON.stringify({ error: 'User profile not found' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { data: repProfile } = await supabase
      .from('rep_profiles')
      .select('crm_id')
      .eq('id', profile.rep_profile_id)
      .single()

    const body = await req.json()
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: parsed.error.issues }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const tenantId = profile.tenant_id
    const repId = repProfile?.crm_id ?? user.id
    const { messages, context } = parsed.data

    const { data: tenantRow, error: tenantError } = await supabase
      .from('tenants')
      .select('ai_token_budget_monthly, ai_tokens_used_current, business_config')
      .eq('id', tenantId)
      .single()

    if (tenantError || !tenantRow) {
      return new Response(JSON.stringify({ error: 'Tenant not found' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const monthKey = currentUsageMonthKey()
    const cfg = (tenantRow.business_config as Record<string, unknown> | null) ?? {}
    const storedMonth =
      typeof cfg[USAGE_MONTH_KEY] === 'string' ? (cfg[USAGE_MONTH_KEY] as string) : null

    let tokensUsed = tenantRow.ai_tokens_used_current ?? 0

    if (storedMonth !== monthKey) {
      const mergedConfig = { ...cfg, [USAGE_MONTH_KEY]: monthKey }
      const { error: resetErr } = await supabase
        .from('tenants')
        .update({
          ai_tokens_used_current: 0,
          business_config: mergedConfig,
        })
        .eq('id', tenantId)

      if (resetErr) {
        console.error('[agent] monthly reset:', resetErr)
      } else {
        tokensUsed = 0
      }
    }

    const budget = tenantRow.ai_token_budget_monthly ?? 1_000_000

    if (tokensUsed >= budget) {
      return new Response(
        JSON.stringify({
          error: 'AI budget exceeded for this month. Contact your admin.',
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const useHaiku = tokensUsed >= budget * 0.9
    const modelId = useHaiku ? HAIKU_MODEL : SONNET_MODEL

    const agentContext = await assembleAgentContext(
      repId,
      tenantId,
      context.pageContext
    )
    const systemPrompt = buildSystemPrompt(agentContext)
    const tools = createAgentTools(tenantId, repId)

    const lastUserMessage = messages.filter((m) => m.role === 'user').pop()?.content ?? ''
    const queryType = classifyQueryType(lastUserMessage)

    const interactionId = crypto.randomUUID()
    try {
      await supabase.from('agent_interaction_outcomes').insert({
        id: interactionId,
        tenant_id: tenantId,
        conversation_id: null,
        rep_crm_id: repId,
        query_type: queryType,
        query_summary: lastUserMessage.slice(0, 200),
        response_summary: null,
        feedback: null,
        downstream_outcome: null,
      })
    } catch {
      // Non-blocking
    }

    const result = streamText({
      model: anthropic(modelId),
      system: systemPrompt,
      messages: convertToCoreMessages(
        messages.map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        }))
      ),
      tools,
      maxSteps: 5,
      temperature: 0.3,
      maxTokens: 3000,
      onFinish: async (event) => {
        try {
          const assistantText = event.steps
            .map((s) => s.text)
            .filter((t) => t && t.trim().length > 0)
            .join('\n\n')
            .trim()

          const usageTotal = event.steps.reduce(
            (acc, s) => acc + (s.usage?.totalTokens ?? 0),
            0
          )

          const baseMessages = messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }))

          const fullMessages = [...baseMessages]
          if (assistantText) {
            fullMessages.push({ role: 'assistant' as const, content: assistantText })
          }

          const rolling = fullMessages.slice(-ROLLING_MESSAGE_LIMIT)

          const { data: existing } = await supabase
            .from('ai_conversations')
            .select('id, total_tokens_used')
            .eq('user_id', user.id)
            .eq('tenant_id', tenantId)
            .eq('thread_type', THREAD_TYPE)
            .is('thread_entity_id', null)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          const totalTokensUsed = (existing?.total_tokens_used ?? 0) + usageTotal

          const payload = {
            tenant_id: tenantId,
            user_id: user.id,
            thread_type: THREAD_TYPE,
            thread_entity_id: null as string | null,
            messages: rolling,
            message_count: rolling.length,
            total_tokens_used: totalTokensUsed,
          }

          if (existing?.id) {
            await supabase.from('ai_conversations').update(payload).eq('id', existing.id)
          } else {
            await supabase.from('ai_conversations').insert(payload)
          }

          const finishMonth = currentUsageMonthKey()
          const { data: usageTenant } = await supabase
            .from('tenants')
            .select('ai_tokens_used_current, business_config')
            .eq('id', tenantId)
            .single()

          const usageCfg = (usageTenant?.business_config as Record<string, unknown> | null) ?? {}
          const usageStored =
            typeof usageCfg[USAGE_MONTH_KEY] === 'string'
              ? (usageCfg[USAGE_MONTH_KEY] as string)
              : null

          if (usageStored !== finishMonth) {
            await supabase
              .from('tenants')
              .update({
                ai_tokens_used_current: usageTotal,
                business_config: { ...usageCfg, [USAGE_MONTH_KEY]: finishMonth },
              })
              .eq('id', tenantId)
          } else {
            await supabase
              .from('tenants')
              .update({
                ai_tokens_used_current: (usageTenant?.ai_tokens_used_current ?? 0) + usageTotal,
              })
              .eq('id', tenantId)
          }
          const conversationId = existing?.id ?? null

          try {
            await supabase
              .from('agent_interaction_outcomes')
              .update({
                conversation_id: conversationId,
                response_summary: assistantText.slice(0, 500),
              })
              .eq('id', interactionId)
          } catch (trackErr) {
            console.error('[agent] interaction tracking:', trackErr)
          }
        } catch (persistErr) {
          console.error('[agent] onFinish persist:', persistErr)
        }
      },
    })

    return result.toDataStreamResponse({
      headers: {
        'X-Interaction-Id': interactionId,
      },
    })
  } catch (err) {
    console.error('[agent] Error:', err)
    return new Response(
      JSON.stringify({ error: 'Agent unavailable. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

function classifyQueryType(message: string): string {
  const lower = message.toLowerCase()

  const patterns: [RegExp, string][] = [
    [/(?:draft|write|compose|email|outreach|message|reach out)/i, 'outreach_draft'],
    [/(?:deal|close|negotiat|proposal|contract|win)/i, 'deal_strategy'],
    [/(?:funnel|pipeline|conversion|drop|stage|benchmark)/i, 'funnel_question'],
    [/(?:research|company|about|tell me|look up|who is|what does)/i, 'account_research'],
    [/(?:priorit|focus|top account|who should|what should|next)/i, 'prioritization'],
    [/(?:stall|stuck|not moving|going dark|no response)/i, 'stall_recovery'],
    [/(?:contact|stakeholder|decision maker|champion|find.*people)/i, 'contact_discovery'],
  ]

  for (const [pattern, type] of patterns) {
    if (pattern.test(lower)) return type
  }

  return 'general'
}
