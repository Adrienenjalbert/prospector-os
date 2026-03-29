import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase, recordCronRun } from '@/lib/cron-auth'
import { SalesforceAdapter } from '@prospector/adapters'
import { decryptCredentials, isEncryptedString } from '@/lib/crypto'

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()

  const startTime = Date.now()

  try {
    const supabase = getServiceSupabase()

    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, icp_config, scoring_config, signal_config, crm_type, crm_credentials_encrypted, business_config')
      .eq('active', true)

    if (!tenants?.length) {
      return NextResponse.json({ message: 'No active tenants' })
    }

    const { computeCompositeScore } = await import('@prospector/core')
    let totalScored = 0

    for (const tenant of tenants) {
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

      for (const company of companies) {
        const [contactsRes, signalsRes, oppsRes] = await Promise.all([
          supabase.from('contacts').select('*').eq('company_id', company.id),
          supabase.from('signals').select('*').eq('company_id', company.id),
          supabase.from('opportunities').select('*').eq('company_id', company.id),
        ])

        const result = computeCompositeScore(
          {
            company,
            contacts: contactsRes.data ?? [],
            signals: signalsRes.data ?? [],
            opportunities: oppsRes.data ?? [],
            activities: [], // TODO: sync CRM activities to Supabase for engagement scoring
            benchmarks: tenantBenchmarks,
            previousSignalScore: company.signal_score ?? null,
            companyWinRate,
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

      const bizConfig = (tenant.business_config as Record<string, unknown> | null) ?? {}
      const writebackEnabled = bizConfig.crm_writeback_enabled === true

      if (writebackEnabled && tenant.crm_type === 'salesforce' && tenant.crm_credentials_encrypted) {
        try {
          const raw = tenant.crm_credentials_encrypted
          const creds = isEncryptedString(raw)
            ? decryptCredentials(raw) as Record<string, string>
            : raw as Record<string, string>

          if (creds.client_id) {
            const sf = new SalesforceAdapter({
              client_id: creds.client_id,
              client_secret: creds.client_secret,
              instance_url: creds.instance_url,
              refresh_token: creds.refresh_token,
            })

            for (const company of companies) {
              if (!company.crm_id) continue
              try {
                await sf.updateAccountScores(company.crm_id, {
                  icp_score: company.icp_score,
                  icp_tier: company.icp_tier,
                  signal_score: company.signal_score,
                  engagement_score: company.engagement_score,
                  propensity: company.propensity,
                  expected_revenue: company.expected_revenue,
                  priority_tier: company.priority_tier,
                  priority_reason: company.priority_reason,
                })
              } catch (writeErr) {
                console.error(`[cron/score] CRM write-back failed for ${company.crm_id}:`, writeErr)
              }
            }
          }
        } catch (crmErr) {
          console.error('[cron/score] CRM adapter init failed:', crmErr)
        }
      }
    }

    await recordCronRun('/api/cron/score', 'success', Date.now() - startTime, totalScored)
    return NextResponse.json({ scored: totalScored })
  } catch (err) {
    console.error('[cron/score]', err)
    await recordCronRun('/api/cron/score', 'error', Date.now() - startTime, 0, err instanceof Error ? err.message : 'Unknown error')
    return NextResponse.json({ error: 'Scoring failed' }, { status: 500 })
  }
}
