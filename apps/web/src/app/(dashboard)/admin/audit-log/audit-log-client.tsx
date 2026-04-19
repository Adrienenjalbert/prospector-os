'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * Phase 3 T2.1 — admin audit log client component.
 *
 * Renders the rows fetched server-side and provides filter controls
 * (action dropdown, user UUID input) plus an expand-to-see-diff
 * affordance per row. The diff view shows raw JSON for now —
 * structural diffs (only-changed-keys) are a follow-up if the
 * operator's first-week feedback says they want it.
 */

interface AuditRow {
  id: string
  user_id: string | null
  action: string
  target: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  metadata: Record<string, unknown>
  occurred_at: string
}

interface AuditLogClientProps {
  rows: AuditRow[]
  seenActions: string[]
  currentActionFilter: string | null
  currentUserFilter: string | null
}

export function AuditLogClient({
  rows,
  seenActions,
  currentActionFilter,
  currentUserFilter,
}: AuditLogClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function setFilter(key: 'action' | 'user_id', value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value.length > 0) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    const qs = params.toString()
    router.push(qs ? `?${qs}` : '?', { scroll: false })
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">Action</span>
          <select
            value={currentActionFilter ?? ''}
            onChange={(e) =>
              setFilter('action', e.target.value === '' ? null : e.target.value)
            }
            className="min-w-[220px] rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
          >
            <option value="">All actions</option>
            {seenActions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">
            User UUID
          </span>
          <input
            type="text"
            defaultValue={currentUserFilter ?? ''}
            onBlur={(e) =>
              setFilter('user_id', e.target.value.trim() || null)
            }
            placeholder="paste a uuid…"
            className="min-w-[280px] rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-100 focus:border-zinc-500 focus:outline-none"
          />
        </label>
        {(currentActionFilter || currentUserFilter) && (
          <button
            type="button"
            onClick={() => router.push('?', { scroll: false })}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Empty state */}
      {rows.length === 0 && (
        <p className="mt-8 rounded-md border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-500">
          No audit rows match the current filters. The log is append-only
          since Phase 3 T2.1 shipped — actions before that point produced
          no rows.
        </p>
      )}

      {/* Rows */}
      <ul className="mt-6 flex flex-col gap-2">
        {rows.map((r) => {
          const open = expanded.has(r.id)
          return (
            <li
              key={r.id}
              className="rounded-lg border border-zinc-800 bg-zinc-950/50"
            >
              <button
                type="button"
                onClick={() => toggleExpand(r.id)}
                className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition hover:bg-zinc-900/40"
              >
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="font-mono text-sm text-zinc-100">
                    {r.action}
                  </span>
                  <span className="font-mono text-xs text-zinc-500">
                    {new Date(r.occurred_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex w-full items-center justify-between gap-3 text-xs text-zinc-500">
                  <span className="font-mono">{r.target}</span>
                  <span className="font-mono">
                    {r.user_id
                      ? `user=${r.user_id.slice(0, 8)}…`
                      : 'system'}
                  </span>
                </div>
              </button>
              {open && (
                <div className="border-t border-zinc-800 p-4 text-xs">
                  <DiffPanel before={r.before} after={r.after} />
                  {Object.keys(r.metadata).length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
                        metadata
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300">
                        {JSON.stringify(r.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function DiffPanel({
  before,
  after,
}: {
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Before
        </div>
        {before == null ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-950 p-2 italic text-zinc-600">
            (insert — no prior state)
          </p>
        ) : (
          <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300">
            {JSON.stringify(before, null, 2)}
          </pre>
        )}
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          After
        </div>
        {after == null ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-950 p-2 italic text-zinc-600">
            (rejection / delete — no resulting state)
          </p>
        ) : (
          <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300">
            {JSON.stringify(after, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}
