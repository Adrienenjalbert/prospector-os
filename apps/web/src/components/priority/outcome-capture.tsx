'use client'

import { useEffect, useState } from 'react'
import { recordOutcomeAction } from '@/app/actions/implicit-feedback'

const OUTCOME_OPTIONS = [
  { id: 'called', label: 'Called' },
  { id: 'emailed', label: 'Emailed' },
  { id: 'met', label: 'Met' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'other', label: 'Other' },
] as const

interface OutcomeCaptureProps {
  accountId: string
  accountName: string
  onDismiss: () => void
}

export function OutcomeCapture({ accountId, accountName, onDismiss }: OutcomeCaptureProps) {
  const [countdown, setCountdown] = useState(5)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (submitted) return
    if (countdown <= 0) {
      onDismiss()
      return
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown, submitted, onDismiss])

  function handleOutcome(outcome: string) {
    setSubmitted(true)
    recordOutcomeAction(accountId, outcome).catch(() => {})
    setTimeout(onDismiss, 800)
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-4 text-center">
        <p className="text-sm text-zinc-500">Got it, thanks.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-4">
      <p className="text-sm text-zinc-500">
        <span className="mr-1.5">&#10003;</span>
        {accountName} marked done.
      </p>
      <p className="mt-2 text-xs font-medium text-zinc-400">
        Quick: what happened?
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {OUTCOME_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => handleOutcome(opt.id)}
            className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-right text-xs text-zinc-600 tabular-nums">
        auto-dismisses in {countdown}s
      </p>
    </div>
  )
}
