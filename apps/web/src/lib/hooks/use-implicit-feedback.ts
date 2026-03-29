'use client'

import { useCallback, useRef } from 'react'
import { trackImplicitSignal, type ImplicitSignalType } from '@/app/actions/implicit-feedback'

export function useImplicitFeedback() {
  const trackedRef = useRef(new Set<string>())

  const track = useCallback(
    (signalType: ImplicitSignalType, entityType: string, entityId: string, metadata?: Record<string, unknown>) => {
      const key = `${signalType}:${entityType}:${entityId}`
      if (trackedRef.current.has(key)) return
      trackedRef.current.add(key)
      trackImplicitSignal(signalType, entityType, entityId, metadata).catch(() => {})
    },
    []
  )

  const trackCardExpanded = useCallback(
    (accountId: string) => track('card_expanded', 'account', accountId),
    [track]
  )

  const trackCardDrafted = useCallback(
    (accountId: string) => track('card_drafted', 'account', accountId),
    [track]
  )

  const trackCardSkipped = useCallback(
    (accountId: string) => track('card_skipped', 'account', accountId),
    [track]
  )

  const trackAgentCopy = useCallback(
    (responseId: string) => track('agent_copy', 'agent_response', responseId),
    [track]
  )

  const trackMailtoClick = useCallback(
    (accountId: string) => track('mailto_click', 'account', accountId),
    [track]
  )

  return {
    track,
    trackCardExpanded,
    trackCardDrafted,
    trackCardSkipped,
    trackAgentCopy,
    trackMailtoClick,
  }
}
