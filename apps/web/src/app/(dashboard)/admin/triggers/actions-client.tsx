'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase/client'

/**
 * Per-row admin actions for the /admin/triggers page (Phase 7,
 * Section 6.1). Mirrors the wiki + memory action client patterns.
 *
 * Two actions:
 *   - Mark acted   → POST /api/admin/triggers/[id] { action: 'acted' }
 *   - Dismiss      → POST /api/admin/triggers/[id] { action: 'dismissed' }
 *
 * Both transitions are recorded in calibration_ledger (admin override
 * audit) and emit trigger_acted / trigger_dismissed telemetry.
 */
export function TriggerActionsClient({ triggerId }: { triggerId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  async function callAction(action: 'acted' | 'dismissed') {
    const supabase = createSupabaseBrowser()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      window.alert('Session expired — please reload.')
      return
    }
    const reason =
      action === 'dismissed'
        ? window.prompt('Dismissal reason (optional):') ?? null
        : null
    const res = await fetch(`/api/admin/triggers/${triggerId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, reason }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      window.alert(`Action failed: ${j.error ?? res.status}`)
      return
    }
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <div className="flex justify-end gap-1 text-[10px]">
      <button
        type="button"
        disabled={pending}
        onClick={() => callAction('acted')}
        className="rounded border border-emerald-700 bg-emerald-950/40 px-2 py-0.5 text-emerald-300 hover:bg-emerald-950/60 disabled:opacity-50"
      >
        Acted
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => callAction('dismissed')}
        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
      >
        Dismiss
      </button>
    </div>
  )
}
