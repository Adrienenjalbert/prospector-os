'use client'

import { normalizeSeniority, normalizeDepartment, SENIORITY_ORDER, SENIORITY_LABELS, DEPT_GROUPS, type SeniorityLevel, type DeptGroup } from '@/lib/normalize'

interface CoverageContact {
  seniority: string | null
  department: string | null
}

interface CoverageMatrixProps {
  contacts: CoverageContact[]
}

export function CoverageMatrix({ contacts }: CoverageMatrixProps) {
  const counts = new Map<string, number>()
  const activeDepts = new Set<DeptGroup>()

  for (const c of contacts) {
    const sen = normalizeSeniority(c.seniority)
    const dept = normalizeDepartment(c.department)
    activeDepts.add(dept)
    const key = `${sen}::${dept}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const depts = DEPT_GROUPS.filter((d) => activeDepts.has(d) || ['Operations', 'Finance', 'HR', 'Procurement'].includes(d))
  const senLevels = SENIORITY_ORDER.filter((s) => s !== 'individual')

  const totalCells = senLevels.length * depts.length
  const filledCells = senLevels.reduce((sum, sen) =>
    sum + depts.reduce((s, dept) => s + (counts.has(`${sen}::${dept}`) ? 1 : 0), 0), 0)
  const coveragePct = totalCells > 0 ? Math.round((filledCells / totalCells) * 100) : 0

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Contact Coverage</h3>
        <span className="text-xs font-mono tabular-nums text-zinc-400">{coveragePct}% covered</span>
      </div>
      <div
        className="grid gap-px"
        style={{ gridTemplateColumns: `70px repeat(${depts.length}, 1fr)` }}
      >
        {/* Header */}
        <div />
        {depts.map((d) => (
          <div key={d} className="text-center text-[9px] font-semibold uppercase tracking-wider text-zinc-600 py-1">
            {d.length > 6 ? d.slice(0, 5) + '.' : d}
          </div>
        ))}

        {/* Rows */}
        {senLevels.map((sen) => (
          <div key={sen} className="contents">
            <div className="flex items-center text-[10px] text-zinc-500 pr-2">
              {SENIORITY_LABELS[sen]}
            </div>
            {depts.map((dept) => {
              const count = counts.get(`${sen}::${dept}`) ?? 0
              return (
                <div
                  key={`${sen}-${dept}`}
                  className={`flex items-center justify-center rounded-sm p-2 text-xs font-mono ${
                    count > 0
                      ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/40'
                      : 'bg-zinc-900 text-zinc-700 border border-dashed border-zinc-800'
                  }`}
                >
                  {count > 0 ? count : '·'}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-zinc-600">
        Green = contact exists · Dashed = gap (prospecting opportunity)
      </p>
    </div>
  )
}
