'use client'

import { useState } from 'react'
import { PriorityCard, type PriorityCardProps } from './priority-card'
import { recordFeedback, markCompleted } from '@/app/actions/feedback'
import { useImplicitFeedback } from '@/lib/hooks/use-implicit-feedback'

type PriorityItem = Omit<PriorityCardProps, 'onDraftOutreach' | 'onComplete' | 'onFeedback' | 'showOutcomeCapture' | 'onWhyExpanded'>

interface InboxListProps {
  items: PriorityItem[]
  completedTodayCount?: number
}

const OUTCOME_CAPTURE_THRESHOLD = 3

export function InboxList({ items, completedTodayCount = 0 }: InboxListProps) {
  const [localCompleted, setLocalCompleted] = useState(0)
  const { trackCardExpanded, trackCardDrafted } = useImplicitFeedback()

  const totalCompleted = completedTodayCount + localCompleted
  const showOutcome = totalCompleted >= OUTCOME_CAPTURE_THRESHOLD

  function handleDraftOutreach(
    accountId: string,
    accountUrn: string,
    accountName: string,
    contactName: string | null,
  ) {
    trackCardDrafted(accountId)

    const prompt = contactName
      ? `Draft a follow-up email to ${contactName} at ${accountName}. Use the latest signals and my outreach tone.`
      : `Draft an intro email to the decision-maker at ${accountName}. Reference their ICP fit and any recent signals.`

    window.dispatchEvent(
      new CustomEvent('prospector:open-chat', {
        // Pass the company URN so the agent's context-pack loads the
        // company snapshot, transcript summaries, signal feed, and
        // key-contact notes for THIS account. Without it the agent
        // would have to re-derive the company from the prompt text and
        // the company-anchored slices would stay empty.
        detail: { prompt, activeUrn: accountUrn },
      }),
    )
  }

  function handleComplete(accountId: string) {
    setLocalCompleted((c) => c + 1)
    markCompleted(accountId).catch(() => {})
  }

  function handleFeedback(accountId: string, type: 'positive' | 'negative') {
    recordFeedback(accountId, type).catch(() => {})
  }

  function handleWhyExpanded(accountId: string) {
    trackCardExpanded(accountId)
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => (
        <PriorityCard
          key={item.accountId}
          {...item}
          showOutcomeCapture={showOutcome}
          onDraftOutreach={() =>
            handleDraftOutreach(
              item.accountId,
              item.accountUrn,
              item.accountName,
              item.contactName,
            )
          }
          onComplete={() => handleComplete(item.accountId)}
          onFeedback={(type) => handleFeedback(item.accountId, type)}
          onWhyExpanded={() => handleWhyExpanded(item.accountId)}
        />
      ))}
    </div>
  )
}
