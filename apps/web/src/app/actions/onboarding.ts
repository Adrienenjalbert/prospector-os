'use server'

import { headers } from 'next/headers'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/cron-auth'
import { encryptCredentials } from '@/lib/crypto'
import {
  buildIcpProposal,
  buildFunnelProposal,
  type IcpConfig,
  type IcpProposal,
  type FunnelConfig,
  type FunnelProposal,
} from '@/lib/onboarding/proposals'

export type SaveCrmCredentialsInput = {
  crm_type?: 'hubspot' | 'salesforce'
  private_app_token?: string
  client_id?: string
  client_secret?: string
  instance_url?: string
}

export async function saveCrmCredentials(input: SaveCrmCredentialsInput) {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('Unauthorized')
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id) {
    throw new Error('No tenant')
  }

  const admin = getServiceSupabase()

  const crmType = input.crm_type ?? 'salesforce'
  const rawCreds = crmType === 'hubspot'
    ? { private_app_token: input.private_app_token }
    : { client_id: input.client_id, client_secret: input.client_secret, instance_url: input.instance_url }

  const hasEncryptionKey = !!process.env.CREDENTIALS_ENCRYPTION_KEY
  const credentialPayload = hasEncryptionKey
    ? encryptCredentials(rawCreds)
    : rawCreds

  const { error } = await admin
    .from('tenants')
    .update({
      crm_type: crmType,
      crm_credentials_encrypted: credentialPayload,
    })
    .eq('id', profile.tenant_id)

  if (error) {
    console.error('[onboarding] saveCrmCredentials', error)
    throw new Error(error.message)
  }
}

export async function runCrmSyncFromOnboarding() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const cronSecret = process.env.CRON_SECRET
  const url = `${proto}://${host}/api/cron/sync`

  const res = await fetch(url, {
    headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
  })

  if (!res.ok) {
    const body = await res.text()
    console.error('[onboarding] sync', res.status, body)
    throw new Error('Sync failed')
  }

  return res.json() as Promise<{ message?: string; synced?: number; error?: string }>
}

export async function runFullOnboardingPipeline(): Promise<{
  synced: number
  enriched: number
  scored: number
}> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const cronSecret = process.env.CRON_SECRET
  const authHeaders: Record<string, string> = cronSecret
    ? { Authorization: `Bearer ${cronSecret}` }
    : {}

  const baseUrl = `${proto}://${host}`

  const syncRes = await fetch(`${baseUrl}/api/cron/sync`, { headers: authHeaders })
  const syncData = syncRes.ok ? ((await syncRes.json()) as { synced?: number }) : { synced: 0 }

  const enrichRes = await fetch(`${baseUrl}/api/cron/enrich`, { headers: authHeaders })
  const enrichData = enrichRes.ok ? ((await enrichRes.json()) as { enriched?: number }) : { enriched: 0 }

  const scoreRes = await fetch(`${baseUrl}/api/cron/score`, { headers: authHeaders })
  const scoreData = scoreRes.ok ? ((await scoreRes.json()) as { scored?: number }) : { scored: 0 }

  await fetch(`${baseUrl}/api/cron/signals`, { headers: authHeaders }).catch(() => {})

  return {
    synced: syncData.synced ?? 0,
    enriched: enrichData.enriched ?? 0,
    scored: scoreData.scored ?? 0,
  }
}

export type SavePreferencesInput = {
  alert_frequency: string
  comm_style: string
  focus_stage: string | null
  role?: string
  slack_user_id?: string | null
  outreach_tone?: string
}

export async function saveOnboardingPreferences(input: SavePreferencesInput) {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('Unauthorized')
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('rep_profile_id')
    .eq('id', user.id)
    .single()

  if (!profile?.rep_profile_id) {
    throw new Error('No rep profile')
  }

  const repUpdate: Record<string, unknown> = {
    alert_frequency: input.alert_frequency,
    comm_style: input.comm_style,
    focus_stage: input.focus_stage || null,
  }
  if (input.outreach_tone) repUpdate.outreach_tone = input.outreach_tone
  if (input.slack_user_id !== undefined) {
    repUpdate.slack_user_id = input.slack_user_id || null
  }

  const { error } = await supabase
    .from('rep_profiles')
    .update(repUpdate)
    .eq('id', profile.rep_profile_id)

  if (error) {
    console.error('[onboarding] saveOnboardingPreferences', error)
    throw new Error(error.message)
  }

  if (input.role) {
    const { error: roleErr } = await supabase
      .from('user_profiles')
      .update({ role: input.role })
      .eq('id', user.id)
    if (roleErr) {
      console.error('[onboarding] saveOnboardingPreferences (role)', roleErr)
    }
  }
}

// ── Wizard server actions ────────────────────────────────────────────────

async function getCurrentTenantId(): Promise<string> {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id) throw new Error('No tenant')
  return profile.tenant_id
}

export interface SyncSummary {
  companies: number
  opportunities: number
  contacts: number
}

/**
 * Used by the wizard's "Sync & Explore" step. Returns counts so the UI can
 * tell the user how much data was found (which informs the next two steps).
 */
export async function getTenantDataSummary(): Promise<SyncSummary> {
  const tenantId = await getCurrentTenantId()
  const admin = getServiceSupabase()

  const [companies, opps, contacts] = await Promise.all([
    admin
      .from('companies')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    admin
      .from('opportunities')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    admin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
  ])

  return {
    companies: companies.count ?? 0,
    opportunities: opps.count ?? 0,
    contacts: contacts.count ?? 0,
  }
}

export async function getOnboardingProposals(): Promise<{
  icp: IcpProposal
  funnel: FunnelProposal
}> {
  const tenantId = await getCurrentTenantId()
  const admin = getServiceSupabase()

  const [oppsRes, companiesRes, wonOppsRes] = await Promise.all([
    admin
      .from('opportunities')
      .select('stage, days_in_stage, is_won, is_closed, value, company_id')
      .eq('tenant_id', tenantId),
    admin
      .from('companies')
      .select('industry, employee_count, annual_revenue, hq_country')
      .eq('tenant_id', tenantId),
    admin
      .from('opportunities')
      .select('company_id')
      .eq('tenant_id', tenantId)
      .eq('is_won', true),
  ])

  const wonCompanyIds = [
    ...new Set((wonOppsRes.data ?? []).map((o) => o.company_id).filter(Boolean)),
  ] as string[]

  let wonCompanies: Array<{ industry: string | null; employee_count: number | null; annual_revenue: number | null; hq_country: string | null }> = []
  if (wonCompanyIds.length > 0) {
    const { data } = await admin
      .from('companies')
      .select('industry, employee_count, annual_revenue, hq_country')
      .in('id', wonCompanyIds)
    wonCompanies = data ?? []
  }

  const icp = buildIcpProposal(
    wonOppsRes.data ?? [],
    companiesRes.data ?? [],
    wonCompanies,
  )
  const funnel = buildFunnelProposal(oppsRes.data ?? [])

  return { icp, funnel }
}

export async function applyIcpConfig(config: IcpConfig, note?: string) {
  const tenantId = await getCurrentTenantId()
  const admin = getServiceSupabase()

  const stamped = {
    ...(config as unknown as Record<string, unknown>),
    _updated_at: new Date().toISOString(),
    _updated_note: note ?? null,
  }

  const { error } = await admin
    .from('tenants')
    .update({ icp_config: stamped, updated_at: new Date().toISOString() })
    .eq('id', tenantId)

  if (error) throw new Error(`Failed to save ICP config: ${error.message}`)
}

export async function applyFunnelConfig(config: FunnelConfig, note?: string) {
  const tenantId = await getCurrentTenantId()
  const admin = getServiceSupabase()

  const stamped = {
    ...(config as unknown as Record<string, unknown>),
    _updated_at: new Date().toISOString(),
    _updated_note: note ?? null,
  }

  const { error } = await admin
    .from('tenants')
    .update({ funnel_config: stamped, updated_at: new Date().toISOString() })
    .eq('id', tenantId)

  if (error) throw new Error(`Failed to save funnel config: ${error.message}`)
}
