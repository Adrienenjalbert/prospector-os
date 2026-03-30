'use client'

import { TerritoryMap } from '@/components/accounts/territory-map'
import { IcpDistribution } from '@/components/accounts/icp-distribution'
import type { AccountRow } from './accounts-table'

interface AccountsDashboardProps {
  rows: AccountRow[]
}

export function AccountsDashboard({ rows }: AccountsDashboardProps) {
  const mapCompanies = rows.filter((r) => r.hq_city).map((r) => ({
    id: r.id,
    name: r.name,
    hq_city: r.hq_city ?? null,
    hq_country: r.hq_country ?? null,
    priority_tier: r.priority_tier,
    expected_revenue: r.expected_revenue,
  }))

  const scores = rows.map((r) => r.propensity ?? 0).filter((s) => s > 0)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {mapCompanies.length > 0 && <TerritoryMap companies={mapCompanies} />}
      {scores.length > 0 && <IcpDistribution scores={scores} />}
    </div>
  )
}
