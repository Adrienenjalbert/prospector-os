'use client'

import { PriorityCard, type PriorityCardProps } from './priority-card'
import { recordFeedback, markCompleted } from '@/app/actions/feedback'

type PriorityItem = Omit<PriorityCardProps, 'onDraftOutreach' | 'onComplete' | 'onFeedback'>

export function InboxList({ items }: { items: PriorityItem[] }) {
  function handleDraftOutreach(accountName: string, contactName: string | null) {
    const prompt = contactName
      ? `Draft a follow-up email to ${contactName} at ${accountName}. Use the latest signals and my outreach tone.`
      : `Draft an intro email to the decision-maker at ${accountName}. Reference their ICP fit and any recent signals.`

    window.dispatchEvent(
      new CustomEvent('prospector:open-chat', { detail: { prompt } })
    )
  }

  function handleComplete(accountId: string) {
    markCompleted(accountId).catch(() => {})
  }

  function handleFeedback(accountId: string, type: 'positive' | 'negative') {
    recordFeedback(accountId, type).catch(() => {})
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => (
        <PriorityCard
          key={item.accountId}
          {...item}
          onDraftOutreach={() =>
            handleDraftOutreach(item.accountName, item.contactName)
          }
          onComplete={() => handleComplete(item.accountId)}
          onFeedback={(type) => handleFeedback(item.accountId, type)}
        />
      ))}
    </div>
  )
}
