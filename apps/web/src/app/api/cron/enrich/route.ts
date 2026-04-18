import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase } from '@/lib/cron-auth'
import {
  ApolloAdapter,
  ENRICHMENT_COSTS,
  addCost,
  canAfford,
  totalSpend,
  type EnrichmentOperation,
} from '@prospector/adapters'

/**
 * Per-tier enrichment depth. Replaces the old "every company gets the
 * same enrichCompany call" model that burned credit equally on Tier A
 * prospects and Tier D dead leads.
 *
 * Reasoning:
 *   - Tier A (HOT)  → full firmographic + tech stack + job postings.
 *                     The agent will ground deep outreach on this; the
 *                     extra ~$0.10 per account is justified.
 *   - Tier B (WARM) → firmographic + tech stack. Skip jobs (we'll fetch
 *                     them lazily if a `hiring_surge` signal is needed).
 *   - Tier C (COOL) → firmographic only. Cheap baseline so the account
 *                     ranks correctly when a future signal arrives.
 *   - Tier D / no tier / closed-lost → skip. Apollo credits are scarce;
 *                     the cron should not pay to enrich an account the
 *                     scoring engine has already deprioritised.
 *
 * `getJobs` is also tier-gated to keep the per-account cost down for B+.
 */
type EnrichmentDepth = {
  enrich: boolean
  fetchJobs: boolean
}

const DEPTH_BY_TIER: Record<string, EnrichmentDepth> = {
  HOT: { enrich: true, fetchJobs: true },
  WARM: { enrich: true, fetchJobs: false },
  COOL: { enrich: true, fetchJobs: false },
  MONITOR: { enrich: false, fetchJobs: false },
}

function depthFor(priorityTier: string | null, icpTier: string | null): EnrichmentDepth {
  // Priority tier wins (more recent / scored signal); fall back to ICP
  // tier; default to skip when both are null (a brand-new company hasn't
  // been scored yet — let the next score cycle promote it before we pay
  // for enrichment).
  if (priorityTier && DEPTH_BY_TIER[priorityTier]) return DEPTH_BY_TIER[priorityTier]
  if (icpTier === 'A') return DEPTH_BY_TIER.HOT
  if (icpTier === 'B') return DEPTH_BY_TIER.WARM
  if (icpTier === 'C') return DEPTH_BY_TIER.COOL
  return { enrich: false, fetchJobs: false }
}

/**
 * Should we reset this tenant's monthly spend ledger? Pre-this-change the
 * `enrichment_spend_current` column accumulated forever — month 2 the
 * budget was already exhausted from month 1 spend and the cron stopped
 * running entirely. We now reset when the last reset was > 30 days ago.
 *
 * Returns the new ledger state if a reset is due, otherwise null.
 */
function maybeResetMonthly(
  tenant: { enrichment_spend_reset_at: string | null; enrichment_spend_by_op: unknown },
): { spendByOp: Partial<Record<EnrichmentOperation, number>>; resetAt: string } | null {
  const lastReset = tenant.enrichment_spend_reset_at
    ? new Date(tenant.enrichment_spend_reset_at).getTime()
    : 0
  const ageMs = Date.now() - lastReset
  if (ageMs < 30 * 24 * 60 * 60 * 1000) return null
  return { spendByOp: {}, resetAt: new Date().toISOString() }
}

/**
 * Pre-enrichment ICP filter. Cheaply skip companies the scoring engine
 * already knows are obvious mismatches before we burn an Apollo credit
 * to confirm what we already know.
 *
 * Today this checks employee_count vs the tenant's ICP minimum. The hook
 * is deliberately conservative — false-skips here are reversible (next
 * cron will retry) but false-pays are not (we lose the credit).
 *
 * `icp_config.firmographics.employee_min` is the canonical key; tenants
 * who haven't configured ICP fall through and are enriched normally.
 */
function passesIcpPreFilter(
  company: { employee_count: number | null },
  icpConfig: { firmographics?: { employee_min?: number } } | null,
): boolean {
  const minEmployees = icpConfig?.firmographics?.employee_min
  if (typeof minEmployees !== 'number' || minEmployees <= 0) return true
  if (company.employee_count == null) return true
  return company.employee_count >= minEmployees * 0.5
}

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
      .select(
        'id, enrichment_budget_monthly, enrichment_spend_current, enrichment_spend_by_op, enrichment_spend_reset_at, business_config',
      )
      .eq('active', true)

    if (!tenants?.length) {
      return NextResponse.json({ message: 'No active tenants' })
    }

    const enrichedPerTenant = new Map<string, number>()
    const skippedNoBudget: string[] = []
    const skippedNoMatch = new Map<string, number>()

    for (const tenant of tenants) {
      // Apply monthly reset before reading any budget state, so a
      // tenant whose spend was capped on day 30 of the previous cycle
      // immediately gets full headroom on day 31.
      let spendByOp =
        ((tenant.enrichment_spend_by_op as
          | Partial<Record<EnrichmentOperation, number>>
          | null) ?? {}) as Partial<Record<EnrichmentOperation, number>>
      const reset = maybeResetMonthly(tenant)
      if (reset) {
        spendByOp = reset.spendByOp
        await supabase
          .from('tenants')
          .update({
            enrichment_spend_by_op: spendByOp,
            enrichment_spend_current: 0,
            enrichment_spend_reset_at: reset.resetAt,
          })
          .eq('id', tenant.id)
      }

      const monthlyBudget = tenant.enrichment_budget_monthly ?? 0
      const remaining = monthlyBudget - totalSpend(spendByOp)
      if (remaining <= 0) {
        skippedNoBudget.push(tenant.id)
        continue
      }

      // Pull ICP config once so the pre-filter has something to compare
      // employee_count against. Stored on `business_config` so existing
      // tenants without `icp_config` keep working (pre-filter no-ops).
      const businessConfig = (tenant.business_config as
        | { icp_config?: { firmographics?: { employee_min?: number } } }
        | null) ?? null
      const icpConfig = businessConfig?.icp_config ?? null

      // Eligible candidates: never enriched, OR stale + decent propensity,
      // AND not already marked as `no_match` (we burn no more credits on
      // domains Apollo confirmed it doesn't have). The partial index on
      // (tenant_id, propensity) added in migration 011 keeps this fast.
      const staleThreshold = new Date(Date.now() - 30 * 86400000).toISOString()

      const { data: neverEnriched } = await supabase
        .from('companies')
        .select(
          'id, domain, name, propensity, priority_tier, icp_tier, employee_count, enriched_at, last_signal_check, enrichment_status',
        )
        .eq('tenant_id', tenant.id)
        .is('enriched_at', null)
        .neq('enrichment_status', 'no_match')
        .order('propensity', { ascending: false, nullsFirst: false })
        .limit(50)

      const { data: staleCompanies } = await supabase
        .from('companies')
        .select(
          'id, domain, name, propensity, priority_tier, icp_tier, employee_count, enriched_at, last_signal_check, enrichment_status',
        )
        .eq('tenant_id', tenant.id)
        .not('enriched_at', 'is', null)
        .lt('enriched_at', staleThreshold)
        .gte('propensity', 50)
        .neq('enrichment_status', 'no_match')
        .order('propensity', { ascending: false })
        .limit(20)

      const allCandidates = [...(neverEnriched ?? []), ...(staleCompanies ?? [])]

      // Score by composite priority then drop tier-skipped + ICP-misfits
      // up front so the inner loop only iterates rows that will actually
      // be enriched. Saves one Apollo call per skipped row vs filtering
      // inside the loop.
      const queue = allCandidates
        .map((c) => {
          const depth = depthFor(c.priority_tier, c.icp_tier)
          return { ...c, _depth: depth }
        })
        .filter((c) => c._depth.enrich && c.domain && passesIcpPreFilter(c, icpConfig))
        .map((c) => {
          const daysSinceEnrichment = c.enriched_at
            ? (Date.now() - new Date(c.enriched_at).getTime()) / 86400000
            : 90
          const staleness = Math.min(daysSinceEnrichment / 30, 3)
          const signalFreshness = c.last_signal_check
            ? Math.max(
                0,
                1 -
                  (Date.now() - new Date(c.last_signal_check).getTime()) /
                    (14 * 86400000),
              )
            : 0
          const priority = staleness * (c.propensity ?? 1) * (1 + signalFreshness)
          return { ...c, _priority: priority }
        })
        .sort((a, b) => b._priority - a._priority)

      let tenantEnriched = 0
      let tenantNoMatch = 0

      for (const company of queue) {
        if (!company.domain) continue

        // Per-call budget check. Catches the case where a tenant's
        // budget is very tight (<$0.10) or where many no-match calls
        // earlier in the same run consumed the remainder.
        const budgetCheck = canAfford(spendByOp, monthlyBudget, 'company_enrich')
        if (!budgetCheck.allowed) {
          skippedNoBudget.push(tenant.id)
          break
        }

        try {
          const outcome = await apollo.enrichCompanyOutcome(company.domain)

          if (outcome.status === 'no_match') {
            // Mark so the next cycle never re-tries this domain.
            await supabase
              .from('companies')
              .update({
                enrichment_status: 'no_match',
                enrichment_source: 'apollo',
              })
              .eq('id', company.id)
            spendByOp = addCost(spendByOp, 'company_enrich')
            tenantNoMatch++
            continue
          }

          if (outcome.status === 'error') {
            await supabase.from('enrichment_jobs').insert({
              tenant_id: tenant.id,
              company_id: company.id,
              provider: 'apollo',
              job_type: 'company',
              status: 'failed',
              error: outcome.reason,
            })
            // Rate-limit and 5xx errors: stop the per-tenant run early
            // so we don't pile retry-after violations into an Apollo ban.
            if (outcome.reason.startsWith('rate_limited')) break
            continue
          }

          const enrichment = outcome.data
          const employeeCountChanged =
            company.employee_count != null &&
            enrichment.employee_count != null &&
            Math.abs(
              (enrichment.employee_count - company.employee_count) /
                Math.max(1, company.employee_count),
            ) > 0.2

          await supabase
            .from('companies')
            .update({
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
              enrichment_status: 'enriched',
              enrichment_data: enrichment.raw_data,
              last_employee_count: company.employee_count,
            })
            .eq('id', company.id)

          spendByOp = addCost(spendByOp, 'company_enrich')

          // Firmographic delta → signal feedback loop. A jump of >20%
          // in employee count between enrichment cycles is a hiring
          // signal worth scoring. The signals cron may also surface
          // this from job postings, but enrichment-driven detection is
          // free (we've already paid for the call) and catches
          // companies where Apollo job feed is sparse.
          if (employeeCountChanged && enrichment.employee_count != null) {
            const delta = enrichment.employee_count - (company.employee_count ?? 0)
            await supabase.from('signals').insert({
              tenant_id: tenant.id,
              company_id: company.id,
              signal_type: 'hiring_surge',
              title: `Headcount changed by ${delta > 0 ? '+' : ''}${delta} (${company.employee_count} → ${enrichment.employee_count})`,
              source: 'apollo_enrichment',
              relevance_score: Math.min(1, Math.abs(delta) / 100),
              weight_multiplier: 1.2,
              recency_days: 0,
              weighted_score: Math.min(1, Math.abs(delta) / 100) * 1.2,
              urgency: 'this_week',
              detected_at: new Date().toISOString(),
            })
          }

          // Tier-A only: pull job postings as part of the same cycle so
          // the agent has them on hand for the next outreach without a
          // round-trip to the signals cron. Tier B/C wait for the daily
          // signals cron.
          if (company._depth.fetchJobs) {
            const jobsBudget = canAfford(spendByOp, monthlyBudget, 'job_postings')
            if (jobsBudget.allowed) {
              try {
                await apollo.getJobPostings(company.domain)
                spendByOp = addCost(spendByOp, 'job_postings')
              } catch {
                // Jobs are optional; failure here doesn't fail the row.
              }
            }
          }

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

      // Persist the updated ledger once per tenant. `enrichment_spend_current`
      // is kept in sync as the legacy single number for back-compat with
      // any admin view that hasn't been migrated to the JSONB yet.
      if (tenantEnriched > 0 || tenantNoMatch > 0) {
        enrichedPerTenant.set(tenant.id, tenantEnriched)
        if (tenantNoMatch > 0) skippedNoMatch.set(tenant.id, tenantNoMatch)
        await supabase
          .from('tenants')
          .update({
            enrichment_spend_current: totalSpend(spendByOp),
            enrichment_spend_by_op: spendByOp,
          })
          .eq('id', tenant.id)
      }
    }

    const totalEnriched = [...enrichedPerTenant.values()].reduce(
      (a, b) => a + b,
      0,
    )
    const totalNoMatch = [...skippedNoMatch.values()].reduce((a, b) => a + b, 0)
    return NextResponse.json({
      enriched: totalEnriched,
      no_match: totalNoMatch,
      tenants_over_budget: skippedNoBudget.length,
      cost_map: ENRICHMENT_COSTS,
    })
  } catch (err) {
    console.error('[cron/enrich]', err)
    return NextResponse.json({ error: 'Enrichment failed' }, { status: 500 })
  }
}
