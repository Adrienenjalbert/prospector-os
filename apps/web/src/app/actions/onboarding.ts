'use server'

import { headers } from 'next/headers'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/cron-auth'
import { encryptCredentials } from '@/lib/crypto'

export type SaveCrmCredentialsInput = {
  client_id: string
  client_secret: string
  instance_url: string
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

  const hasEncryptionKey = !!process.env.CREDENTIALS_ENCRYPTION_KEY
  const credentialPayload = hasEncryptionKey
    ? encryptCredentials({
        client_id: input.client_id,
        client_secret: input.client_secret,
        instance_url: input.instance_url,
      })
    : {
        client_id: input.client_id,
        client_secret: input.client_secret,
        instance_url: input.instance_url,
      }

  const { error } = await admin
    .from('tenants')
    .update({
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

  const { error } = await supabase
    .from('rep_profiles')
    .update({
      alert_frequency: input.alert_frequency,
      comm_style: input.comm_style,
      focus_stage: input.focus_stage || null,
    })
    .eq('id', profile.rep_profile_id)

  if (error) {
    console.error('[onboarding] saveOnboardingPreferences', error)
    throw new Error(error.message)
  }
}
