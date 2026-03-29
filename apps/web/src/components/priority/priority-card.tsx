'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { Phone } from 'lucide-react'
import { cn, formatGbp } from '@/lib/utils'
import { OutcomeCapture } from './outcome-capture'

export interface PriorityCardProps {
  accountName: string
  accountId: string
  dealValue: number | null
  expectedRevenue: number
  triggerType: 'stall' | 'signal' | 'prospect' | 'pipeline'
  triggerDetail: string
  nextAction: string
  contactName: string | null
  contactPhone: string | null
  severity: 'critical' | 'high' | 'medium' | 'low'
  priorityTier: string | null
  propensity: number | null
  icpTier: string | null
  priorityReason: string | null
  showOutcomeCapture?: boolean
  onDraftOutreach: () => void
  onComplete: () => void
  onFeedback: (type: 'positive' | 'negative') => void
  onWhyExpanded?: () => void
}

const SEVERITY = {
  critical: { border: 'border-l-red-500', emoji: '🔴' },
  high: { border: 'border-l-amber-500', emoji: '🟡' },
  medium: { border: 'border-l-emerald-500', emoji: '🟢' },
  low: { border: 'border-l-blue-500', emoji: '🔵' },
} as const

export function PriorityCard({
  accountName,
  accountId,
  dealValue,
  expectedRevenue,
  triggerDetail,
  nextAction,
  contactName,
  contactPhone,
  severity,
  priorityTier,
  propensity,
  icpTier,
  priorityReason,
  showOutcomeCapture,
  onDraftOutreach,
  onComplete,
  onFeedback,
  onWhyExpanded,
}: PriorityCardProps) {
  const sev = SEVERITY[severity]
  const [completed, setCompleted] = useState(false)
  const [outcomeDismissed, setOutcomeDismissed] = useState(false)
  const [feedbackGiven, setFeedbackGiven] = useState<'positive' | 'negative' | null>(null)
  const [showWhy, setShowWhy] = useState(false)

  const handleOutcomeDismiss = useCallback(() => setOutcomeDismissed(true), [])

  function handleComplete() {
    setCompleted(true)
    onComplete()
  }

  function handlePositiveFeedback() {
    setFeedbackGiven('positive')
    onFeedback('positive')
  }

  function handleNegativeFeedback() {
    setFeedbackGiven('negative')
    onFeedback('negative')
  }

  if (completed) {
    if (showOutcomeCapture && !outcomeDismissed) {
      return (
        <OutcomeCapture
          accountId={accountId}
          accountName={accountName}
          onDismiss={handleOutcomeDismiss}
        />
      )
    }

    return (
      <div className="rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-4 text-center">
        <p className="text-sm text-zinc-500">
          <span className="mr-1.5">&#10003;</span>
          {accountName} marked done.{' '}
          <button
            onClick={() => { setCompleted(false); setOutcomeDismissed(false) }}
            className="text-zinc-400 underline hover:text-zinc-200"
          >
            Undo
          </button>
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-zinc-800 bg-zinc-900 border-l-4',
        sev.border
      )}
    >
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base">{sev.emoji}</span>
            <Link
              href={`/accounts/${accountId}`}
              className="truncate text-base font-semibold text-zinc-100 hover:text-white hover:underline"
            >
              {accountName}
            </Link>
          </div>
          <span className="shrink-0 text-sm font-medium text-zinc-200">
            {formatGbp(expectedRevenue)}
          </span>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          {triggerDetail}
        </p>

        <div className="mt-3 flex items-start gap-2">
          <span className="mt-0.5 text-emerald-400">▸</span>
          <p className="text-sm font-medium text-zinc-200">
            {nextAction}
            {contactPhone && (
              <a
                href={`tel:${contactPhone}`}
                className="ml-2 inline-flex items-center gap-1 rounded-md bg-emerald-950/40 px-2 py-0.5 text-xs font-medium text-emerald-400 hover:bg-emerald-950/60 hover:text-emerald-300"
              >
                <Phone className="size-3" />
                {contactPhone}
              </a>
            )}
          </p>
        </div>

        {(priorityTier || propensity != null) && (
          <div className="mt-3">
            <button
              onClick={() => {
                const wasHidden = !showWhy
                setShowWhy((v) => !v)
                if (wasHidden) onWhyExpanded?.()
              }}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {showWhy ? '▾ Hide scoring' : '▸ Why this?'}
            </button>
            {showWhy && (
              <div className="mt-2 rounded-md border border-zinc-800/60 bg-zinc-950/50 px-3 py-2.5 text-xs text-zinc-400 space-y-1.5">
                <div className="flex items-center gap-3">
                  {priorityTier && (
                    <span className={cn(
                      'rounded px-1.5 py-0.5 font-semibold',
                      priorityTier === 'HOT' ? 'bg-red-950/60 text-red-300' :
                      priorityTier === 'WARM' ? 'bg-amber-950/60 text-amber-300' :
                      'bg-zinc-800 text-zinc-300'
                    )}>
                      {priorityTier}
                    </span>
                  )}
                  {propensity != null && (
                    <span className="font-mono tabular-nums text-zinc-300">
                      {Math.round(propensity)}% win likelihood
                    </span>
                  )}
                  {icpTier && (
                    <span className="text-zinc-500">ICP {icpTier}</span>
                  )}
                </div>
                {priorityReason && (
                  <p className="text-zinc-400 leading-relaxed">{priorityReason}</p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-zinc-800/60 pt-3">
          <button
            onClick={onDraftOutreach}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700"
          >
            {contactName ? `Draft email to ${contactName}` : 'Draft outreach'}
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={handlePositiveFeedback}
              disabled={feedbackGiven !== null}
              className={cn(
                'rounded-md p-2 text-sm transition-colors',
                feedbackGiven === 'positive'
                  ? 'text-emerald-400'
                  : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300',
                feedbackGiven !== null && feedbackGiven !== 'positive' && 'opacity-30',
              )}
              aria-label="Helpful"
            >
              👍
            </button>
            <button
              onClick={handleNegativeFeedback}
              disabled={feedbackGiven !== null}
              className={cn(
                'rounded-md p-2 text-sm transition-colors',
                feedbackGiven === 'negative'
                  ? 'text-red-400'
                  : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300',
                feedbackGiven !== null && feedbackGiven !== 'negative' && 'opacity-30',
              )}
              aria-label="Not helpful"
            >
              👎
            </button>
            <button
              onClick={handleComplete}
              className="rounded-md px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 active:bg-zinc-700"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
