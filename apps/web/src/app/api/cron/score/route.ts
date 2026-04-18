import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase, recordCronRun } from '@/lib/cron-auth'
import { decryptCredentials, isEncryptedString } from '@/lib/crypto'
import { HubSpotAdapter, SalesforceAdapter } from '@prospector/adapters'
import type { CRMActivity } from '@prospector/core'

const ACTIVITIES_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const ACTIVITIES_LOOKBACK_DAYS = 30

type CRMAdapterLike = {
  getActivities: (accountId: string, since: Date) => Promise<CRMActivity[]>
}

function parseCreds(raw: unknown): Record<string, string> {
  if (!raw) return {}
  return isEncryptedString(raw)
    ? (decryptCredentials(raw) as Record<string, string>)
    : (raw as Record<string, string>)
}

function buildCrmAdapter(
  crmType: string | null,
  credentials: Record<string, string>,
): CRMAdapterLike | null {
  if (crmType === 'hubspot' && credentials.private_app_token) {
    return new HubSpotAdapter({ private_app_token: credentials.private_app_token })
  }
  if (crmType === 'salesforce' && credentials.client_id) {
    return new SalesforceAdapter({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      instance_url: credentials.instance_url,
      refresh_token: credentials.refresh_token,
    })
  }
  return null
}

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()

  const startTime = Date.now()

  try {
    const supabase = getServiceSupabase()
    const { computeCompositeScore, computeBenchmarks, computeImpactScores } = await import('@prospector/core')

    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, icp_config, scoring_config, signal_config, funnel_config, crm_type, crm_credentials_encrypted, business_config')
      .eq('active', true)

    if (!tenants?.length) {
      return NextResponse.json({ message: 'No active tenants' })
    }

    let totalScored = 0
    let totalBenchmarks = 0

    for (const tenant of tenants) {
      // --- Phase 1: Score all companies ---
      const [companiesRes, benchmarksRes, wonRes, closedRes] = await Promise.all([
        supabase.from('companies').select('*').eq('tenant_id', tenant.id),
        supabase
          .from('funnel_benchmarks')
          .select('*')
          .eq('tenant_id', tenant.id)
          .eq('scope', 'company')
          .eq('scope_id', 'all'),
        supabase
          .from('opportunities')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('is_won', true),
        supabase
          .from('opportunities')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('is_closed', true),
      ])

      const companies = companiesRes.data
      if (!companies?.length) continue

      const tenantBenchmarks = benchmarksRes.data ?? []
      const wonCount = wonRes.count ?? 0
      const closedCount = closedRes.count ?? 0
      const companyWinRate = closedCount > 0 ? (wonCount / closedCount) * 100 : 15

      const tenantCreds = parseCreds(tenant.crm_credentials_encrypted)
      const crmAdapter = buildCrmAdapter(tenant.crm_type, tenantCreds)

      // Two-pass scoring so the engagement scorer sees a real tenant-wide
      // median instead of per-company-self (which collapses to 1).
      const perCompanyActivities = new Map<string, CRMActivity[]>()
      for (const company of companies) {
        const acts = await loadActivitiesForCompany(supabase, crmAdapter, company)
        perCompanyActivities.set(company.id, acts)
      }

      const counts30d = companies.map((c) => {
        const acts = perCompanyActivities.get(c.id) ?? []
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
        return acts.filter((a) => new Date(a.occurred_at).getTime() >= cutoff).length
      })
      const tenantMedianActivities30d = median(counts30d)

      for (const company of companies) {
        const [contactsRes, signalsRes, oppsRes] = await Promise.all([
          supabase.from('contacts').select('*').eq('company_id', company.id),
          supabase.from('signals').select('*').eq('company_id', company.id),
          supabase.from('opportunities').select('*').eq('company_id', company.id),
        ])

        const activities = perCompanyActivities.get(company.id) ?? []

        const result = computeCompositeScore(
          {
            company,
            contacts: contactsRes.data ?? [],
            signals: signalsRes.data ?? [],
            opportunities: oppsRes.data ?? [],
            activities,
            benchmarks: tenantBenchmarks,
            previousSignalScore: company.signal_score ?? null,
            companyWinRate,
            tenantMedianActivities30d,
          },
          {
            icpConfig: tenant.icp_config,
            scoringConfig: tenant.scoring_config,
            signalConfig: tenant.signal_config,
          }
        )

        await supabase.from('companies').update({
          icp_score: result.icp_score,
          icp_tier: result.icp_tier,
          signal_score: result.signal_score,
          engagement_score: result.engagement_score,
          contact_coverage_score: result.contact_coverage_score,
          velocity_score: result.velocity_score,
          win_rate_score: result.win_rate_score,
          propensity: result.propensity,
          expected_revenue: result.expected_revenue,
          urgency_multiplier: result.urgency_multiplier,
          priority_tier: result.priority_tier,
          priority_reason: result.priority_reason,
        }).eq('id', company.id)

        await supabase.from('scoring_snapshots').insert({
          tenant_id: tenant.id,
          company_id: company.id,
          opportunity_id: null,
          icp_fit: result.icp_score,
          signal_momentum: result.signal_score,
          engagement_depth: result.engagement_score,
          contact_coverage: result.contact_coverage_score,
          stage_velocity: result.velocity_score,
          profile_win_rate: result.win_rate_score,
          propensity: result.propensity,
          deal_value: result.expected_revenue,
          expected_revenue: result.expected_revenue,
          snapshot_trigger: 'weekly',
          config_version: tenant.scoring_config?.version ?? '3.0',
        })

        totalScored++
      }

      // --- Phase 2: Compute funnel benchmarks ---
      const funnelConfig = tenant.funnel_config as { stages?: { name: string; stage_type: string }[] } | null
      const stages = (funnelConfig?.stages ?? [])
        .filter(s => !['closed_won', 'closed_lost'].includes(s.stage_type))
        .map(s => s.name)

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
        const repOpps = allOpps.filter(o => o.owner_crm_id === rep.crm_id)
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
          repBenchmarks as Parameters<typeof computeImpactScores>[0],
          companyBenchmarks as Parameters<typeof computeImpactScores>[1],
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

    await recordCronRun('/api/cron/score', 'success', Date.now() - startTime, totalScored + totalBenchmarks)
    return NextResponse.json({ scored: totalScored, benchmarks: totalBenchmarks })
  } catch (err) {
    console.error('[cron/score]', err)
    await recordCronRun('/api/cron/score', 'error', Date.now() - startTime, 0, err instanceof Error ? err.message : 'Unknown error')
    return NextResponse.json({ error: 'Scoring failed' }, { status: 500 })
  }
}

type CompanyRow = {
  id: string
  crm_id: string | null
  enrichment_data: Record<string, unknown> | null
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

// Returns CRM activities for the company.
//
// Strategy: read from companies.enrichment_data.activities if the cache is
// fresh (< 24h). Otherwise fetch the last 30 days from the CRM, normalize,
// and write back to enrichment_data so engagement scoring has real data
// without needing per-event rows in the MVP. Failures fall back to whatever
// is cached (possibly empty) so a flaky CRM never crashes scoring.
async function loadActivitiesForCompany(
  supabase: ReturnType<typeof getServiceSupabase>,
  crmAdapter: CRMAdapterLike | null,
  company: CompanyRow,
): Promise<CRMActivity[]> {
  const enrichmentData = (company.enrichment_data ?? {}) as Record<string, unknown>
  const cachedActivities = (enrichmentData.activities as CRMActivity[] | undefined) ?? []
  const cachedAt = enrichmentData.activities_cached_at as string | undefined
  const cacheAgeMs = cachedAt ? Date.now() - new Date(cachedAt).getTime() : Infinity

  if (cacheAgeMs < ACTIVITIES_CACHE_TTL_MS) return cachedActivities
  if (!crmAdapter || !company.crm_id) return cachedActivities

  try {
    const since = new Date(Date.now() - ACTIVITIES_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    const fresh = await crmAdapter.getActivities(company.crm_id, since)

    await supabase
      .from('companies')
      .update({
        enrichment_data: {
          ...enrichmentData,
          activities: fresh,
          activities_cached_at: new Date().toISOString(),
        },
      })
      .eq('id', company.id)

    return fresh
  } catch (err) {
    console.warn(`[cron/score] activities fetch failed for company ${company.id}:`, err)
    return cachedActivities
  }
}
