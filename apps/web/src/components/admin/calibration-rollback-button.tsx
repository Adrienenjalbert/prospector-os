'use client'

import { useState, useTransition } from 'react'
import { createSupabaseBrowser } from '@/lib/supabase/client'

/**
 * Rollback button for the calibration ledger.
 *
 * Calls POST /api/admin/calibration/[id]/rollback (A2.1) which:
 *   - Verifies admin role + tenant ownership.
 *   - Re-applies `before_value` to the original target_path.
 *   - Inserts a new ledger row with change_type='rollback'.
 *
 * UX rules followed:
 *   - One clear primary action, no menu (signal-over-noise principle).
 *   - Disabled while pending so we don't double-fire.
 *   - Surfaces the API error inline rather than swallowing it — operators
 *     need to see why a rollback was rejected (age limit, undo-of-undo,
 *     unsupported target_path).
 *   - Reloads the page on success so the new ledger row appears at the
 *     top of the list. A more sophisticated in-place update is overkill
 *     for an admin surface that's used a few times per quarter.
 */
export function CalibrationRollbackButton({
  ledgerId,
  changeType,
}: {
  ledgerId: string
  changeType: string
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // No undo of an undo — the API rejects this anyway, but hiding the
  // button up front avoids a confusing click for the operator.
  if (changeType === 'rollback') {
    return <span className="text-[11px] text-zinc-600">—</span>
  }

  const onClick = () => {
    setError(null)
    if (
      !window.confirm(
        'Roll back this adaptation? The original before-value is restored to the tenant config.',
      )
    ) {
      return
    }

    start(async () => {
      try {
        const supabase = createSupabaseBrowser()
        const { data: session } = await supabase.auth.getSession()
        const token = session.session?.access_token
        if (!token) {
          setError('Not authenticated')
          return
        }

        const res = await fetch(`/api/admin/calibration/${ledgerId}/rollback`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setError(body.error ?? `HTTP ${res.status}`)
          return
        }

        window.location.reload()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Rollback failed')
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded border border-zinc-700/60 bg-zinc-950/40 px-2 py-1 text-[11px] text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/60 disabled:opacity-50"
      >
        {pending ? 'Rolling back…' : 'Roll back'}
      </button>
      {error && <span className="max-w-[200px] text-right text-[10px] text-red-400">{error}</span>}
    </div>
  )
}
