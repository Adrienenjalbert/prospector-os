'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, FileWarning, CheckCircle2 } from 'lucide-react'
import { createSupabaseBrowser } from '@/lib/supabase/client'

/**
 * Phase 3 T2.3 — admin-config "Data export" panel.
 *
 * Wraps POST /api/admin/export → poll GET /api/admin/export/[id]
 * until the workflow completes, then surfaces the download URL.
 *
 * UX shape:
 *
 *   - Default: a single "Export tenant data" button + a one-line
 *     description of what's included.
 *   - On click: POST → optimistic "Preparing your export…" state.
 *   - Polling: every 2s for up to 5 min. Updates the inline status
 *     line as the workflow progresses through steps.
 *   - On completion: download link + "URL expires" timestamp +
 *     a note about Slack delivery (when applicable).
 *   - On error: surface the workflow's error message + a retry
 *     button. Retry reuses the same request_id so the workflow's
 *     idempotency key kicks in (a partially-completed run resumes).
 *
 * The endpoint is gated on ADMIN_EXPORT_ENABLED. When the env is
 * off, POST returns 503 with a friendly hint; we surface that
 * verbatim so the operator can flip the flag.
 */

type Status =
  | 'idle'
  | 'requesting'
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'error'

interface ExportState {
  status: Status
  request_id?: string
  current_step?: string | null
  url?: string | null
  size_bytes?: number | null
  expires_at?: string | null
  error?: string | null
}

const POLL_INTERVAL_MS = 2_000
const POLL_TIMEOUT_MS = 5 * 60 * 1_000

export function ExportPanel() {
  const [state, setState] = useState<ExportState>({ status: 'idle' })
  const stoppedRef = useRef(false)

  useEffect(() => {
    return () => {
      stoppedRef.current = true
    }
  }, [])

  async function authToken(): Promise<string | null> {
    const supabase = createSupabaseBrowser()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  async function startExport() {
    const token = await authToken()
    if (!token) {
      setState({ status: 'error', error: 'Sign in expired. Reload and try again.' })
      return
    }

    setState({ status: 'requesting' })
    try {
      const res = await fetch('/api/admin/export', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      const body = (await res.json()) as {
        request_id?: string
        status?: string
        error?: string
        hint?: string
      }
      if (!res.ok) {
        setState({
          status: 'error',
          error: body.hint ?? body.error ?? `Server returned ${res.status}`,
        })
        return
      }
      if (!body.request_id) {
        setState({ status: 'error', error: 'No request_id returned from server.' })
        return
      }
      setState({
        status: (body.status as Status) ?? 'pending',
        request_id: body.request_id,
      })
      void pollUntilDone(body.request_id, token)
    } catch (err) {
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Request failed',
      })
    }
  }

  async function pollUntilDone(requestId: string, token: string) {
    const startedAt = Date.now()
    while (!stoppedRef.current) {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error:
            'Export is taking longer than 5 minutes. The cron drain will pick it up; check back later or contact RevOps.',
        }))
        return
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      try {
        const res = await fetch(`/api/admin/export/${requestId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          // 404 here means our enqueue raced with the polling
          // start; keep trying for a few more seconds.
          if (res.status === 404 && Date.now() - startedAt < 10_000) continue
          const body = (await res.json()) as { error?: string }
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: body.error ?? `Status check returned ${res.status}`,
          }))
          return
        }
        const body = (await res.json()) as {
          status: Status
          current_step?: string | null
          url?: string | null
          size_bytes?: number | null
          expires_at?: string | null
          error?: string | null
        }
        setState({
          status: body.status,
          request_id: requestId,
          current_step: body.current_step,
          url: body.url,
          size_bytes: body.size_bytes,
          expires_at: body.expires_at,
          error: body.error,
        })
        if (body.status === 'completed' || body.status === 'error') return
      } catch (err) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: err instanceof Error ? err.message : 'Polling failed',
        }))
        return
      }
    }
  }

  return (
    <section className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-100">Data export</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Download a zip with one CSV per tenant-scoped table
            (companies, contacts, opportunities, signals, agent
            events, audit log, calibration ledger, and more). The
            zip includes a SCHEMA.md describing every file and what&apos;s
            intentionally excluded (raw transcript text, tenant
            config, auth tables). The URL expires in 7 days; we DM
            it to your Slack ID if one is set, otherwise it&apos;s
            available via the link below until it expires.
          </p>
        </div>
        <button
          type="button"
          onClick={startExport}
          disabled={
            state.status === 'requesting' ||
            state.status === 'pending' ||
            state.status === 'scheduled' ||
            state.status === 'running'
          }
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
        >
          {state.status === 'requesting' ||
          state.status === 'pending' ||
          state.status === 'scheduled' ||
          state.status === 'running' ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Preparing…
            </>
          ) : (
            <>
              <Download className="size-4" />
              Export tenant data
            </>
          )}
        </button>
      </div>

      {(state.status === 'pending' ||
        state.status === 'scheduled' ||
        state.status === 'running') && (
        <p
          aria-live="polite"
          className="mt-4 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300"
        >
          {state.current_step
            ? `Step in progress: ${state.current_step}`
            : 'Queued — the export workflow is starting.'}
        </p>
      )}

      {state.status === 'completed' && state.url && (
        <div className="mt-4 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-300" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-emerald-100">
                Export ready
              </p>
              <p className="mt-1 text-xs text-emerald-200/80">
                <a
                  href={state.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-4 hover:underline"
                >
                  Download zip
                </a>
                {state.size_bytes != null && (
                  <span> · {formatBytes(state.size_bytes)}</span>
                )}
                {state.expires_at && (
                  <span>
                    {' · URL expires '}
                    {new Date(state.expires_at).toLocaleString()}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {state.status === 'error' && (
        <div className="mt-4 rounded-md border border-rose-800/40 bg-rose-950/20 p-3">
          <div className="flex items-start gap-2">
            <FileWarning className="size-4 shrink-0 text-rose-300" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-rose-100">
                Export failed
              </p>
              <p className="mt-1 text-xs text-rose-200/80">
                {state.error ?? 'Unknown error.'}
              </p>
              <button
                type="button"
                onClick={startExport}
                className="mt-2 text-xs font-medium text-rose-200 underline-offset-4 hover:underline"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}
