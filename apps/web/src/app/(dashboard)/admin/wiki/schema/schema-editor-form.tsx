'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase/client'

/**
 * Schema editor form. Single textarea + save button. POST to
 * /api/admin/wiki/schema with the new body. On success, version
 * increments and updated_at refreshes.
 */
export function SchemaEditorForm({
  initialBody,
  initialVersion,
}: {
  initialBody: string
  initialVersion: number
}) {
  const router = useRouter()
  const [body, setBody] = useState(initialBody)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const isDirty = body !== initialBody

  async function save() {
    setError(null)
    const supabase = createSupabaseBrowser()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      setError('Session expired — please reload.')
      return
    }
    const res = await fetch('/api/admin/wiki/schema', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ body_md: body, expected_version: initialVersion }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error ?? `HTTP ${res.status}`)
      return
    }
    setSavedAt(new Date().toLocaleString())
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <div className="mt-4">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={28}
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-emerald-700 focus:outline-none"
        placeholder="# Wiki schema for this tenant&#10;&#10;Page kinds:&#10;- entity_industry: one per industry the tenant sells into&#10;- ..."
      />
      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-zinc-500">
          {error && <span className="text-amber-400">⚠ {error}</span>}
          {savedAt && !error && <span className="text-emerald-400">Saved at {savedAt}</span>}
        </div>
        <button
          type="button"
          disabled={pending || !isDirty || body.trim().length < 50}
          onClick={save}
          className="rounded-md border border-emerald-700 bg-emerald-950/40 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-950/60 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save schema'}
        </button>
      </div>
    </div>
  )
}
