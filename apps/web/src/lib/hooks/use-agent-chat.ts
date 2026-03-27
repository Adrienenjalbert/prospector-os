'use client'

import { useChat } from '@ai-sdk/react'

interface PageContext {
  page: string
  accountId?: string
  dealId?: string
}

export function useAgentChat(pageContext?: PageContext) {
  const chat = useChat({
    api: '/api/agent',
    body: {
      context: {
        pageContext,
      },
    },
    id: pageContext?.accountId ?? pageContext?.dealId ?? 'general',
  })

  return chat
}
