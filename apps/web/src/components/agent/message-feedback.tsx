'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { recordAgentFeedback } from '@/app/actions/implicit-feedback'

const NEGATIVE_REASONS = [
  { id: 'wrong_info', label: 'Wrong account info' },
  { id: 'wrong_tone', label: 'Tone didn\'t match' },
  { id: 'not_actionable', label: 'Not actionable' },
  { id: 'already_did', label: 'Already did this' },
] as const

interface MessageFeedbackProps {
  interactionId: string | null
  isStreaming: boolean
}

export function MessageFeedback({ interactionId, isStreaming }: MessageFeedbackProps) {
  const [visible, setVisible] = useState(false)
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null)
  const [showReasons, setShowReasons] = useState(false)

  useEffect(() => {
    if (isStreaming || !interactionId) {
      setVisible(false)
      return
    }

    const timer = setTimeout(() => setVisible(true), 2000)
    return () => clearTimeout(timer)
  }, [isStreaming, interactionId])

  if (!visible || !interactionId) return null

  function handleFeedback(type: 'positive' | 'negative') {
    setFeedback(type)
    if (type === 'negative') {
      setShowReasons(true)
    } else {
      recordAgentFeedback(interactionId!, type).catch(() => {})
    }
  }

  function handleReason(reason: string) {
    setShowReasons(false)
    recordAgentFeedback(interactionId!, 'negative', reason).catch(() => {})
  }

  if (feedback === 'positive') {
    return (
      <div className="ml-11 mt-1">
        <span className="text-xs text-zinc-600">Thanks for the feedback</span>
      </div>
    )
  }

  return (
    <div className="ml-11 mt-1 flex flex-col gap-1.5">
      {!feedback && (
        // Thumbs targets: WCAG 2.5.8 (new in 2.2) requires interactive
        // targets ≥ 24×24 CSS px. Old version was rounded-p-1 (~22px);
        // bumped to inline-flex with size-6 (24×24) wrapping the icons.
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleFeedback('positive')}
            className="inline-flex size-6 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
            aria-label="Helpful"
          >
            <ThumbsUpIcon />
          </button>
          <button
            type="button"
            onClick={() => handleFeedback('negative')}
            className="inline-flex size-6 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
            aria-label="Not helpful"
          >
            <ThumbsDownIcon />
          </button>
        </div>
      )}

      {showReasons && (
        <div className="flex flex-wrap gap-1.5">
          {NEGATIVE_REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => handleReason(r.id)}
              className={cn(
                'rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400',
                'transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200'
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ThumbsUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  )
}

function ThumbsDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z" />
    </svg>
  )
}
