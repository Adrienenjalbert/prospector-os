export type SortField = 'priority' | 'revenue' | 'signals' | 'name' | 'days'

export function sortCompanies<
  T extends {
    propensity?: number | null
    expected_revenue?: number | null
    expectedRevenue?: number | null
    name?: string
    companyPropensity?: number | null
    value?: number | null
    daysInStage?: number | null
    signalCount?: number | null
  },
>(items: T[], field: SortField = 'priority'): T[] {
  return [...items].sort((a, b) => {
    switch (field) {
      case 'priority': {
        const ap = a.propensity ?? a.companyPropensity ?? 0
        const bp = b.propensity ?? b.companyPropensity ?? 0
        if (bp !== ap) return bp - ap
        const ar = a.expected_revenue ?? a.expectedRevenue ?? a.value ?? 0
        const br = b.expected_revenue ?? b.expectedRevenue ?? b.value ?? 0
        return br - ar
      }
      case 'revenue': {
        const ar = a.expected_revenue ?? a.expectedRevenue ?? a.value ?? 0
        const br = b.expected_revenue ?? b.expectedRevenue ?? b.value ?? 0
        return br - ar
      }
      case 'signals': {
        const as_ = a.signalCount ?? 0
        const bs = b.signalCount ?? 0
        return bs - as_
      }
      case 'days': {
        const ad = a.daysInStage ?? 0
        const bd = b.daysInStage ?? 0
        return bd - ad
      }
      case 'name': {
        const an = a.name ?? ''
        const bn = b.name ?? ''
        return an.localeCompare(bn)
      }
      default:
        return 0
    }
  })
}
