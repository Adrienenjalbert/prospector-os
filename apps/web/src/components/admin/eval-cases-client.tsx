'use client'

import { useEffect, useState, useTransition } from 'react'
import { createSupabaseBrowser } from '@/lib/supabase/client'

/**
 * Inline review controls for an eval case (A2.4).
 *
 * Calls the new POST /api/admin/eval-cases/[id] endpoint. Surfaces errors
 * inline so reviewers see WHY a case was rejected (already reviewed,
 * tenant mismatch, etc.).
 */
export function EvalCaseReviewActions({
  caseId,
  onReviewed,
}: {
  caseId: string
  onReviewed: () => void
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const submit = (action: 'accept' | 'reject') => {
    setError(null)
    start(async () => {
      try {
        const supabase = createSupabaseBrowser()
        const { data: session } = await supabase.auth.getSession()
        const token = session.session?.access_token
        if (!token) {
          setError('Not authenticated')
          return
        }
        const res = await fetch(`/api/admin/eval-cases/${caseId}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setError(body.error ?? `HTTP ${res.status}`)
          return
        }
        onReviewed()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Review failed')
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => submit('accept')}
        className="rounded border border-emerald-700/60 bg-emerald-900/30 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-800/40 disabled:opacity-50"
      >
        {pending ? '…' : 'Accept'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => submit('reject')}
        className="rounded border border-zinc-700/60 bg-zinc-950/40 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800/60 disabled:opacity-50"
      >
        Reject
      </button>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  )
}

interface EvalCaseRow {
  id: string
  origin: string | null
  category: string | null
  status: string
  question: string | null
  notes: string | null
  source_interaction_id: string | null
  created_at: string
}

/**
 * Client wrapper that loads `pending_review` and `accepted` cases for
 * the tenant and lets the reviewer accept/reject. Refreshes after every
 * action so counts stay live.
 */
export function EvalCasesClient({ tenantId }: { tenantId: string }) {
  const [pending, setPending] = useState<EvalCaseRow[]>([])
  const [accepted, setAccepted] = useState<EvalCaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createSupabaseBrowser()
      const [pendingRes, acceptedRes] = await Promise.all([
        supabase
          .from('eval_cases')
          .select('id, origin, category, status, question, notes, source_interaction_id, created_at')
          .eq('tenant_id', tenantId)
          .eq('status', 'pending_review')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('eval_cases')
          .select('id, origin, category, status, question, notes, source_interaction_id, created_at')
          .eq('tenant_id', tenantId)
          .eq('status', 'accepted')
          .order('created_at', { ascending: false })
          .limit(20),
      ])
      if (pendingRes.error) throw pendingRes.error
      if (acceptedRes.error) throw acceptedRes.error
      setPending((pendingRes.data ?? []) as EvalCaseRow[])
      setAccepted((acceptedRes.data ?? []) as EvalCaseRow[])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // We intentionally don't depend on `load` — it's a stable closure
    // over `tenantId` for this component lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  return (
    <div className="space-y-8">
      {/* X2 — eval suite growth at a glance. The rate at which
          accepted cases accumulate is the canonical measure of
          MISSION's "eval suite grows from real production failures"
          promise. Surface it prominently. */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Pending</div>
            <div className="mt-1 font-mono text-2xl tabular-nums text-zinc-100">{pending.length}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Accepted (last 20)</div>
            <div className="mt-1 font-mono text-2xl tabular-nums text-emerald-300">{accepted.length}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Suite growth this week</div>
            <div className="mt-1 font-mono text-2xl tabular-nums text-zinc-100">
              {accepted.filter((c) => Date.now() - new Date(c.created_at).getTime() < 7 * 86_400_000).length}
            </div>
          </div>
        </div>
      </section>

      <section>
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">
            Pending review ({pending.length})
          </h2>
          <button
            type="button"
            onClick={() => void load()}
            className="text-[11px] text-sky-300 hover:underline"
          >
            Refresh
          </button>
        </header>
        {error && (
          <p className="mt-2 rounded-md border border-red-800 bg-red-950/40 p-3 text-xs text-red-300">
            {error}
          </p>
        )}
        {loading ? (
          <p className="mt-2 text-xs text-zinc-500">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">
            No cases waiting for review. The eval-growth workflow runs nightly
            and promotes thumbs-down, zero-citation, and tool-error
            interactions into reviewable cases.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {pending.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5">
                        {c.origin}
                      </span>
                      <span>{c.category}</span>
                      <span>· {new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-100">
                      {c.question || '(no question recorded)'}
                    </p>
                    {c.notes && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-zinc-500">
                        {c.notes}
                      </p>
                    )}
                  </div>
                  <EvalCaseReviewActions caseId={c.id} onReviewed={load} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-200">
          Recently accepted ({accepted.length})
        </h2>
        {accepted.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">
            No accepted cases yet. Accepted cases enter the eval suite the
            next time CI runs <code>npm run evals</code>.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {accepted.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2 text-xs"
              >
                <span className="text-zinc-300">{c.question}</span>
                <span className="ml-2 text-zinc-500">
                  · {new Date(c.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
