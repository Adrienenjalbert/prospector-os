'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { formatGbp } from '@/lib/utils'
import { clsx } from 'clsx'

export type AccountRow = {
  id: string
  name: string
  icp_tier: string | null
  priority_tier: string | null
  expected_revenue: number | null
  industry: string | null
}

const ICP_TIERS = ['A', 'B', 'C', 'D'] as const

const priorityStyles: Record<string, string> = {
  HOT: 'border-rose-700/60 bg-rose-950/40 text-rose-200',
  WARM: 'border-amber-700/60 bg-amber-950/40 text-amber-200',
  COOL: 'border-sky-700/60 bg-sky-950/40 text-sky-200',
  MONITOR: 'border-zinc-600 bg-zinc-800/80 text-zinc-300',
}

const icpStyles: Record<string, string> = {
  A: 'border-emerald-700/60 bg-emerald-950/50 text-emerald-200',
  B: 'border-teal-700/60 bg-teal-950/50 text-teal-200',
  C: 'border-zinc-600 bg-zinc-800 text-zinc-300',
  D: 'border-zinc-700 bg-zinc-900 text-zinc-400',
}

export function AccountsTable({ rows }: { rows: AccountRow[] }) {
  const [q, setQ] = useState('')
  const [icpFilter, setIcpFilter] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (icpFilter && (r.icp_tier ?? '').toUpperCase() !== icpFilter) {
        return false
      }
      if (!needle) return true
      const name = r.name.toLowerCase()
      const ind = (r.industry ?? '').toLowerCase()
      return name.includes(needle) || ind.includes(needle)
    })
  }, [rows, q, icpFilter])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full max-w-md">
          <label htmlFor="account-search" className="sr-only">
            Search accounts
          </label>
          <input
            id="account-search"
            type="search"
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or industry..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none ring-zinc-600 focus:border-zinc-600 focus:ring-2 focus:ring-zinc-600/40"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          ICP tier
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setIcpFilter(null)}
            className={clsx(
              'rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
              icpFilter === null
                ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800',
            )}
          >
            All
          </button>
          {ICP_TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() =>
                setIcpFilter((prev) => (prev === tier ? null : tier))
              }
              className={clsx(
                'rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
                icpFilter === tier
                  ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800',
              )}
            >
              {tier}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80">
                <th className="px-4 py-3 font-medium text-zinc-400">Name</th>
                <th className="px-4 py-3 font-medium text-zinc-400">
                  ICP tier
                </th>
                <th className="px-4 py-3 font-medium text-zinc-400">
                  Priority tier
                </th>
                <th className="px-4 py-3 font-medium text-zinc-400">
                  Expected revenue
                </th>
                <th className="px-4 py-3 font-medium text-zinc-400">
                  Industry
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center">
                    <p className="text-base font-medium text-zinc-300">
                      {rows.length === 0
                        ? 'No accounts loaded'
                        : 'No accounts match your filters'}
                    </p>
                    <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
                      {rows.length === 0 ? (
                        <>
                          Connect your CRM in{' '}
                          <a
                            href="/settings"
                            className="text-zinc-300 underline hover:text-zinc-100"
                          >
                            Settings
                          </a>{' '}
                          to sync your accounts. They&apos;ll be scored and
                          prioritised automatically.
                        </>
                      ) : (
                        'Try clearing search or ICP filters.'
                      )}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-zinc-800/80 transition-colors last:border-0 hover:bg-zinc-900/60"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/accounts/${r.id}`}
                        className="font-medium text-zinc-100 underline-offset-2 hover:text-violet-300 hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          'inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold',
                          icpStyles[(r.icp_tier ?? 'D').toUpperCase()] ??
                            icpStyles.D,
                        )}
                      >
                        {r.icp_tier ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          'inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold',
                          priorityStyles[
                            (r.priority_tier ?? 'MONITOR').toUpperCase()
                          ] ?? priorityStyles.MONITOR,
                        )}
                      >
                        {r.priority_tier ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-zinc-200">
                      {r.expected_revenue != null
                        ? formatGbp(r.expected_revenue)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {r.industry ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
