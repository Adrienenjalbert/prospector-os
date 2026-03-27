import { streamText, convertToCoreMessages } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { assembleAgentContext } from '@/lib/agent/context-builder'
import { buildSystemPrompt } from '@/lib/agent/prompt-builder'
import { createAgentTools } from '@/lib/agent/tools'

export async function POST(req: Request) {
  const body = await req.json()
  const {
    messages,
    context: { repId, tenantId, pageContext },
  } = body as {
    messages: { role: string; content: string }[]
    context: {
      repId: string
      tenantId: string
      pageContext?: { page: string; accountId?: string; dealId?: string }
    }
  }

  const agentContext = await assembleAgentContext(repId, tenantId, pageContext)
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
}
