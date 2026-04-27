'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase/client'

/**
 * Admin actions on a wiki page detail. Mirrors the action pattern in
 * apps/web/src/app/(dashboard)/admin/memory/memory-list-client.tsx.
 *
 * Three actions:
 *   - Pin     → status='pinned', exempt from auto-archive in lintWiki
 *   - Archive → status='archived', slices stop loading
 *   - Recompile → forces re-run of compileWikiPages for this page on
 *                  next workflow drain (clears source_atoms_hash so
 *                  the idempotency check skips this row)
 */
export function WikiPageActions({
  pageId,
  status,
}: {
  pageId: string
  status: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  async function callAction(action: 'pin' | 'archive' | 'recompile') {
    const supabase = createSupabaseBrowser()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      window.alert('Session expired — please reload.')
      return
    }
    const res = await fetch(`/api/admin/wiki/${pageId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action }),
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
    <div className="flex gap-2 text-xs">
      <button
        type="button"
        disabled={pending || status === 'pinned'}
        onClick={() => callAction('pin')}
        className="rounded-md border border-emerald-700 bg-emerald-950/40 px-2 py-1 text-emerald-300 hover:bg-emerald-950/60 disabled:opacity-50"
      >
        {status === 'pinned' ? 'Pinned' : 'Pin'}
      </button>
      <button
        type="button"
        disabled={pending || status === 'archived'}
        onClick={() => callAction('archive')}
        className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
      >
        {status === 'archived' ? 'Archived' : 'Archive'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => callAction('recompile')}
        className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
      >
        Recompile
      </button>
    </div>
  )
}
