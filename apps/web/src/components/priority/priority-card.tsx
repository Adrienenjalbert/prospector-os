'use client'

import Link from 'next/link'
import { Check, ThumbsDown, ThumbsUp } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface PriorityCardProps {
  rank: number
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
  onSnooze: () => void
  onComplete: () => void
  onFeedback: (type: 'positive' | 'negative') => void
}

const severityStyles = {
  critical: {
    emoji: '🔴',
    border: 'border-l-red-500',
  },
  high: {
    emoji: '🟠',
    border: 'border-l-amber-500',
  },
  medium: {
    emoji: '🟢',
    border: 'border-l-green-500',
  },
  low: {
    emoji: '🔵',
    border: 'border-l-blue-500',
  },
} as const

function formatGbp(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function PriorityCard({
  rank,
  accountName,
  accountId,
  dealValue,
  expectedRevenue,
  triggerType,
  triggerDetail,
  nextAction,
  contactName,
  contactPhone,
  severity,
  onDraftOutreach,
  onSnooze,
  onComplete,
  onFeedback,
}: PriorityCardProps) {
  const s = severityStyles[severity]

  return (
    <article
      data-rank={rank}
      data-trigger-type={triggerType}
      aria-label={`Priority ${rank}: ${accountName}`}
      className={cn(
        'rounded-r-lg border border-zinc-700/80 border-l-4 bg-zinc-800 text-zinc-100 shadow-sm',
        s.border,
      )}
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 gap-y-1">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="shrink-0 text-base leading-none" aria-hidden>
              {s.emoji}
            </span>
            <h3 className="truncate text-base font-bold tracking-tight">
              {accountName}
            </h3>
          </div>
          <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm text-zinc-300">
            <span>
              Deal{' '}
              <span className="font-medium text-zinc-100">
                {dealValue != null ? formatGbp(dealValue) : '—'}
              </span>
            </span>
            <span className="hidden sm:inline" aria-hidden>
              ·
            </span>
            <span>
              Expected{' '}
              <span className="font-medium text-zinc-100">
                {formatGbp(expectedRevenue)}
              </span>
            </span>
          </div>
        </div>

        <p className="line-clamp-1 text-sm text-zinc-300">{triggerDetail}</p>

        <div className="text-sm">
          <span className="text-zinc-400" aria-hidden>
            ►{' '}
          </span>
          <span className="text-zinc-100">{nextAction}</span>
          {contactName ? (
            <span className="text-zinc-400">
              {' '}
              · <span className="text-zinc-300">{contactName}</span>
            </span>
          ) : null}
          {contactPhone ? (
            <span className="ml-2 text-zinc-500 tabular-nums">{contactPhone}</span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-700/60 pt-3">
          <Link
            href={`/accounts/${encodeURIComponent(accountId)}`}
            className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-600 bg-zinc-800 px-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
          >
            View
          </Link>
          <button
            type="button"
            onClick={onDraftOutreach}
            className="inline-flex h-9 items-center justify-center rounded-md bg-emerald-600 px-3 text-sm font-medium text-white transition-colors hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            Draft Outreach
          </button>
          <button
            type="button"
            onClick={onSnooze}
            className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-600 bg-zinc-800 px-3 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
          >
            Snooze
          </button>
          <button
            type="button"
            onClick={onComplete}
            aria-label="Mark as done"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-600 bg-zinc-800 text-zinc-200 transition-colors hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
          >
            <Check className="size-4" aria-hidden />
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => onFeedback('positive')}
              aria-label="Thumbs up — helpful"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
            >
              <ThumbsUp className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onFeedback('negative')}
              aria-label="Thumbs down — not helpful"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
            >
              <ThumbsDown className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}
