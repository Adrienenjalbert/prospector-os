import { streamText, convertToCoreMessages } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { assembleAgentContext } from '@/lib/agent/context-builder'
import { buildSystemPrompt } from '@/lib/agent/prompt-builder'
import { createAgentTools } from '@/lib/agent/tools'

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

    const agentContext = await assembleAgentContext(
      repId,
      tenantId,
      context.pageContext
    )
    const systemPrompt = buildSystemPrompt(agentContext)
    const tools = createAgentTools(tenantId, repId)

    const result = streamText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: systemPrompt,
      messages: convertToCoreMessages(messages),
      tools,
      maxSteps: 5,
      temperature: 0.3,
      maxTokens: 3000,
    })

    return result.toDataStreamResponse()
  } catch (err) {
    console.error('[agent] Error:', err)
    return new Response(
      JSON.stringify({ error: 'Agent unavailable. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
