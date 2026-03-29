import { createSupabaseServer } from '@/lib/supabase/server'
import { AccountsTable, type AccountRow } from './accounts-table'

const DEMO_ROWS: AccountRow[] = [
  {
    id: 'demo-001',
    name: 'Acme Logistics',
    icp_tier: 'A',
    priority_tier: 'HOT',
    expected_revenue: 200_000,
    industry: 'Logistics',
  },
  {
    id: 'demo-002',
    name: 'Beta Warehousing',
    icp_tier: 'A',
    priority_tier: 'WARM',
    expected_revenue: 160_000,
    industry: 'Warehousing',
  },
  {
    id: 'demo-003',
    name: 'Gamma Manufacturing',
    icp_tier: 'A',
    priority_tier: 'WARM',
    expected_revenue: 63_000,
    industry: 'Light Industrial',
  },
  {
    id: 'demo-004',
    name: 'Delta Distribution',
    icp_tier: 'B',
    priority_tier: 'COOL',
    expected_revenue: 42_000,
    industry: 'Distribution',
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
        'id, name, icp_tier, priority_tier, expected_revenue, industry',
      )
      .eq('tenant_id', profile.tenant_id)
      .eq('owner_crm_id', repCrmId)
      .order('expected_revenue', { ascending: false })

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

  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Accounts
          </h1>
          {useDemo && (
            <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
              <p className="text-sm text-amber-300/80">
                Showing demo data. Connect your CRM to sync your accounts.
              </p>
            </div>
          )}
        </div>

        <AccountsTable rows={rows} />
      </div>
    </div>
  )
}
