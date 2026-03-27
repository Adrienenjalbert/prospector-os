'use client'

import Link from 'next/link'
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

const SEVERITY = {
  critical: { border: 'border-l-red-500', emoji: '🔴', label: 'STALL' },
  high: { border: 'border-l-amber-500', emoji: '🟡', label: 'SIGNAL' },
  medium: { border: 'border-l-emerald-500', emoji: '🟢', label: 'PROSPECT' },
  low: { border: 'border-l-blue-500', emoji: '🔵', label: 'PIPELINE' },
} as const

function formatGbp(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value)
}

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

  return (
    <div
      className={cn(
        'rounded-lg border border-zinc-800 bg-zinc-900 border-l-4',
        sev.border
      )}
    >
      <div className="p-4 sm:p-5">
        {/* Row 1: Account + values */}
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
              <span>{formatGbp(dealValue)}</span>
            )}
            <span className="font-medium text-zinc-200">
              {formatGbp(expectedRevenue)}
            </span>
          </div>
        </div>

        {/* Row 2: Why this account — full context, not truncated */}
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          {triggerDetail}
        </p>

        {/* Row 3: What to do */}
        <div className="mt-3 flex items-start gap-2">
          <span className="mt-0.5 text-emerald-400">▸</span>
          <p className="text-sm font-medium text-zinc-200">
            {nextAction}
            {contactPhone && (
              <a
                href={`tel:${contactPhone}`}
                className="ml-2 text-zinc-500 hover:text-zinc-300"
              >
                {contactPhone}
              </a>
            )}
          </p>
        </div>

        {/* Actions: just the primary action + dismiss */}
        <div className="mt-4 flex items-center justify-between border-t border-zinc-800/60 pt-3">
          <button
            onClick={onDraftOutreach}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            {contactName ? `Draft email to ${contactName}` : 'Draft outreach'}
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onFeedback('positive')}
              className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              aria-label="Helpful"
            >
              👍
            </button>
            <button
              onClick={onComplete}
              className="rounded-md px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
