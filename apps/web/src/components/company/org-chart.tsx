'use client'

import { cn } from '@/lib/utils'
import { normalizeSeniority, normalizeDepartment, SENIORITY_ORDER, SENIORITY_LABELS, DEPT_GROUPS, type SeniorityLevel, type DeptGroup } from '@/lib/normalize'

interface OrgContact {
  id: string
  name: string
  firstName: string
  lastName: string
  title: string
  seniority: string | null
  department: string | null
  roleTag: string | null
  isChampion: boolean
  isDecisionMaker: boolean
  isEconomicBuyer: boolean
  engagementScore: number
}

interface OrgChartProps {
  contacts: OrgContact[]
  onContactClick: (id: string) => void
}

const ROLE_BORDER: Record<string, string> = {
  champion: 'border-emerald-500',
  economic_buyer: 'border-violet-500',
  technical_evaluator: 'border-sky-500',
  blocker: 'border-red-500',
  end_user: 'border-zinc-600',
}

type GridCell = OrgContact[]

export function OrgChart({ contacts, onContactClick }: OrgChartProps) {
  const grid = new Map<string, GridCell>()
  const activeDepts = new Set<DeptGroup>()

  for (const c of contacts) {
    const sen = normalizeSeniority(c.seniority)
    const dept = normalizeDepartment(c.department)
    const key = `${sen}::${dept}`
    activeDepts.add(dept)
    const cell = grid.get(key) ?? []
    cell.push(c)
    grid.set(key, cell)
  }

  const depts = DEPT_GROUPS.filter((d) => activeDepts.has(d))
  if (depts.length === 0) return null

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 overflow-x-auto">
      <h3 className="mb-3 text-sm font-semibold text-zinc-200">Organization Map</h3>
      <div
        className="grid gap-1 min-w-[500px]"
        style={{ gridTemplateColumns: `80px repeat(${depts.length}, minmax(120px, 1fr))` }}
      >
        {/* Header row */}
        <div />
        {depts.map((dept) => (
          <div key={dept} className="px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {dept}
          </div>
        ))}

        {/* Data rows */}
        {SENIORITY_ORDER.map((sen) => {
          const hasAny = depts.some((d) => (grid.get(`${sen}::${d}`) ?? []).length > 0)
          if (!hasAny) return null

          return [
            <div key={`label-${sen}`} className="flex items-center px-2 py-1 text-[10px] font-medium text-zinc-500">
              {SENIORITY_LABELS[sen]}
            </div>,
            ...depts.map((dept) => {
              const cell = grid.get(`${sen}::${dept}`) ?? []
              if (cell.length === 0) {
                return (
                  <div key={`${sen}-${dept}`} className="rounded-md border border-dashed border-zinc-800 p-1 min-h-[48px]" />
                )
              }
              return (
                <div key={`${sen}-${dept}`} className="flex flex-wrap gap-1 p-1">
                  {cell.map((c) => {
                    const opacity = Math.max(0.3, c.engagementScore / 100)
                    return (
                      <button
                        key={c.id}
                        onClick={() => onContactClick(c.id)}
                        style={{ opacity }}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg border-2 bg-zinc-900 px-2 py-1.5 text-left transition-colors hover:bg-zinc-800',
                          ROLE_BORDER[c.roleTag ?? ''] ?? 'border-zinc-700',
                        )}
                        title={`${c.name} · ${c.title}`}
                      >
                        <div className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold',
                          c.isDecisionMaker ? 'bg-amber-900/60 text-amber-200 ring-2 ring-amber-500/60' : 'bg-zinc-800 text-zinc-400',
                        )}>
                          {c.firstName[0]}{c.lastName[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-medium text-zinc-200">{c.name}</p>
                          <p className="truncate text-[9px] text-zinc-500">{c.title}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            }),
          ]
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded border-2 border-emerald-500" /> Champion</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded border-2 border-violet-500" /> Economic Buyer</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded border-2 border-sky-500" /> Technical</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded border-2 border-red-500" /> Blocker</span>
        <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-full bg-amber-900/60 ring-2 ring-amber-500/60" /> Decision Maker</span>
      </div>
    </div>
  )
}
