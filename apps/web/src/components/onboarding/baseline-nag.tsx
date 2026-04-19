'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Clock4, X } from 'lucide-react'
import { snoozeBaselineNag } from '@/app/actions/onboarding-instrumentation'

/**
 * Phase 3 T2.4 — baseline-survey nag card.
 *
 * Renders on the inbox when the current user has NOT yet submitted
 * the 60-second baseline survey AND has not snoozed the nag inside
 * the snooze window. Without the baseline, the time-saved math on
 * /admin/roi has no anchor — the nag is the gentle pressure to fix
 * that.
 *
 * Visibility decision is made server-side in /inbox so this
 * component renders only when it should (no client-side flicker).
 *
 * Two CTAs:
 *   - "Start" → navigates to /onboarding/baseline.
 *   - "Snooze 7 days" → calls snoozeBaselineNag, optimistically hides
 *     the card. The snooze persists on user_profiles.metadata so the
 *     nag stays gone across reloads / devices.
 *
 * Per the proposal's "no dead-end answers" UX rule the card always
 * has a primary action and an escape hatch; never a third option,
 * never a "do you want to dismiss?" modal — it's a low-friction
 * pattern to match the system's signal-over-noise stance.
 */

export function BaselineNag() {
  const [hidden, setHidden] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (hidden) return null

  function handleSnooze() {
    setError(null)
    startTransition(async () => {
      try {
        await snoozeBaselineNag()
        setHidden(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not snooze')
      }
    })
  }

  return (
    <div className="rounded-lg border border-violet-700/40 bg-violet-950/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-violet-100">
            Unlock ROI tracking with a 60-second baseline
          </h3>
          <p className="mt-1 text-xs text-violet-200/80">
            Tell us how long you spend today on call briefs, outreach, and
            QBR prep. We use it as the comparison point for every
            time-saved figure on the leadership dashboard.
          </p>
          {error && (
            <p
              role="alert"
              aria-live="polite"
              className="mt-2 text-xs text-rose-300"
            >
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleSnooze}
          disabled={pending}
          className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-violet-300/70 transition hover:bg-violet-900/40 hover:text-violet-100 disabled:opacity-40"
          aria-label="Dismiss for 7 days"
          title="Dismiss for 7 days"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href="/onboarding/baseline"
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500"
        >
          Start the survey
        </Link>
        <button
          type="button"
          onClick={handleSnooze}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-violet-800/60 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-900/30 disabled:opacity-50"
        >
          <Clock4 className="size-3.5" />
          {pending ? 'Snoozing…' : 'Snooze 7 days'}
        </button>
      </div>
    </div>
  )
}
