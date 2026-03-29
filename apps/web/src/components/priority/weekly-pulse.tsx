'use client'

import { useState } from 'react'
import { submitWeeklyPulse } from '@/app/actions/implicit-feedback'

const OUTCOME_OPTIONS = [
  { id: 'progressed', label: 'Progressed' },
  { id: 'no_change', label: 'No change' },
  { id: 'lost', label: 'Lost' },
] as const

const ACCURACY_OPTIONS = [
  { id: 'spot_on', label: 'Spot on' },
  { id: 'mostly', label: 'Mostly' },
  { id: 'needs_work', label: 'Needs work' },
] as const

interface WeeklyPulseProps {
  topAccountName: string
  topAccountId: string
}

export function WeeklyPulse({ topAccountName, topAccountId }: WeeklyPulseProps) {
  const [dismissed, setDismissed] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [accuracy, setAccuracy] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  if (dismissed || submitted) return null

  function handleSubmit() {
    if (!outcome || !accuracy) return
    setSubmitted(true)
    submitWeeklyPulse(topAccountId, outcome, accuracy).catch(() => {})
  }

  const canSubmit = outcome !== null && accuracy !== null

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-zinc-200">
          Quick pulse
          <span className="ml-2 text-xs font-normal text-zinc-500">
            helps us improve your priorities
          </span>
        </p>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Dismiss
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <p className="text-sm text-zinc-400">
            Last week&apos;s top pick was <span className="font-medium text-zinc-200">{topAccountName}</span>.
            How did that go?
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {OUTCOME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setOutcome(opt.id)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  outcome === opt.id
                    ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm text-zinc-400">
            Are your priorities accurate lately?
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ACCURACY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setAccuracy(opt.id)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  accuracy === opt.id
                    ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {canSubmit && (
          <button
            onClick={handleSubmit}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-200"
          >
            Submit
          </button>
        )}
      </div>
    </div>
  )
}
