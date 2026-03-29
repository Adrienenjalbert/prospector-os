import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase } from '@/lib/cron-auth'
import { SalesforceAdapter } from '@prospector/adapters'
import { decryptCredentials, isEncryptedString } from '@/lib/crypto'

function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null
  try {
    const url = website.startsWith('http') ? website : `https://${website}`
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null
  }
}

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()

  try {
    const supabase = getServiceSupabase()

    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, crm_type, crm_credentials_encrypted')
      .eq('active', true)
      .eq('crm_type', 'salesforce')

    if (!tenants?.length) {
      return NextResponse.json({ message: 'No Salesforce tenants' })
    }

    let totalSynced = 0

    for (const tenant of tenants) {
      const raw = tenant.crm_credentials_encrypted
      if (!raw) continue

      const creds = isEncryptedString(raw)
        ? decryptCredentials(raw) as Record<string, string>
        : raw as Record<string, string>

      if (!creds.client_id) continue

      const sf = new SalesforceAdapter({
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        instance_url: creds.instance_url,
        refresh_token: creds.refresh_token,
      })

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const changes = await sf.getChangedRecords(since)

      if (changes.accounts.length > 0) {
        const accounts = await sf.getAccounts({ limit: 500 })
        for (const acc of accounts) {
          await supabase.from('companies').upsert({
            tenant_id: tenant.id,
            crm_id: acc.crm_id,
            crm_source: 'salesforce',
            name: acc.name,
            domain: extractDomain(acc.website as string | null),
            website: acc.website as string | null,
            industry: acc.industry,
            employee_count: acc.employee_count,
            annual_revenue: acc.annual_revenue,
            hq_city: acc.hq_city,
            hq_country: acc.hq_country,
            owner_crm_id: acc.owner_crm_id,
            owner_name: acc.owner_name,
            last_crm_sync: new Date().toISOString(),
          }, { onConflict: 'tenant_id,crm_id' })
        }
        totalSynced += accounts.length
      }

      if (changes.opportunities.length > 0) {
        const opps = await sf.getOpportunities({})
        for (const opp of opps) {
          const accountCrmId = (opp as Record<string, unknown>).company_crm_id as string | undefined
          if (!accountCrmId) continue

          const { data: company } = await supabase
            .from('companies')
            .select('id')
            .eq('tenant_id', tenant.id)
            .eq('crm_id', accountCrmId)
            .single()

          if (company) {
            await supabase.from('opportunities').upsert({
              tenant_id: tenant.id,
              crm_id: opp.crm_id,
              company_id: company.id,
              name: opp.name,
              value: opp.value,
              stage: opp.stage,
              probability: opp.probability,
              days_in_stage: opp.days_in_stage,
              is_stalled: opp.is_stalled,
              is_closed: opp.is_closed,
              is_won: opp.is_won,
              closed_at: (opp as Record<string, unknown>).closed_at as string | null,
              lost_reason: (opp as Record<string, unknown>).lost_reason as string | null,
              owner_crm_id: opp.owner_crm_id,
              last_crm_sync: new Date().toISOString(),
            }, { onConflict: 'tenant_id,crm_id' })
          }
        }
      }
    }

    return NextResponse.json({ synced: totalSynced })
  } catch (err) {
    console.error('[cron/sync]', err)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
