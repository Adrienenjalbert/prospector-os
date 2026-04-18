import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase, recordCronRun } from '@/lib/cron-auth'
import { SalesforceAdapter, HubSpotAdapter } from '@prospector/adapters'
import { decryptCredentials, isEncryptedString } from '@/lib/crypto'
import { emitOutcomeEvent, type OutcomeEventInput } from '@prospector/core'

/**
 * Compare a fresh CRM opportunity row against what we have in Postgres and
 * return the outcome events that should be emitted for the diff. We emit:
 *   - deal_stage_changed   when stage moved (any direction)
 *   - deal_amount_changed  when value moved by > 5% or > £1k
 *   - deal_closed_won      when is_won flipped true
 *   - deal_closed_lost     when is_closed went true and is_won stayed false
 *
 * These are the "labels" the attribution + ROI workflows correlate against
 * proactive pushes. Without them, /admin/roi runs on no signal.
 */
function diffOppForOutcomes(
  tenantId: string,
  oppCrmId: string | undefined,
  prev: { stage?: string | null; value?: number | null; is_won?: boolean | null; is_closed?: boolean | null } | null,
  next: { stage?: string | null; value?: number | null; is_won?: boolean | null; is_closed?: boolean | null },
  source: 'salesforce' | 'hubspot',
): OutcomeEventInput[] {
  if (!oppCrmId) return []
  const events: OutcomeEventInput[] = []
  const subjectUrn = `urn:rev:opportunity:${oppCrmId}`

  // Stage transition
  if (prev && (prev.stage ?? null) !== (next.stage ?? null)) {
    events.push({
      tenant_id: tenantId,
      subject_urn: subjectUrn,
      event_type: 'deal_stage_changed',
      source,
      payload: { from: prev.stage ?? null, to: next.stage ?? null },
    })
  }

  // Amount change beyond noise threshold
  const prevValue = Number(prev?.value ?? 0)
  const nextValue = Number(next.value ?? 0)
  const delta = Math.abs(nextValue - prevValue)
  const pct = prevValue > 0 ? delta / prevValue : 0
  if (prev && (delta > 1000 || pct > 0.05)) {
    events.push({
      tenant_id: tenantId,
      subject_urn: subjectUrn,
      event_type: 'deal_amount_changed',
      source,
      payload: { from: prevValue, to: nextValue },
      value_amount: nextValue,
    })
  }

  // Won transition
  if (next.is_won && !prev?.is_won) {
    events.push({
      tenant_id: tenantId,
      subject_urn: subjectUrn,
      event_type: 'deal_closed_won',
      source,
      payload: { stage: next.stage ?? null },
      value_amount: nextValue,
    })
  }

  // Lost transition
  if (next.is_closed && !next.is_won && !prev?.is_closed) {
    events.push({
      tenant_id: tenantId,
      subject_urn: subjectUrn,
      event_type: 'deal_closed_lost',
      source,
      payload: { stage: next.stage ?? null },
      value_amount: nextValue,
    })
  }

  return events
}

function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null
  try {
    const url = website.startsWith('http') ? website : `https://${website}`
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null
  }
}

function parseCreds(raw: unknown): Record<string, string> {
  if (!raw) return {}
  return isEncryptedString(raw)
    ? decryptCredentials(raw) as Record<string, string>
    : raw as Record<string, string>
}

/**
 * Phase 3.10 — sync account hierarchy.
 *
 * Two passes:
 *
 *   1. Capture: for each synced account, ask HubSpot for its parent
 *      (batched 100 at a time via getCompanyParentMap). Write the raw
 *      parent_crm_id back to companies. Captures the relationship even
 *      when the parent itself hasn't synced yet.
 *
 *   2. Resolve: for the tenant, walk every company with parent_crm_id
 *      set and resolve to canonical parent_company_id. Flag every row
 *      that's a parent (i.e. another row points to it) as
 *      is_account_family_root.
 *
 * Cost: one batched API call per ~100 synced accounts + a constant
 * number of Postgres updates per tenant. Cheap enough to run on every
 * sync without throttling.
 */
async function syncCompanyHierarchy(
  supabase: ReturnType<typeof getServiceSupabase>,
  tenantId: string,
  accounts: { crm_id?: string }[],
  hs: HubSpotAdapter,
): Promise<void> {
  const crmIds = accounts
    .map((a) => a.crm_id)
    .filter((id): id is string => Boolean(id))

  if (crmIds.length === 0) return

  // PASS 1: capture parent_crm_id from HubSpot
  const parentMap = await hs.getCompanyParentMap(crmIds)
  if (parentMap.size > 0) {
    for (const [childCrmId, parentCrmId] of parentMap.entries()) {
      await supabase
        .from('companies')
        .update({ parent_crm_id: parentCrmId })
        .eq('tenant_id', tenantId)
        .eq('crm_id', childCrmId)
    }
  }

  // PASS 2: resolve parent_crm_id → parent_company_id via Postgres
  // self-join. Use a single SQL UPDATE per tenant — set
  // parent_company_id where it's NULL but parent_crm_id matches another
  // tenant-scoped row's crm_id.
  await supabase.rpc('resolve_company_parents', { tenant_id_in: tenantId })
    .then(
      () => undefined,
      // RPC may not exist in tenants that haven't applied migration 008
      // yet — silently fall back to a per-row update path. This keeps
      // the sync working even before the migration is run on every env.
      async () => {
        const { data: orphans } = await supabase
          .from('companies')
          .select('id, parent_crm_id')
          .eq('tenant_id', tenantId)
          .is('parent_company_id', null)
          .not('parent_crm_id', 'is', null)
        for (const row of orphans ?? []) {
          if (!row.parent_crm_id) continue
          const { data: parent } = await supabase
            .from('companies')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('crm_id', row.parent_crm_id)
            .maybeSingle()
          if (parent) {
            await supabase
              .from('companies')
              .update({ parent_company_id: parent.id })
              .eq('id', row.id)
            await supabase
              .from('companies')
              .update({ is_account_family_root: true })
              .eq('id', parent.id)
          }
        }
      },
    )
}

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()

  const startTime = Date.now()

  try {
    const supabase = getServiceSupabase()

    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, crm_type, crm_credentials_encrypted')
      .eq('active', true)

    if (!tenants?.length) {
      return NextResponse.json({ message: 'No active tenants' })
    }

    let totalSynced = 0

    for (const tenant of tenants) {
      const creds = parseCreds(tenant.crm_credentials_encrypted)

      if (tenant.crm_type === 'salesforce' && creds.client_id) {
        totalSynced += await syncSalesforce(supabase, tenant.id, creds)
      } else if (tenant.crm_type === 'hubspot' && creds.private_app_token) {
        totalSynced += await syncHubSpot(supabase, tenant.id, creds)
      }
    }

    await recordCronRun('/api/cron/sync', 'success', Date.now() - startTime, totalSynced)
    return NextResponse.json({ synced: totalSynced })
  } catch (err) {
    console.error('[cron/sync]', err)
    await recordCronRun('/api/cron/sync', 'error', Date.now() - startTime, 0, err instanceof Error ? err.message : 'Unknown error')
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}

async function syncSalesforce(
  supabase: ReturnType<typeof getServiceSupabase>,
  tenantId: string,
  creds: Record<string, string>
): Promise<number> {
  const sf = new SalesforceAdapter({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    instance_url: creds.instance_url,
    refresh_token: creds.refresh_token,
  })

  let synced = 0
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const changes = await sf.getChangedRecords(since)

  if (changes.accounts.length > 0) {
    const accounts = await sf.getAccounts({ limit: 500 })
    for (const acc of accounts) {
      await supabase.from('companies').upsert({
        tenant_id: tenantId,
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
    synced += accounts.length
  }

  if (changes.opportunities.length > 0) {
    const opps = await sf.getOpportunities({})
    for (const opp of opps) {
      const accountCrmId = (opp as Record<string, unknown>).company_crm_id as string | undefined
      if (!accountCrmId) continue

      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('crm_id', accountCrmId)
        .single()

      if (!company) continue

      const { data: previousOpp } = await supabase
        .from('opportunities')
        .select('stage, value, is_won, is_closed')
        .eq('tenant_id', tenantId)
        .eq('crm_id', opp.crm_id)
        .maybeSingle()

      await supabase.from('opportunities').upsert({
        tenant_id: tenantId,
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
      synced++

      const events = diffOppForOutcomes(
        tenantId,
        opp.crm_id,
        previousOpp,
        {
          stage: opp.stage,
          value: opp.value as number | null,
          is_won: opp.is_won,
          is_closed: opp.is_closed,
        },
        'salesforce',
      )
      for (const e of events) {
        await emitOutcomeEvent(supabase, e)
      }
    }
  }

  // Sync contacts for companies that have been updated
  if (changes.accounts.length > 0) {
    const { data: companies } = await supabase
      .from('companies')
      .select('id, crm_id')
      .eq('tenant_id', tenantId)
      .not('crm_id', 'is', null)
      .limit(100)

    for (const company of companies ?? []) {
      try {
        const contacts = await sf.getContacts(company.crm_id)
        for (const contact of contacts) {
          await supabase.from('contacts').upsert({
            tenant_id: tenantId,
            company_id: company.id,
            crm_id: contact.crm_id,
            first_name: contact.first_name,
            last_name: contact.last_name,
            title: contact.title,
            email: contact.email,
            phone: contact.phone,
            seniority: contact.seniority,
            last_crm_sync: new Date().toISOString(),
          }, { onConflict: 'tenant_id,crm_id' })
          synced++
        }
      } catch {
        // Some companies may not have contacts accessible
      }
    }
  }

  return synced
}

async function syncHubSpot(
  supabase: ReturnType<typeof getServiceSupabase>,
  tenantId: string,
  creds: Record<string, string>
): Promise<number> {
  const hs = new HubSpotAdapter(creds)

  let synced = 0

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const accounts = await hs.getAccounts({ updated_since: since, limit: 500 })
  for (const acc of accounts) {
    await supabase.from('companies').upsert({
      tenant_id: tenantId,
      crm_id: acc.crm_id,
      crm_source: 'hubspot',
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
  synced += accounts.length

  // Phase 3.10: account hierarchy. After upserting the synced accounts,
  // fetch parent associations from HubSpot and resolve them into the
  // canonical parent_company_id. Two passes:
  //   1. Write parent_crm_id on every synced company that has a parent
  //      in HubSpot (the raw HubSpot id is always available).
  //   2. Resolve parent_crm_id → parent_company_id via a Postgres self-
  //      join + flag the resolved parents as is_account_family_root.
  //
  // The two-pass approach handles the case where the parent itself
  // hasn't been synced yet: parent_crm_id sticks around for the next
  // sync run to resolve. A child whose parent eventually arrives in
  // HubSpot resolves on the FIRST sync after the parent appears.
  await syncCompanyHierarchy(supabase, tenantId, accounts, hs)

  const opps = await hs.getOpportunities({})
  for (const opp of opps) {
    const accountCrmId = (opp as Record<string, unknown>).company_crm_id as string | undefined
    if (!accountCrmId) continue

    const { data: company } = await supabase
      .from('companies')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('crm_id', accountCrmId)
      .single()

    if (!company) continue

    const { data: previousOpp } = await supabase
      .from('opportunities')
      .select('stage, value, is_won, is_closed')
      .eq('tenant_id', tenantId)
      .eq('crm_id', opp.crm_id)
      .maybeSingle()

    await supabase.from('opportunities').upsert({
      tenant_id: tenantId,
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
      owner_crm_id: opp.owner_crm_id,
      last_crm_sync: new Date().toISOString(),
    }, { onConflict: 'tenant_id,crm_id' })
    synced++

    const events = diffOppForOutcomes(
      tenantId,
      opp.crm_id,
      previousOpp,
      {
        stage: opp.stage,
        value: opp.value as number | null,
        is_won: opp.is_won,
        is_closed: opp.is_closed,
      },
      'hubspot',
    )
    for (const e of events) {
      await emitOutcomeEvent(supabase, e)
    }
  }

  // Sync contacts
  const { data: companies } = await supabase
    .from('companies')
    .select('id, crm_id')
    .eq('tenant_id', tenantId)
    .not('crm_id', 'is', null)
    .limit(100)

  for (const company of companies ?? []) {
    try {
      const contacts = await hs.getContacts(company.crm_id)
      for (const contact of contacts) {
        await supabase.from('contacts').upsert({
          tenant_id: tenantId,
          company_id: company.id,
          crm_id: contact.crm_id,
          first_name: contact.first_name,
          last_name: contact.last_name,
          title: contact.title,
          email: contact.email,
          phone: contact.phone,
          seniority: contact.seniority,
          last_crm_sync: new Date().toISOString(),
        }, { onConflict: 'tenant_id,crm_id' })
        synced++
      }
    } catch {
      // Some companies may not have contacts accessible
    }
  }

  return synced
}
