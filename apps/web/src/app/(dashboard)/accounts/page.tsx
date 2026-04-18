import { createSupabaseServer } from '@/lib/supabase/server'
import { AccountsTable, type AccountRow } from './accounts-table'
import { AccountsDashboard } from './accounts-dashboard'
import { AccountsKpiStrip } from './accounts-kpi-strip'
import { SkillBar } from '@/components/agent/skill-bar'
import { ACCOUNTS_SKILLS } from '@/lib/agent/skills'

const DEMO_ROWS: AccountRow[] = [
  {
    id: 'demo-001',
    name: 'Acme Logistics',
    icp_tier: 'A',
    priority_tier: 'HOT',
    expected_revenue: 200_000,
    industry: 'Logistics',
    propensity: 87,
    hq_city: 'Manchester',
    hq_country: 'UK',
  },
  {
    id: 'demo-002',
    name: 'Beta Warehousing',
    icp_tier: 'A',
    priority_tier: 'WARM',
    expected_revenue: 160_000,
    industry: 'Warehousing',
    propensity: 79,
    hq_city: 'London',
    hq_country: 'UK',
  },
  {
    id: 'demo-003',
    name: 'Gamma Manufacturing',
    icp_tier: 'A',
    priority_tier: 'WARM',
    expected_revenue: 63_000,
    industry: 'Light Industrial',
    propensity: 63,
    hq_city: 'Birmingham',
    hq_country: 'UK',
  },
  {
    id: 'demo-004',
    name: 'Delta Distribution',
    icp_tier: 'B',
    priority_tier: 'COOL',
    expected_revenue: 42_000,
    industry: 'Distribution',
    propensity: 42,
    hq_city: 'Leeds',
    hq_country: 'UK',
  },
]

async function fetchAccounts(): Promise<AccountRow[] | null> {
  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id, rep_profile_id')
      .eq('id', user.id)
      .single()
    if (!profile?.rep_profile_id) return null

    const { data: repProfile } = await supabase
      .from('rep_profiles')
      .select('crm_id')
      .eq('id', profile.rep_profile_id)
      .single()
    const repCrmId = repProfile?.crm_id
    if (!repCrmId) return null

    const { data: rows, error } = await supabase
      .from('companies')
      .select(
        'id, name, icp_tier, priority_tier, expected_revenue, industry, propensity, hq_city, hq_country',
      )
      .eq('tenant_id', profile.tenant_id)
      .eq('owner_crm_id', repCrmId)
      .order('propensity', { ascending: false })

    if (error) {
      console.error('[accounts]', error)
      return null
    }

    if (!rows?.length) return []

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      icp_tier: r.icp_tier,
      priority_tier: r.priority_tier,
      expected_revenue:
        r.expected_revenue != null ? Number(r.expected_revenue) : null,
      industry: r.industry,
      propensity: r.propensity != null ? Number(r.propensity) : null,
      hq_city: r.hq_city ?? null,
      hq_country: r.hq_country ?? null,
    }))
  } catch (e) {
    console.error('[accounts]', e)
    return null
  }
}

export default async function AccountsPage() {
  const fetched = await fetchAccounts()
  const useDemo = fetched === null
  const rows = useDemo ? DEMO_ROWS : fetched!

  const totalRev = rows.reduce((s, r) => s + (r.expected_revenue ?? 0), 0)
  const tierACnt = rows.filter((r) => (r.icp_tier ?? '').toUpperCase() === 'A').length
  const tierBCnt = rows.filter((r) => (r.icp_tier ?? '').toUpperCase() === 'B').length
  const avgPropensity = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (r.propensity ?? 0), 0) / rows.length) : 0
  const hotCnt = rows.filter((r) => (r.priority_tier ?? '').toUpperCase() === 'HOT').length

  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8">
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
              Accounts
            </h1>
            <p className="mt-1 text-sm text-zinc-500">{rows.length} accounts</p>
          </div>
          <SkillBar
            skills={ACCOUNTS_SKILLS}
            pageContext={{ page: 'accounts' }}
          />
        </div>

        {useDemo && (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
            <p className="text-sm text-amber-300/80">
              Showing demo data. Connect your CRM to sync your accounts.
            </p>
          </div>
        )}

        <AccountsKpiStrip
          totalRev={totalRev}
          tierACnt={tierACnt}
          tierBCnt={tierBCnt}
          avgPropensity={avgPropensity}
          hotCnt={hotCnt}
        />

        {/* Territory Map + ICP Distribution */}
        <AccountsDashboard rows={rows} />

        <AccountsTable rows={rows} />
      </div>
    </div>
  )
}
