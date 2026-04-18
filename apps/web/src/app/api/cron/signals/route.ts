import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase, recordCronRun } from '@/lib/cron-auth'
import {
  ApolloAdapter,
  SalesforceAdapter,
  totalSpend,
  type EnrichmentOperation,
} from '@prospector/adapters'
import { decryptCredentials, isEncryptedString } from '@/lib/crypto'

const DEEP_RESEARCH_PROMPT = `You are a B2B sales intelligence analyst. Research the company "{company_name}" ({domain}) for recent developments relevant to temporary staffing needs.

Find information from the last 6 months on:
1. Hiring activity — especially temporary, flexible, or agency roles
2. Funding rounds or financial events
3. Leadership changes — especially in Operations, HR, Facilities
4. Expansion — new offices, facilities, markets
5. Staffing challenges mentioned in news or reviews
6. Competitor staffing provider mentions

Return ONLY a JSON array of signals:
[
  {
    "type": "hiring_surge|funding|leadership_change|expansion|temp_job_posting|competitor_mention|seasonal_peak|negative_news",
    "title": "Brief title",
    "description": "2-3 sentence description with specifics",
    "relevance": 0.0-1.0,
    "urgency": "immediate|this_week|this_month",
    "recommended_action": "Specific action for the sales rep"
  }
]

Return empty array [] if no relevant signals found.`

type ClaudeSignal = {
  type: string
  title: string
  description?: string
  relevance: number
  urgency: string
  recommended_action?: string
}

async function runDeepResearch(
  companyName: string,
  domain: string,
  config: { model: string; temperature: number; max_tokens: number }
): Promise<ClaudeSignal[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return []

  try {
    const prompt = DEEP_RESEARCH_PROMPT
      .replace('{company_name}', companyName)
      .replace('{domain}', domain)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model ?? 'claude-sonnet-4-20250514',
        max_tokens: config.max_tokens ?? 3000,
        temperature: config.temperature ?? 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      console.error('[cron/signals] Claude API error:', res.status)
      return []
    }

    const data = await res.json()
    const text = data.content?.[0]?.text ?? ''

    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return []

    return parsed as ClaudeSignal[]
  } catch (err) {
    console.error('[cron/signals] Deep research failed for', companyName, err)
    return []
  }
}

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()

  const startTime = Date.now()

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
        'id, signal_config, crm_type, crm_credentials_encrypted, business_config, enrichment_budget_monthly, enrichment_spend_by_op',
      )
      .eq('active', true)

    if (!tenants?.length) {
      return NextResponse.json({ message: 'No active tenants' })
    }

    let totalSignals = 0
    const tenantsOverBudget: string[] = []

    for (const tenant of tenants) {
      // Apollo budget guard. The signals cron uses Apollo
      // `getJobPostings` (which costs ~$0.05/call), but pre-this-change
      // it bypassed the per-tenant enrichment budget entirely — a
      // tenant with $0 left for the month still saw signal cron
      // running Apollo against their domains. Now we read the same
      // ledger the enrichment cron writes to, and skip the tenant
      // when over budget.
      const monthlyBudget = (tenant.enrichment_budget_monthly as number | null) ?? 0
      const spendByOp =
        ((tenant.enrichment_spend_by_op as
          | Partial<Record<EnrichmentOperation, number>>
          | null) ?? {}) as Partial<Record<EnrichmentOperation, number>>
      const remaining = monthlyBudget - totalSpend(spendByOp)
      if (remaining <= 0) {
        tenantsOverBudget.push(tenant.id)
        continue
      }

      const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      const { data: companies } = await supabase
        .from('companies')
        .select('id, domain, name, icp_tier')
        .eq('tenant_id', tenant.id)
        .in('icp_tier', ['A', 'B'])
        .or(`last_signal_check.is.null,last_signal_check.lt.${staleThreshold}`)
        .limit(100)

      if (!companies?.length) continue

      const signalConfig = tenant.signal_config as {
        signal_types?: { name: string; weight_multiplier: number; flex_keywords?: string[] }[]
        deep_research_config?: { model: string; temperature: number; max_tokens: number; only_for_tiers: string[] }
      } | null
      const signalTypes = signalConfig?.signal_types ?? []
      const deepResearchConfig = signalConfig?.deep_research_config
      let deepResearchCount = 0
      const maxDeepResearch = 20

      // Per-tenant role-type keywords drive `is_temp_flex` flagging in
      // job postings. Tenants in staffing / contingent verticals configure
      // ['temp', 'contract', 'shift', 'locum', ...] on their
      // `temp_job_posting` signal type. Tenants in other verticals leave
      // it empty — no false-positive `temp_job_posting` signals fire.
      const flexKeywords =
        signalTypes.find((t) => t.name === 'temp_job_posting')?.flex_keywords ?? []

      // Dedup window: a signal of the same type for the same company that
      // landed in the last 7 days is treated as the SAME signal (just
      // refreshed). Pre-this-change every cron run inserted a new
      // `hiring_surge` row, so a company with persistent open jobs piled
      // up dozens of duplicate signals — bloating the inbox, double-
      // counting in `weighted_score` averages, and making the rep see
      // the same recommendation 5 times in a week.
      const dedupSinceMs = 7 * 24 * 60 * 60 * 1000
      const dedupSince = new Date(Date.now() - dedupSinceMs).toISOString()
      const insertSignalIfNew = async (row: {
        tenant_id: string
        company_id: string
        signal_type: string
        title: string
        source: string
        relevance_score: number
        weight_multiplier: number
        recency_days: number
        weighted_score: number
        urgency: string
        detected_at: string
        description?: string | null
        recommended_action?: string | null
      }): Promise<boolean> => {
        const { count } = await supabase
          .from('signals')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', row.tenant_id)
          .eq('company_id', row.company_id)
          .eq('signal_type', row.signal_type)
          .gte('detected_at', dedupSince)
        if ((count ?? 0) > 0) return false
        await supabase.from('signals').insert(row)
        return true
      }

      for (const company of companies) {
        if (!company.domain) continue

        try {
          const postings = await apollo.getJobPostings(company.domain, flexKeywords)
          const tempPostings = postings.filter((p) => p.is_temp_flex)

          if (tempPostings.length > 0) {
            const typeConfig = signalTypes.find((t) => t.name === 'temp_job_posting')
            const inserted = await insertSignalIfNew({
              tenant_id: tenant.id,
              company_id: company.id,
              signal_type: 'temp_job_posting',
              title: `${tempPostings.length} temp/flex roles posted`,
              source: 'apollo',
              relevance_score: Math.min(1, tempPostings.length / 10),
              weight_multiplier: typeConfig?.weight_multiplier ?? 1.8,
              recency_days: 0,
              weighted_score: Math.min(1, tempPostings.length / 10) * (typeConfig?.weight_multiplier ?? 1.8),
              urgency: tempPostings.length >= 5 ? 'immediate' : 'this_week',
              detected_at: new Date().toISOString(),
            })
            if (inserted) totalSignals++
          }

          if (postings.length >= 10) {
            const typeConfig = signalTypes.find((t) => t.name === 'hiring_surge')
            const inserted = await insertSignalIfNew({
              tenant_id: tenant.id,
              company_id: company.id,
              signal_type: 'hiring_surge',
              title: `${postings.length} total job postings detected`,
              source: 'apollo',
              relevance_score: Math.min(1, postings.length / 20),
              weight_multiplier: typeConfig?.weight_multiplier ?? 1.2,
              recency_days: 0,
              weighted_score: Math.min(1, postings.length / 20) * (typeConfig?.weight_multiplier ?? 1.2),
              urgency: 'this_week',
              detected_at: new Date().toISOString(),
            })
            if (inserted) totalSignals++
          }

          const researchGated = deepResearchConfig
          ? await shouldRunDeepResearch(supabase, tenant.id, company.icp_tier, company.name)
          : false

        if (
            company.icp_tier === 'A' &&
            deepResearchConfig &&
            deepResearchCount < maxDeepResearch &&
            (deepResearchConfig.only_for_tiers ?? []).includes('A') &&
            researchGated
          ) {
            deepResearchCount++
            const claudeSignals = await runDeepResearch(
              company.name,
              company.domain,
              deepResearchConfig
            )

            for (const sig of claudeSignals) {
              if (sig.relevance < 0.5) continue

              const typeConfig = signalTypes.find((t) => t.name === sig.type)
              const weight = typeConfig?.weight_multiplier ?? 1.0

              const inserted = await insertSignalIfNew({
                tenant_id: tenant.id,
                company_id: company.id,
                signal_type: sig.type,
                title: sig.title,
                description: sig.description ?? null,
                source: 'claude_research',
                relevance_score: sig.relevance,
                weight_multiplier: weight,
                recency_days: 0,
                weighted_score: sig.relevance * weight,
                urgency: sig.urgency || 'this_month',
                recommended_action: sig.recommended_action ?? null,
                detected_at: new Date().toISOString(),
              })
              if (inserted) totalSignals++
            }
          }

          await supabase.from('companies').update({
            last_signal_check: new Date().toISOString(),
          }).eq('id', company.id)
        } catch (err) {
          // Skip company on Apollo / Claude / Postgres failure, continue
          // with next. Log per-company so a partial outage doesn't go
          // silent — without this, an Apollo 5xx that affected 30% of
          // companies showed up as "fewer signals than usual" with no
          // breadcrumb to grep.
          const message = err instanceof Error ? err.message : String(err)
          console.warn(
            `[cron/signals] tenant=${tenant.id} company=${company.id} skipped: ${message}`,
          )
        }
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

            const { data: newSignals } = await supabase
              .from('signals')
              .select('id, company_id, signal_type, title, description, source_url, relevance_score, weighted_score, recommended_action, urgency, detected_at')
              .eq('tenant_id', tenant.id)
              .gte('detected_at', staleThreshold)

            for (const sig of newSignals ?? []) {
              const { data: comp } = await supabase
                .from('companies')
                .select('crm_id')
                .eq('id', sig.company_id)
                .single()
              if (!comp?.crm_id) continue

              try {
                await sf.createSignalRecord({
                  ...sig,
                  company_id: comp.crm_id,
                })
              } catch (writeErr) {
                console.error(`[cron/signals] CRM signal write-back failed:`, writeErr)
              }
            }
          }
        } catch (crmErr) {
          console.error('[cron/signals] CRM adapter init failed:', crmErr)
        }
      }
    }

    await recordCronRun('/api/cron/signals', 'success', Date.now() - startTime, totalSignals)
    return NextResponse.json({
      signals: totalSignals,
      tenants_over_budget: tenantsOverBudget.length,
    })
  } catch (err) {
    console.error('[cron/signals]', err)
    await recordCronRun('/api/cron/signals', 'error', Date.now() - startTime, 0, err instanceof Error ? err.message : 'Unknown error')
    return NextResponse.json({ error: 'Signal detection failed' }, { status: 500 })
  }
}

async function shouldRunDeepResearch(
  supabase: ReturnType<typeof getServiceSupabase>,
  tenantId: string,
  icpTier: string | null,
  _companyName: string
): Promise<boolean> {
  if (icpTier !== 'A') return false

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString()

  const { data: roiData } = await supabase
    .from('signals')
    .select('id, led_to_action, led_to_deal_progress, source')
    .eq('tenant_id', tenantId)
    .eq('source', 'claude_research')
    .gte('detected_at', ninetyDaysAgo)

  if (!roiData?.length || roiData.length < 10) return true

  const actioned = roiData.filter((s) => s.led_to_action || s.led_to_deal_progress).length
  const conversionRate = actioned / roiData.length

  if (conversionRate < 0.05) {
    // Operational decision (skip an expensive Claude deep-research
    // call for this tenant). Use `console.warn` so it shows up in the
    // Vercel function logs filter alongside other ops-visible
    // breadcrumbs — `console.log` was being filtered out at the
    // platform level and the skip became invisible.
    console.warn(
      `[cron/signals] Skipping deep research — ROI too low ` +
      `(${(conversionRate * 100).toFixed(1)}% conversion, ${roiData.length} samples)`
    )
    return false
  }

  return true
}
