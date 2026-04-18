import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import { formatGbp } from '@/lib/utils'
import { MyFunnelDashboard } from './funnel-dashboard'

export const metadata = { title: 'My Funnel' }
export const dynamic = 'force-dynamic'

interface StageBenchmark {
  stage: string
  repConvRate: number
  benchConvRate: number
  repVelocityDays: number
  benchVelocityDays: number
  repDropRate: number
  benchDropRate: number
  entered: number
  converted: number
  dropped: number
  status: 'CRITICAL' | 'MONITOR' | 'OPPORTUNITY' | 'HEALTHY'
}

/**
 * My Funnel — real data only. If the tenant has no rep-vs-company benchmarks
 * yet we show an empty state + deep link to the ontology browser, rather than
 * a plausible demo that misleads managers.
 */
async function buildStages(): Promise<{ stages: StageBenchmark[]; kpi: { pipelineValue: number; winRate: number; stallCount: number; avgCycleDays: number } | null }> {
  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { stages: [], kpi: null }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id, rep_profile_id')
      .eq('id', user.id)
      .single()
    if (!profile?.tenant_id) return { stages: [], kpi: null }

    const { data: rep } = await supabase
      .from('rep_profiles')
      .select('crm_id')
      .eq('id', profile.rep_profile_id ?? '')
      .maybeSingle()
    const repId = rep?.crm_id
    if (!repId) return { stages: [], kpi: null }

    const [repBench, companyBench, opps] = await Promise.all([
      supabase
        .from('funnel_benchmarks')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('scope', 'rep')
        .eq('scope_id', repId),
      supabase
        .from('funnel_benchmarks')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('scope', 'company')
        .eq('scope_id', 'all'),
      supabase
        .from('opportunities')
        .select('value, is_closed, is_won, is_stalled, days_in_stage')
        .eq('tenant_id', profile.tenant_id)
        .eq('owner_crm_id', repId),
    ])

    const companyMap = new Map((companyBench.data ?? []).map((b) => [b.stage_name, b]))
    const stages: StageBenchmark[] = (repBench.data ?? []).map((rb) => {
      const cb = companyMap.get(rb.stage_name)
      const delta = rb.drop_rate - (cb?.drop_rate ?? 0)
      const isHighDrop = delta >= 5
      const isHighVol = rb.deal_count >= (cb?.deal_count ?? 1)
      const status: StageBenchmark['status'] =
        isHighDrop && isHighVol ? 'CRITICAL'
          : isHighDrop ? 'MONITOR'
          : isHighVol ? 'OPPORTUNITY'
          : 'HEALTHY'
      const converted = Math.round(rb.deal_count * (rb.conversion_rate / 100))
      const dropped = rb.deal_count - converted
      return {
        stage: rb.stage_name,
        repConvRate: Math.round(rb.conversion_rate),
        benchConvRate: Math.round(cb?.conversion_rate ?? 0),
        repVelocityDays: Math.round(rb.avg_days_in_stage),
        benchVelocityDays: Math.round(cb?.avg_days_in_stage ?? 0),
        repDropRate: Math.round(rb.drop_rate),
        benchDropRate: Math.round(cb?.drop_rate ?? 0),
        entered: rb.deal_count,
        converted,
        dropped,
        status,
      }
    })

    const openOpps = (opps.data ?? []).filter((o) => !o.is_closed)
    const closedOpps = (opps.data ?? []).filter((o) => o.is_closed)
    const wonCount = closedOpps.filter((o) => o.is_won).length
    const kpi = {
      pipelineValue: openOpps.reduce((s, o) => s + (o.value ?? 0), 0),
      winRate: closedOpps.length > 0 ? Math.round((wonCount / closedOpps.length) * 100) : 0,
      stallCount: openOpps.filter((o) => o.is_stalled).length,
      avgCycleDays: openOpps.length > 0
        ? Math.round(openOpps.reduce((s, o) => s + (o.days_in_stage ?? 0), 0) / openOpps.length)
        : 0,
    }

    return { stages, kpi }
  } catch {
    return { stages: [], kpi: null }
  }
}

export default async function MyFunnelPage() {
  const { stages, kpi } = await buildStages()

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">My Funnel</h1>
        <p className="mt-1 text-sm text-zinc-500">Stage-by-stage performance vs company benchmark</p>
      </div>

      {kpi && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Pipeline Value', value: formatGbp(kpi.pipelineValue), color: 'text-zinc-100' },
            { label: 'Win Rate', value: `${kpi.winRate}%`, color: 'text-emerald-400' },
            { label: 'Stalls', value: `${kpi.stallCount}`, color: kpi.stallCount > 5 ? 'text-red-400' : 'text-zinc-200' },
            { label: 'Avg Cycle', value: `${kpi.avgCycleDays}d`, color: 'text-zinc-200' },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
              <p className="text-xs text-zinc-500">{m.label}</p>
              <p className={`mt-1 font-mono text-xl font-bold tabular-nums ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {stages.length > 0 ? (
        <div className="mt-6">
          <MyFunnelDashboard stages={stages} />
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center">
          <p className="text-sm text-zinc-400">No funnel benchmarks yet for your book of business.</p>
          <p className="mt-2 text-xs text-zinc-500">
            Benchmarks are computed weekly from the last 90 days of deals. In the meantime, browse{' '}
            <Link href="/objects/deals" className="text-sky-300 hover:underline">your deals</Link>.
          </p>
        </div>
      )}
    </div>
  )
}
