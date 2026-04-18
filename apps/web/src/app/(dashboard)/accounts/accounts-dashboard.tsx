'use client'

import { TerritoryMap } from '@/components/accounts/territory-map'
import { IcpDistribution } from '@/components/accounts/icp-distribution'
import type { AccountRow } from './accounts-table'

interface AccountsDashboardProps {
  rows: AccountRow[]
}

/**
 * Accounts dashboard — territory map + ICP distribution from REAL columns
 * on the companies table. The engagement heatmap was previously fed
 * synthetic touch/recency data (`generateDemoEngagement`); it has been
 * removed until activities/events are aggregated into a real
 * `last_touch_at` + `touch_count_30d` per company. MISSION UX rule 8.
 */
export function AccountsDashboard({ rows }: AccountsDashboardProps) {
  const mapCompanies = rows.filter((r) => r.hq_city).map((r) => ({
    id: r.id,
    name: r.name,
    hq_city: r.hq_city ?? null,
    hq_country: r.hq_country ?? null,
    priority_tier: r.priority_tier,
    expected_revenue: r.expected_revenue,
    industry: r.industry ?? null,
  }))

  const scores = rows.map((r) => r.propensity ?? 0).filter((s) => s > 0)

  if (mapCompanies.length === 0 && scores.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {mapCompanies.length > 0 && <TerritoryMap companies={mapCompanies} />}
        {scores.length > 0 && <IcpDistribution scores={scores} />}
      </div>
    </div>
  )
}
