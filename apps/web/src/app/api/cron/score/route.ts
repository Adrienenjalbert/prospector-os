import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase, recordCronRun } from '@/lib/cron-auth'
import { resolveCredentials } from '@/lib/crypto'
import { HubSpotAdapter, SalesforceAdapter } from '@prospector/adapters'
import { emitAgentEvent, type CRMActivity } from '@prospector/core'

const ACTIVITIES_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const ACTIVITIES_LOOKBACK_DAYS = 30

type CRMAdapterLike = {
  getActivities: (accountId: string, since: Date) => Promise<CRMActivity[]>
}

/**
 * Local wrapper around `resolveCredentials` that returns an empty
 * record (vs. throwing) for tenants whose creds are missing/legacy/
 * corrupt — the score cron uses that shape to drive `buildCrmAdapter`,
 * which returns null and the engagement scorer falls back to
 * activity-table reads only. So one bad tenant skips CRM-derived
 * activities for that run; next nightly picks up after the operator
 * runs the migration.
 *
 * Strict-mode resolveCredentials is the single decrypt path; this
 * wrapper just isolates failures per tenant for the cron's
 * keep-going-on-error contract.
 */
function parseCreds(
  tenantId: string,
  raw: unknown,
): Record<string, string> {
  try {
    return resolveCredentials(raw)
  } catch (err) {
    console.warn(
      `[cron/score] tenant ${tenantId} CRM activities skipped — credentials unusable:`,
      err instanceof Error ? err.message : err,
    )
    return {}
  }
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
    const tenantErrors: { tenant_id: string; error: string }[] = []

    for (const tenant of tenants) {
      // Per-tenant try/catch — one tenant's bad config / bad data must
      // never block scoring for the rest of the fleet. Without this,
      // a single Salesforce org with rotated credentials could leave
      // every other tenant unscored until ops noticed.
      const tenantStart = Date.now()
      let tenantScored = 0
      let tenantBenchmarksLocal = 0

      try {
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
      if (!companies?.length) {
        // Closes this iteration's try/catch + telemetry block.
        await emitTenantScoringEvent(supabase, tenant.id, {
          companies_scored: 0,
          benchmarks_written: 0,
          duration_ms: Date.now() - tenantStart,
          status: 'no_companies',
        })
        continue
      }

      const tenantBenchmarks = benchmarksRes.data ?? []
      const wonCount = wonRes.count ?? 0
      const closedCount = closedRes.count ?? 0
      const companyWinRate = closedCount > 0 ? (wonCount / closedCount) * 100 : 15

      const tenantCreds = parseCreds(tenant.id, tenant.crm_credentials_encrypted)
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

      // Pass the tenant's actual active-stage count from funnel_config
      // so the velocity scorer's stage_progress denominator matches the
      // tenant's real funnel (not a hardcoded 4-stage AE shape).
      const funnelConfigForScoring = tenant.funnel_config as {
        stages?: { name: string; stage_type: string }[]
      } | null
      const activeStageCount = (funnelConfigForScoring?.stages ?? []).filter(
        (s) => !['closed_won', 'closed_lost'].includes(s.stage_type),
      ).length || 4

      // Pull tenant-wide closed-deal history once so the win-rate sub-
      // scorer can blend across the tenant's full sample (not just this
      // company's own closed opps). Drives the `profile_match` Bayesian
      // blend in `composite-scorer.ts`.
      const lookbackMonths =
        (tenant.scoring_config as { profile_match?: { lookback_months?: number } } | null)
          ?.profile_match?.lookback_months ?? 24
      const lookbackSince = new Date(
        Date.now() - lookbackMonths * 30 * 24 * 60 * 60 * 1000,
      ).toISOString()
      const { data: historicalDealsData } = await supabase
        .from('opportunities')
        .select('company_id, is_won, value, closed_at')
        .eq('tenant_id', tenant.id)
        .eq('is_closed', true)
        .gte('closed_at', lookbackSince)

      // Map deal → company industry/size/market for similarity matching.
      const histCompanyIds = [
        ...new Set(
          (historicalDealsData ?? []).map((d) => d.company_id).filter(Boolean),
        ),
      ] as string[]
      const { data: histCompaniesData } = histCompanyIds.length
        ? await supabase
            .from('companies')
            .select('id, industry_group, employee_range, hq_country')
            .in('id', histCompanyIds)
        : { data: [] as Array<{ id: string; industry_group: string | null; employee_range: string | null; hq_country: string | null }> }
      const histCompanyMap = new Map(
        (histCompaniesData ?? []).map((c) => [c.id, c] as const),
      )
      const historicalDeals = (historicalDealsData ?? []).flatMap((d) => {
        if (!d.company_id) return []
        const c = histCompanyMap.get(d.company_id)
        return [{
          industry_group: c?.industry_group ?? null,
          employee_range: c?.employee_range ?? null,
          market: c?.hq_country ?? null,
          is_won: d.is_won === true,
        }]
      })

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
            historicalDeals,
            tenantMedianActivities30d,
          },
          {
            icpConfig: tenant.icp_config,
            scoringConfig: tenant.scoring_config,
            signalConfig: tenant.signal_config,
            activeStageCount,
          }
        )

        // Resolve the deal-value the composite scorer used, so we can
        // persist it on the snapshot honestly. Previously the snapshot
        // stored `expected_revenue` in BOTH `deal_value` and
        // `expected_revenue` columns — the calibration analyser then
        // saw a deal_value that scaled with propensity, which is
        // backwards.
        const topOpp = (oppsRes.data ?? []).find((o) => !o.is_closed)
        const snapshotDealValue = result.expected_revenue > 0 && result.propensity > 0
          ? Math.round(result.expected_revenue / (result.propensity / 100))
          : Number(topOpp?.value ?? 0)

        const { error: updateErr } = await supabase.from('companies').update({
          icp_score: result.icp_score,
          icp_tier: result.icp_tier,
          // Persist the rich per-dimension breakdown the ICP scorer
          // already computes — without this the explain_score tool +
          // /admin/adaptation page have no way to show "why this ICP
          // tier" beyond the single top_reason string.
          icp_dimensions: result.icp_dimensions ?? null,
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
          // Honest staleness signal — UI / agent / workflows can now
          // tell a "scored 30 minutes ago" company from a "scored 5
          // days ago" one.
          last_scored_at: new Date().toISOString(),
        }).eq('id', company.id)

        if (updateErr) {
          console.warn(`[cron/score] company update failed (${company.id}):`, updateErr.message)
          continue
        }

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
          deal_value: snapshotDealValue,
          expected_revenue: result.expected_revenue,
          snapshot_trigger: 'weekly',
          config_version: (tenant.scoring_config as { version?: string } | null)?.version ?? '3.0',
        })

        tenantScored++
        totalScored++
      }

      // --- Phase 2: Compute funnel benchmarks ---
      const stages = (funnelConfigForScoring?.stages ?? [])
        .filter(s => !['closed_won', 'closed_lost'].includes(s.stage_type))
        .map(s => s.name)

      if (stages.length === 0) {
        await emitTenantScoringEvent(supabase, tenant.id, {
          companies_scored: tenantScored,
          benchmarks_written: tenantBenchmarksLocal,
          duration_ms: Date.now() - tenantStart,
          status: 'no_active_stages',
        })
        continue
      }

      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      const { data: allOpps } = await supabase
        .from('opportunities')
        .select('*')
        .eq('tenant_id', tenant.id)
        .gte('created_at', ninetyDaysAgo)

      if (!allOpps?.length) {
        await emitTenantScoringEvent(supabase, tenant.id, {
          companies_scored: tenantScored,
          benchmarks_written: tenantBenchmarksLocal,
          duration_ms: Date.now() - tenantStart,
          status: 'no_recent_opps',
        })
        continue
      }

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
        tenantBenchmarksLocal++
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
          tenantBenchmarksLocal++
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

      await emitTenantScoringEvent(supabase, tenant.id, {
        companies_scored: tenantScored,
        benchmarks_written: tenantBenchmarksLocal,
        duration_ms: Date.now() - tenantStart,
        status: 'success',
      })
      } catch (tenantErr) {
        const message = tenantErr instanceof Error ? tenantErr.message : 'Unknown error'
        console.error(`[cron/score] tenant ${tenant.id} failed:`, message)
        tenantErrors.push({ tenant_id: tenant.id, error: message })
        await emitTenantScoringEvent(supabase, tenant.id, {
          companies_scored: tenantScored,
          benchmarks_written: tenantBenchmarksLocal,
          duration_ms: Date.now() - tenantStart,
          status: 'error',
          error: message,
        })
      }
    }

    await recordCronRun(
      '/api/cron/score',
      tenantErrors.length === 0 ? 'success' : tenantErrors.length === tenants.length ? 'error' : 'partial',
      Date.now() - startTime,
      totalScored + totalBenchmarks,
      tenantErrors.length > 0 ? `${tenantErrors.length}/${tenants.length} tenants failed` : undefined,
    )
    return NextResponse.json({
      scored: totalScored,
      benchmarks: totalBenchmarks,
      tenants_total: tenants.length,
      tenants_failed: tenantErrors.length,
      errors: tenantErrors,
    })
  } catch (err) {
    console.error('[cron/score]', err)
    await recordCronRun('/api/cron/score', 'error', Date.now() - startTime, 0, err instanceof Error ? err.message : 'Unknown error')
    return NextResponse.json({ error: 'Scoring failed' }, { status: 500 })
  }
}

/**
 * Emit a per-tenant scoring telemetry event so /admin/adaptation and the
 * self-improve workflow can detect tenants whose scoring is consistently
 * failing or stalling. Without this, a tenant whose nightly scoring has
 * been throwing for a week is invisible to operators.
 */
async function emitTenantScoringEvent(
  supabase: ReturnType<typeof getServiceSupabase>,
  tenantId: string,
  payload: {
    companies_scored: number
    benchmarks_written: number
    duration_ms: number
    status: 'success' | 'error' | 'no_companies' | 'no_recent_opps' | 'no_active_stages'
    error?: string
  },
): Promise<void> {
  await emitAgentEvent(supabase, {
    tenant_id: tenantId,
    event_type: 'scoring_run_completed',
    payload,
  })
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
