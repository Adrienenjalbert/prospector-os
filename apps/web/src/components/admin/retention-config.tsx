"use client"

import { useEffect, useState } from "react"
import { createSupabaseBrowser } from "@/lib/supabase/client"

/**
 * Retention policy editor — Phase 3 T1.3.
 *
 * Lists every retention-target table with its platform default and the
 * tenant's current effective window. Admin can:
 *
 *   - Lengthen the window (write-back to `/api/admin/retention`).
 *   - Revert to default (DELETE the override row).
 *
 * The UI enforces the longer-only rule client-side as a UX hint; the
 * server-side `validateRetentionOverride` is the actual enforcement.
 *
 * Note: the retention-sweep workflow respects `RETENTION_SWEEP_DRY_RUN`
 * env var and runs in shadow mode by default per OQ-4 rollout. Editing a
 * policy here only sets the policy row; the sweep cron is what acts on
 * it. The policy update takes effect on the next nightly sweep.
 */

interface PolicyRow {
  table_name: string
  default_days: number
  max_days: number
  effective_days: number
  is_override: boolean
  override_updated_at: string | null
}

interface PoliciesResponse {
  policies: PolicyRow[]
}

export function RetentionConfig() {
  const [policies, setPolicies] = useState<PolicyRow[] | null>(null)
  const [edits, setEdits] = useState<Record<string, number>>({})
  const [savingTable, setSavingTable] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoadError(null)
    try {
      const supabase = createSupabaseBrowser()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setLoadError("Not authenticated.")
        return
      }
      const res = await fetch("/api/admin/retention", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setLoadError(body?.error ?? `Load failed (${res.status})`)
        return
      }
      const data = (await res.json()) as PoliciesResponse
      setPolicies(data.policies)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Load failed")
    }
  }

  async function save(tableName: string) {
    setError(null)
    setSavingTable(tableName)
    try {
      const proposed = edits[tableName]
      if (typeof proposed !== "number" || !Number.isInteger(proposed)) {
        setError(`${tableName}: enter a whole number of days`)
        return
      }
      const supabase = createSupabaseBrowser()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setError("Not authenticated.")
        return
      }
      const res = await fetch("/api/admin/retention", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          table_name: tableName,
          retention_days: proposed,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error ?? `Save failed (${res.status})`)
        return
      }
      // Refresh the resolved list so the UI matches what the cron will
      // see on the next sweep.
      await load()
      setEdits((prev) => {
        const next = { ...prev }
        delete next[tableName]
        return next
      })
    } finally {
      setSavingTable(null)
    }
  }

  async function revert(tableName: string) {
    setError(null)
    setSavingTable(tableName)
    try {
      const supabase = createSupabaseBrowser()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setError("Not authenticated.")
        return
      }
      const res = await fetch("/api/admin/retention", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ table_name: tableName }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error ?? `Revert failed (${res.status})`)
        return
      }
      await load()
      setEdits((prev) => {
        const next = { ...prev }
        delete next[tableName]
        return next
      })
    } finally {
      setSavingTable(null)
    }
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-800/50 bg-red-950/20 p-4 text-sm text-red-300">
        Failed to load retention policies: {loadError}
      </div>
    )
  }

  if (!policies) {
    return <div className="text-sm text-zinc-500">Loading retention policies…</div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-sm font-semibold text-zinc-200">Retention policies</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Per-table retention windows (in days). Per-tenant overrides may only
          LENGTHEN the platform default — the longer-only rule is a privacy +
          audit invariant. Hard ceiling: 7 years (2555 days). Changes take effect
          on the next nightly retention sweep.
        </p>
        <p className="mt-2 text-xs text-amber-400">
          Note: the sweep runs in dry-run mode by default
          (<code className="font-mono">RETENTION_SWEEP_DRY_RUN=true</code>). Counts
          appear on /admin/adaptation as <code className="font-mono">retention_sweep_completed</code> events.
          Owner flips the env flag to <code className="font-mono">false</code> after
          one week of clean shadow runs.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/20 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {policies.map((p) => {
          const editValue = edits[p.table_name]
          const inFlight = savingTable === p.table_name
          const dirty =
            typeof editValue === "number" && editValue !== p.effective_days
          const tooShort =
            typeof editValue === "number" && editValue < p.default_days
          const tooLong =
            typeof editValue === "number" && editValue > p.max_days
          const inputInvalid = tooShort || tooLong

          return (
            <li
              key={p.table_name}
              className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-zinc-100">
                    {p.table_name}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Default: {p.default_days} days · Max: {p.max_days} days
                    {p.is_override ? (
                      <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-300">
                        Override active
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">Days</span>
                    <input
                      type="number"
                      min={p.default_days}
                      max={p.max_days}
                      step={1}
                      value={editValue ?? p.effective_days}
                      onChange={(e) =>
                        setEdits((prev) => ({
                          ...prev,
                          [p.table_name]: parseInt(e.target.value, 10),
                        }))
                      }
                      className={`w-24 rounded-md border bg-zinc-900 px-2 py-1.5 font-mono text-sm tabular-nums text-zinc-100 outline-none focus:ring-2 focus:ring-zinc-500/30 ${
                        inputInvalid
                          ? "border-red-700 focus:border-red-500"
                          : "border-zinc-700 focus:border-zinc-500"
                      }`}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => save(p.table_name)}
                    disabled={!dirty || inputInvalid || inFlight}
                    className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
                  >
                    {inFlight ? "Saving…" : "Save"}
                  </button>
                  {p.is_override && (
                    <button
                      type="button"
                      onClick={() => revert(p.table_name)}
                      disabled={inFlight}
                      className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Revert to default
                    </button>
                  )}
                </div>
              </div>

              {tooShort && (
                <p className="mt-2 text-xs text-red-400">
                  Per-tenant overrides may only LENGTHEN the platform default
                  ({p.default_days} days for {p.table_name}).
                </p>
              )}
              {tooLong && (
                <p className="mt-2 text-xs text-red-400">
                  Retention cannot exceed {p.max_days} days (7 years).
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
