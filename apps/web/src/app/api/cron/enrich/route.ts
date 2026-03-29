import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase } from '@/lib/cron-auth'
import { ApolloAdapter } from '@prospector/adapters'

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()

  try {
    const supabase = getServiceSupabase()
    const apolloKey = process.env.APOLLO_API_KEY
    if (!apolloKey) {
      return NextResponse.json({ message: 'No APOLLO_API_KEY configured' })
    }

    const apollo = new ApolloAdapter(apolloKey)

    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, enrichment_budget_monthly, enrichment_spend_current')
      .eq('active', true)

    if (!tenants?.length) {
      return NextResponse.json({ message: 'No active tenants' })
    }

    const enrichedPerTenant = new Map<string, number>()

    for (const tenant of tenants) {
      const remaining = tenant.enrichment_budget_monthly - tenant.enrichment_spend_current
      if (remaining <= 0) continue

      const batchLimit = Math.min(50, Math.floor(remaining / 0.5))

      const { data: neverEnriched } = await supabase
        .from('companies')
        .select('id, domain, name, propensity, enriched_at, last_signal_check')
        .eq('tenant_id', tenant.id)
        .is('enriched_at', null)
        .order('propensity', { ascending: false, nullsFirst: false })
        .limit(batchLimit)

      const staleThreshold = new Date(Date.now() - 30 * 86400000).toISOString()
      const staleLimit = batchLimit - (neverEnriched?.length ?? 0)

      const { data: staleCompanies } = staleLimit > 0
        ? await supabase
            .from('companies')
            .select('id, domain, name, propensity, enriched_at, last_signal_check')
            .eq('tenant_id', tenant.id)
            .not('enriched_at', 'is', null)
            .lt('enriched_at', staleThreshold)
            .gte('propensity', 50)
            .order('propensity', { ascending: false })
            .limit(staleLimit)
        : { data: [] }

      const allCandidates = [...(neverEnriched ?? []), ...(staleCompanies ?? [])]

      const companies = allCandidates
        .map((c) => {
          const daysSinceEnrichment = c.enriched_at
            ? (Date.now() - new Date(c.enriched_at).getTime()) / 86400000
            : 90
          const staleness = Math.min(daysSinceEnrichment / 30, 3)
          const signalFreshness = c.last_signal_check
            ? Math.max(0, 1 - (Date.now() - new Date(c.last_signal_check).getTime()) / (14 * 86400000))
            : 0
          const priority = staleness * (c.propensity ?? 1) * (1 + signalFreshness)
          return { ...c, enrichment_priority: priority }
        })
        .sort((a, b) => b.enrichment_priority - a.enrichment_priority)
        .slice(0, batchLimit)

      if (!companies?.length) continue

      let tenantEnriched = 0

      for (const company of companies) {
        if (!company.domain) continue

        try {
          const enrichment = await apollo.enrichCompany(company.domain)

          await supabase.from('companies').update({
            industry: enrichment.industry ?? undefined,
            industry_group: enrichment.industry_group ?? undefined,
            employee_count: enrichment.employee_count ?? undefined,
            employee_range: enrichment.employee_range ?? undefined,
            annual_revenue: enrichment.annual_revenue ?? undefined,
            hq_city: enrichment.hq_city ?? undefined,
            hq_country: enrichment.hq_country ?? undefined,
            locations: enrichment.locations,
            tech_stack: enrichment.tech_stack,
            enriched_at: new Date().toISOString(),
            enrichment_source: 'apollo',
            enrichment_data: enrichment.raw_data,
          }).eq('id', company.id)

          await supabase.from('enrichment_jobs').insert({
            tenant_id: tenant.id,
            company_id: company.id,
            provider: 'apollo',
            job_type: 'company',
            status: 'completed',
            completed_at: new Date().toISOString(),
          })

          tenantEnriched++
        } catch (err) {
          await supabase.from('enrichment_jobs').insert({
            tenant_id: tenant.id,
            company_id: company.id,
            provider: 'apollo',
            job_type: 'company',
            status: 'failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      }

      if (tenantEnriched > 0) {
        enrichedPerTenant.set(tenant.id, tenantEnriched)
        await supabase.from('tenants').update({
          enrichment_spend_current: tenant.enrichment_spend_current + tenantEnriched * 0.5,
        }).eq('id', tenant.id)
      }
    }

    const totalEnriched = [...enrichedPerTenant.values()].reduce((a, b) => a + b, 0)
    return NextResponse.json({ enriched: totalEnriched })
  } catch (err) {
    console.error('[cron/enrich]', err)
    return NextResponse.json({ error: 'Enrichment failed' }, { status: 500 })
  }
}
