'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  MEMORY_KIND_LABELS,
  MEMORY_KINDS,
  MEMORY_STATUSES,
  type MemoryKind,
  type MemoryStatus,
} from '@prospector/core'

export interface AdminMemoryRow {
  id: string
  kind: MemoryKind
  scope: Record<string, string>
  title: string
  body: string
  evidence: { urns?: string[]; counts?: Record<string, number>; samples?: string[] }
  confidence: number
  status: MemoryStatus
  source_workflow: string
  derived_at: string
  approved_at: string | null
  approved_by: string | null
}

type ActionType = 'approve' | 'pin' | 'archive' | 'reset'

const STATUS_STYLES: Record<MemoryStatus, string> = {
  proposed: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  pinned: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  archived: 'border-zinc-700 bg-zinc-900 text-zinc-500',
  superseded: 'border-zinc-700 bg-zinc-900 text-zinc-500',
}

export function MemoryListClient({
  initialMemories,
}: {
  initialMemories: AdminMemoryRow[]
}) {
  const [memories, setMemories] = useState<AdminMemoryRow[]>(initialMemories)
  const [kindFilter, setKindFilter] = useState<MemoryKind | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<MemoryStatus | 'all'>('proposed')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const visible = useMemo(() => {
    return memories.filter((m) => {
      if (kindFilter !== 'all' && m.kind !== kindFilter) return false
      if (statusFilter !== 'all' && m.status !== statusFilter) return false
      return true
    })
  }, [memories, kindFilter, statusFilter])

  const handleAction = useCallback(
    async (memoryId: string, action: ActionType) => {
      setBusyId(memoryId)
      setError(null)
      try {
        const { createSupabaseBrowser } = await import('@/lib/supabase/client')
        const supabase = createSupabaseBrowser()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          setError('Not signed in')
          return
        }

        const res = await fetch(`/api/admin/memory/${memoryId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ action }),
        })

        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          setError(j.error ?? `Action failed (${res.status})`)
          return
        }
        const updated = (await res.json()) as { memory: AdminMemoryRow }
        setMemories((prev) =>
          prev.map((m) => (m.id === memoryId ? { ...m, ...updated.memory } : m)),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed')
      } finally {
        setBusyId(null)
      }
    },
    [],
  )

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="uppercase tracking-wide">Filter</span>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as MemoryKind | 'all')}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
          >
            <option value="all">All kinds</option>
            {MEMORY_KINDS.map((k) => (
              <option key={k} value={k}>
                {MEMORY_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as MemoryStatus | 'all')}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
          >
            <option value="all">All statuses</option>
            {MEMORY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-zinc-600">{visible.length} shown</span>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-500">
          No memories match these filters yet. Mining workflows run nightly via{' '}
          <span className="font-mono text-xs text-zinc-400">/api/cron/learning</span>; first results land within 24 hours of CRM connection.
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {visible.map((m) => (
            <li
              key={m.id}
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-medium text-zinc-300">
                  {MEMORY_KIND_LABELS[m.kind]}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 font-medium capitalize ${STATUS_STYLES[m.status]}`}
                >
                  {m.status}
                </span>
                {Object.entries(m.scope ?? {}).map(([k, v]) => (
                  <span
                    key={k}
                    className="rounded-md bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                  >
                    {k}: {v}
                  </span>
                ))}
                <span className="ml-auto text-[10px] text-zinc-600">
                  Confidence{' '}
                  <span
                    className={
                      m.confidence < 0.4
                        ? 'text-red-300'
                        : m.confidence >= 0.85
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                    }
                  >
                    {(m.confidence * 100).toFixed(0)}%
                  </span>
                </span>
              </div>

              <h3 className="mt-2 text-sm font-semibold text-zinc-100">{m.title}</h3>
              <p className="mt-1 whitespace-pre-line text-sm text-zinc-300">{m.body}</p>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span>
                  Derived{' '}
                  {new Date(m.derived_at).toLocaleString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  by <span className="font-mono text-zinc-400">{m.source_workflow}</span>
                </span>
                {(m.evidence.urns ?? []).length > 0 && (
                  <span>
                    · {m.evidence.urns!.length} evidence URN{m.evidence.urns!.length === 1 ? '' : 's'}
                  </span>
                )}
                {Object.entries(m.evidence.counts ?? {}).map(([k, v]) => (
                  <span key={k} className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    {k}: {v}
                  </span>
                ))}
              </div>

              {(m.evidence.samples ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(m.evidence.samples ?? []).slice(0, 6).map((s, i) => (
                    <span
                      key={`${m.id}:${i}`}
                      className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-400"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {m.status === 'proposed' && (
                  <>
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      onClick={() => void handleAction(m.id, 'archive')}
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      Archive
                    </button>
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      onClick={() => void handleAction(m.id, 'approve')}
                      className="rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                    >
                      {busyId === m.id ? 'Saving…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      onClick={() => void handleAction(m.id, 'pin')}
                      className="rounded-md bg-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/30 disabled:opacity-50"
                    >
                      Approve + Pin
                    </button>
                  </>
                )}
                {m.status === 'approved' && (
                  <>
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      onClick={() => void handleAction(m.id, 'archive')}
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      Archive
                    </button>
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      onClick={() => void handleAction(m.id, 'pin')}
                      className="rounded-md bg-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/30 disabled:opacity-50"
                    >
                      Pin
                    </button>
                  </>
                )}
                {m.status === 'pinned' && (
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => void handleAction(m.id, 'approve')}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Unpin (keep approved)
                  </button>
                )}
                {(m.status === 'archived' || m.status === 'superseded') && (
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => void handleAction(m.id, 'reset')}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Re-propose
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
