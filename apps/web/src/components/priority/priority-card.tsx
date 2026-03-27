'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Phone } from 'lucide-react'
import { cn, formatGbp } from '@/lib/utils'

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
  onDraftOutreach: () => void
  onComplete: () => void
  onFeedback: (type: 'positive' | 'negative') => void
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
  onDraftOutreach,
  onComplete,
  onFeedback,
}: PriorityCardProps) {
  const sev = SEVERITY[severity]
  const [completed, setCompleted] = useState(false)
  const [feedbackGiven, setFeedbackGiven] = useState<'positive' | null>(null)

  function handleComplete() {
    setCompleted(true)
    onComplete()
  }

  function handleFeedback() {
    setFeedbackGiven('positive')
    onFeedback('positive')
  }

  if (completed) {
    return (
      <div className="rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-4 text-center">
        <p className="text-sm text-zinc-500">
          <span className="mr-1.5">✓</span>
          {accountName} marked done.{' '}
          <button
            onClick={() => setCompleted(false)}
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
          <div className="flex shrink-0 items-center gap-3 text-sm text-zinc-400">
            {dealValue != null && (
              <span className="hidden sm:inline">{formatGbp(dealValue)}</span>
            )}
            <span className="font-medium text-zinc-200">
              {formatGbp(expectedRevenue)}
            </span>
          </div>
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

        <div className="mt-4 flex items-center justify-between border-t border-zinc-800/60 pt-3">
          <button
            onClick={onDraftOutreach}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700"
          >
            {contactName ? `Draft email to ${contactName}` : 'Draft outreach'}
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={handleFeedback}
              disabled={feedbackGiven === 'positive'}
              className={cn(
                'rounded-md p-2 text-sm transition-colors',
                feedbackGiven === 'positive'
                  ? 'text-emerald-400'
                  : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
              )}
              aria-label="Helpful"
            >
              {feedbackGiven === 'positive' ? '👍' : '👍'}
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
