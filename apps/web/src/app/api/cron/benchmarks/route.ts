import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase, recordCronRun } from '@/lib/cron-auth'

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()

  const startTime = Date.now()

  try {
    const supabase = getServiceSupabase()
    const { computeBenchmarks, computeImpactScores } = await import('@prospector/core')

    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, funnel_config')
      .eq('active', true)

    if (!tenants?.length) {
      return NextResponse.json({ message: 'No active tenants' })
    }

    let totalBenchmarks = 0

    for (const tenant of tenants) {
      const funnelConfig = tenant.funnel_config as { stages?: { name: string; stage_type: string }[] } | null
      const stages = (funnelConfig?.stages ?? [])
        .filter((s) => !['closed_won', 'closed_lost'].includes(s.stage_type))
        .map((s) => s.name)

      if (stages.length === 0) continue

      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      const { data: allOpps } = await supabase
        .from('opportunities')
        .select('*')
        .eq('tenant_id', tenant.id)
        .gte('created_at', ninetyDaysAgo)

      if (!allOpps?.length) continue

      const period = new Date().toISOString().slice(0, 7)

      const companyBenchmarks = computeBenchmarks({
        opportunities: allOpps,
        scope: 'company' as const,
        scope_id: 'all',
        period,
        stages,
      })

      for (const b of companyBenchmarks) {
        await supabase.from('funnel_benchmarks').upsert(
          { ...b, tenant_id: tenant.id },
          { onConflict: 'tenant_id,stage_name,period,scope,scope_id' }
        )
        totalBenchmarks++
      }

      const { data: reps } = await supabase
        .from('rep_profiles')
        .select('crm_id')
        .eq('tenant_id', tenant.id)
        .eq('active', true)

      for (const rep of reps ?? []) {
        const repOpps = allOpps.filter((o) => o.owner_crm_id === rep.crm_id)
        if (repOpps.length === 0) continue

        const repBenchmarks = computeBenchmarks({
          opportunities: repOpps,
          scope: 'rep' as const,
          scope_id: rep.crm_id,
          period,
          stages,
        })

        for (const b of repBenchmarks) {
          await supabase.from('funnel_benchmarks').upsert(
            { ...b, tenant_id: tenant.id },
            { onConflict: 'tenant_id,stage_name,period,scope,scope_id' }
          )
          totalBenchmarks++
        }

        const impacts = computeImpactScores(
          repBenchmarks as any[],
          companyBenchmarks as any[],
          5,
          (reps ?? []).length
        )

        for (const impact of impacts) {
          await supabase
            .from('funnel_benchmarks')
            .update({ impact_score: impact.impact_score })
            .eq('tenant_id', tenant.id)
            .eq('stage_name', impact.stage_name)
            .eq('period', period)
            .eq('scope', 'rep')
            .eq('scope_id', rep.crm_id)
        }
      }
    }

    await recordCronRun('/api/cron/benchmarks', 'success', Date.now() - startTime, totalBenchmarks)
    return NextResponse.json({ benchmarks: totalBenchmarks })
  } catch (err) {
    console.error('[cron/benchmarks]', err)
    await recordCronRun('/api/cron/benchmarks', 'error', Date.now() - startTime, 0, err instanceof Error ? err.message : 'Unknown error')
    return NextResponse.json({ error: 'Benchmark computation failed' }, { status: 500 })
  }
}
