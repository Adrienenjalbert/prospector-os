'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { createSupabaseBrowser } from '@/lib/supabase/client'

/**
 * Triggers an admin-only export of the tenant's wiki vault as a
 * .zip file. Forwards the user's session token in the Authorization
 * header so the API can RBAC-check.
 */
export function WikiExportButton() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function exportVault() {
    setPending(true)
    setError(null)
    try {
      const supabase = createSupabaseBrowser()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setError('Session expired — please reload.')
        return
      }
      const res = await fetch('/api/admin/wiki/export', {
        method: 'GET',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(`Export failed: ${j.error ?? res.status}`)
        return
      }
      // Save the blob as a download. The Content-Disposition filename
      // is what the browser will use; we don't override it client-side.
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const filenameMatch = cd.match(/filename="([^"]+)"/)
      const filename = filenameMatch?.[1] ?? `vault-${new Date().toISOString().slice(0, 10)}.zip`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={exportVault}
        className="flex items-center gap-1.5 rounded-md border border-emerald-700 bg-emerald-950/40 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-950/60 disabled:opacity-50"
      >
        <Download className="size-4" />
        {pending ? 'Exporting…' : 'Export to Obsidian'}
      </button>
      {error && <span className="text-[11px] text-amber-400">{error}</span>}
    </div>
  )
}
