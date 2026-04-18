'use client'

import { useCallback, useEffect, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import type { Message } from '@ai-sdk/react'
import { createSupabaseBrowser } from '@/lib/supabase/client'

interface PageContext {
  page: string
  accountId?: string
  dealId?: string
  /**
   * Canonical URN of the object the user is viewing. Drives the agent's
   * context strategy (account_deep / deal_deep) and seeds activeUrn on every
   * emitted telemetry event.
   */
  activeUrn?: string
}

export type AgentType =
  | 'pipeline-coach'
  | 'account-strategist'
  | 'leadership-lens'
  | 'onboarding-coach'

export type UseAgentChatOptions = {
  agentType?: AgentType
  pageContext?: PageContext
  initialMessages?: Message[]
  initialAccessToken?: string | null
}

export function useAgentChat(options?: UseAgentChatOptions) {
  const agentType = options?.agentType ?? 'pipeline-coach'
  const pageContext = options?.pageContext
  const initialMessages = options?.initialMessages
  const initialAccessToken = options?.initialAccessToken

  const [authHeaders, setAuthHeaders] = useState<Record<string, string>>(() => {
    const headers: Record<string, string> = {}
    if (initialAccessToken) headers.Authorization = `Bearer ${initialAccessToken}`
    return headers
  })

  const [interactionId, setInteractionId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowser()

    function applySession(accessToken: string | undefined) {
      const headers: Record<string, string> = {}
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`
      setAuthHeaders(headers)
    }

    void supabase.auth.getSession().then(({ data }) => {
      applySession(data.session?.access_token)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session?.access_token)
    })

    return () => subscription.unsubscribe()
  }, [])

  const onResponse = useCallback((response: Response) => {
    const id = response.headers.get('x-interaction-id')
    setInteractionId(id)
  }, [])

  const chat = useChat({
    api: '/api/agent',
    body: {
      agent_type: agentType,
      context: {
        pageContext,
      },
    },
    id: pageContext?.accountId ?? pageContext?.dealId ?? 'general',
    initialMessages: initialMessages ?? [],
    headers: authHeaders,
    onResponse,
  })

  return { ...chat, interactionId }
}
