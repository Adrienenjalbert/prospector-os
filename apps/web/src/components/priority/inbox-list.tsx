'use client'

import { PriorityCard, type PriorityCardProps } from './priority-card'

type PriorityItem = Omit<PriorityCardProps, 'onDraftOutreach' | 'onComplete' | 'onFeedback'>

export function InboxList({ items }: { items: PriorityItem[] }) {
  function handleDraftOutreach(accountName: string) {
    // TODO: Open chat sidebar with pre-filled prompt
    console.log(`Draft outreach for ${accountName}`)
  }

  function handleComplete(accountId: string) {
    console.log(`Completed ${accountId}`)
  }

  function handleFeedback(accountId: string, type: 'positive' | 'negative') {
    console.log(`Feedback ${type} for ${accountId}`)
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => (
        <PriorityCard
          key={item.accountId}
          {...item}
          onDraftOutreach={() => handleDraftOutreach(item.accountName)}
          onComplete={() => handleComplete(item.accountId)}
          onFeedback={(type) => handleFeedback(item.accountId, type)}
        />
      ))}
    </div>
  )
}
