'use client'

import { KpiCard } from '@/components/charts/kpi-card'

interface AccountsKpiStripProps {
  totalRev: number
  tierACnt: number
  tierBCnt: number
  avgPropensity: number
  hotCnt: number
}

/**
 * KPI strip — values only. Sparklines and deltas are intentionally omitted
 * until a real time-series exists in `account_health_snapshots` or similar.
 * MISSION UX rule 8: empty states beat fake numbers.
 */
export function AccountsKpiStrip({ totalRev, tierACnt, tierBCnt, avgPropensity, hotCnt }: AccountsKpiStripProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <KpiCard
        label="Total Revenue"
        value={`£${Math.round(totalRev / 1000)}K`}
        color="text-zinc-100"
      />
      <KpiCard
        label="Tier A"
        value={`${tierACnt}`}
        color="text-emerald-400"
      />
      <KpiCard
        label="Tier B"
        value={`${tierBCnt}`}
        color="text-teal-400"
      />
      <KpiCard
        label="Avg Priority"
        value={`${avgPropensity}`}
        color="text-zinc-200"
      />
      <KpiCard
        label="HOT"
        value={`${hotCnt}`}
        color="text-red-400"
      />
    </div>
  )
}
