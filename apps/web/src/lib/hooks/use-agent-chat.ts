'use client'

import { useEffect, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import type { Message } from '@ai-sdk/react'
import { createSupabaseBrowser } from '@/lib/supabase/client'

interface PageContext {
  page: string
  accountId?: string
  dealId?: string
}

export type UseAgentChatOptions = {
  pageContext?: PageContext
  initialMessages?: Message[]
  /** When known (e.g. after history fetch), avoids a frame without Authorization */
  initialAccessToken?: string | null
}

export function useAgentChat(options?: UseAgentChatOptions) {
  const pageContext = options?.pageContext
  const initialMessages = options?.initialMessages
  const initialAccessToken = options?.initialAccessToken

  const [authHeaders, setAuthHeaders] = useState<Record<string, string>>(() =>
    initialAccessToken
      ? { Authorization: `Bearer ${initialAccessToken}` }
      : {},
  )

  useEffect(() => {
    const supabase = createSupabaseBrowser()

    function applySession(accessToken: string | undefined) {
      setAuthHeaders(
        accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      )
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

  const chat = useChat({
    api: '/api/agent',
    body: {
      context: {
        pageContext,
      },
    },
    id: pageContext?.accountId ?? pageContext?.dealId ?? 'general',
    initialMessages: initialMessages ?? [],
    headers: authHeaders,
  })

  return chat
}
