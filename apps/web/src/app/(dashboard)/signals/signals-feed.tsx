'use client'

import { SignalCard } from '@/components/signals/signal-card'

interface SignalRow {
  id: string
  companyId: string
  companyName: string
  signalType: string
  title: string
  description: string | null
  urgency: string
  relevanceScore: number
  weightedScore: number
  recommendedAction: string | null
  detectedAt: string
  source: string
}

interface SignalsFeedProps {
  signals: SignalRow[]
}

export function SignalsFeed({ signals }: SignalsFeedProps) {
  function handleDraftOutreach(companyName: string, signalTitle: string) {
    const prompt = `Draft an outreach email referencing this signal at ${companyName}: "${signalTitle}". Use the latest account context and my outreach tone.`
    window.dispatchEvent(
      new CustomEvent('prospector:open-chat', { detail: { prompt } })
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {signals.map((signal) => (
        <SignalCard
          key={signal.id}
          id={signal.id}
          companyId={signal.companyId}
          companyName={signal.companyName}
          signalType={signal.signalType}
          title={signal.title}
          description={signal.description}
          urgency={signal.urgency}
          relevanceScore={signal.relevanceScore}
          recommendedAction={signal.recommendedAction}
          detectedAt={signal.detectedAt}
          source={signal.source}
          onDraftOutreach={() => handleDraftOutreach(signal.companyName, signal.title)}
        />
      ))}
    </div>
  )
}
