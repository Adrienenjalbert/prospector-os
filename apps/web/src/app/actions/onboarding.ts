'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/cron-auth'
import { encryptCredentials } from '@/lib/crypto'
import { emitAgentEvent } from '@prospector/core'
import { subscribeHubspotPropertyWebhooks } from '@/lib/onboarding/hubspot-webhooks'
import {
  buildIcpProposal,
  buildFunnelProposal,
  type IcpConfig,
  type IcpProposal,
  type FunnelConfig,
  type FunnelProposal,
} from '@/lib/onboarding/proposals'

// =============================================================================
// Validation schemas
//
// Every server action below parses its input with Zod before doing anything
// else. Without this the wizard could write malformed credentials, partial
// preferences, or runaway JSON into `tenants.icp_config` JSONB. The HubSpot
// PAT pattern is from the HubSpot Private App docs (`pat-na1-…`); the
// Salesforce instance URL must be a real https URL on a Salesforce-hosted
// domain so a typo can't produce silent retry-storms against the wrong host.
// =============================================================================

const HUBSPOT_PAT_REGEX = /^pat-[a-z0-9]+-[a-z0-9-]{20,}$/i

const SaveCrmCredentialsSchema = z.discriminatedUnion('crm_type', [
  z.object({
    crm_type: z.literal('hubspot'),
    private_app_token: z
      .string()
      .min(20, 'HubSpot Private App token looks too short')
      .regex(
        HUBSPOT_PAT_REGEX,
        'HubSpot Private App tokens start with `pat-` followed by hex segments',
      ),
  }),
  z.object({
    crm_type: z.literal('salesforce'),
    client_id: z.string().min(10, 'Client ID is required'),
    client_secret: z.string().min(10, 'Client secret is required'),
    instance_url: z
      .string()
      .url('Instance URL must be a full https URL')
      .regex(
        /^https:\/\/[a-z0-9.-]+\.(my\.salesforce\.com|salesforce\.com|force\.com)\/?$/i,
        'Instance URL must point at a Salesforce-hosted domain',
      ),
  }),
])

export type SaveCrmCredentialsInput = z.infer<typeof SaveCrmCredentialsSchema>

const SavePreferencesSchema = z.object({
  alert_frequency: z.enum(['high', 'medium', 'low']),
  comm_style: z.enum(['formal', 'casual', 'brief']),
  focus_stage: z.string().nullable(),
  role: z.enum(['rep', 'csm', 'ad', 'manager', 'revops', 'admin']).optional(),
  // Slack user IDs follow `U`/`W` + uppercase alphanumerics; `null` is the
  // explicit "user opted out" signal so we store NULL rather than empty
  // string and the dispatcher's `if (slack_user_id)` check is honest.
  slack_user_id: z
    .string()
    .regex(/^[UW][A-Z0-9]+$/, 'Slack user IDs look like U01ABCDEF')
    .nullable()
    .optional(),
  outreach_tone: z.enum(['professional', 'consultative', 'direct', 'warm', 'executive']).optional(),
})

export type SavePreferencesInput = z.infer<typeof SavePreferencesSchema>

const IcpConfigSchema = z.object({
  version: z.string().optional(),
  dimensions: z
    .array(
      z.object({
        name: z.string().min(1),
        weight: z.number().min(0).max(1),
        description: z.string().optional(),
        scoring_tiers: z.array(z.unknown()).optional(),
      }),
    )
    .min(1, 'ICP must have at least one dimension')
    .refine(
      // Weights must sum to 1.0 (within float tolerance). If a tenant
      // accidentally writes weights that sum to 0.4 or 1.7, every
      // priority score downstream is silently miscalibrated. Reject at
      // the API instead of finding out 90 days later.
      (dims) => {
        const sum = dims.reduce((s, d) => s + d.weight, 0)
        return Math.abs(sum - 1) < 0.001
      },
      { message: 'ICP dimension weights must sum to 1.0' },
    ),
  tier_thresholds: z.record(z.number()).optional(),
}).passthrough()

const FunnelConfigSchema = z.object({
  stages: z
    .array(
      z.object({
        name: z.string().min(1),
        order: z.number().int().nonnegative(),
        crm_field_value: z.string().optional(),
        stage_type: z.enum(['active', 'closed_won', 'closed_lost']).optional(),
        expected_velocity_days: z.number().nonnegative().optional(),
        stall_multiplier: z.number().positive().optional(),
        description: z.string().optional(),
      }),
    )
    .min(1, 'Funnel must have at least one stage')
    .refine(
      // Stage names must be unique — duplicates produce ambiguous
      // benchmark joins downstream and a confusing UI.
      (stages) => new Set(stages.map((s) => s.name)).size === stages.length,
      { message: 'Funnel stage names must be unique' },
    ),
  benchmark_config: z.unknown().optional(),
  stall_config: z.unknown().optional(),
}).passthrough()

// =============================================================================
// Shared helpers
// =============================================================================

async function requireProfile(): Promise<{ userId: string; tenantId: string; role: string | null }> {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) throw new Error('No tenant')

  return {
    userId: user.id,
    tenantId: profile.tenant_id as string,
    role: (profile as { role?: string | null }).role ?? null,
  }
}

/**
 * Build the public-facing app URL the HubSpot webhook subscription
 * needs as a callback. Falls back to the request host so dev (where
 * NEXT_PUBLIC_APP_URL is `localhost:3000`) still works behind a tunnel.
 * Returns null if no usable URL can be derived (in which case the
 * caller MUST skip the subscribe step rather than register `localhost`
 * with HubSpot).
 */
async function deriveCallbackUrl(): Promise<string | null> {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (envUrl && /^https?:\/\//.test(envUrl)) {
    return `${envUrl}/api/webhooks/hubspot-properties`
  }
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  if (!host) return null
  // Skip localhost — HubSpot won't accept it as a webhook callback.
  if (/localhost|127\.0\.0\.1/.test(host)) return null
  return `${proto}://${host}/api/webhooks/hubspot-properties`
}

// =============================================================================
// CRM credentials
// =============================================================================

export async function saveCrmCredentials(input: SaveCrmCredentialsInput) {
  const parsed = SaveCrmCredentialsSchema.parse(input)
  const { userId, tenantId } = await requireProfile()
  const admin = getServiceSupabase()

  const rawCreds = parsed.crm_type === 'hubspot'
    ? { private_app_token: parsed.private_app_token }
    : {
        client_id: parsed.client_id,
        client_secret: parsed.client_secret,
        instance_url: parsed.instance_url,
      }

  // Fail closed in production: writing CRM credentials as plaintext JSON
  // into Postgres is a real security incident waiting to happen. The
  // previous version silently fell through to a plaintext write when
  // CREDENTIALS_ENCRYPTION_KEY was missing. We now require the key in
  // every non-development environment.
  const hasEncryptionKey = !!process.env.CREDENTIALS_ENCRYPTION_KEY
  if (!hasEncryptionKey && process.env.NODE_ENV === 'production') {
    throw new Error(
      'Cannot store CRM credentials: CREDENTIALS_ENCRYPTION_KEY is not configured. ' +
        'Generate one with `openssl rand -hex 32` and set it before retrying.',
    )
  }
  const credentialPayload = hasEncryptionKey
    ? encryptCredentials(rawCreds)
    : rawCreds

  const { error } = await admin
    .from('tenants')
    .update({
      crm_type: parsed.crm_type,
      crm_credentials_encrypted: credentialPayload,
    })
    .eq('id', tenantId)

  if (error) {
    console.error('[onboarding] saveCrmCredentials', error)
    throw new Error(error.message)
  }

  // For HubSpot tenants, register property-change webhook subscriptions
  // so the agent's per-deal slices reflect CRM updates within seconds
  // (vs. the 6h cron sync window). Best-effort — if the subscribe call
  // fails (HubSpot down, callback URL unresolvable in dev), we don't
  // block the wizard. The same function is exposed at
  // /admin/connectors as a "resync" button for retry.
  let webhookSubscribed = false
  if (parsed.crm_type === 'hubspot') {
    const callbackUrl = await deriveCallbackUrl()
    if (callbackUrl) {
      const sub = await subscribeHubspotPropertyWebhooks(admin, tenantId, callbackUrl)
      webhookSubscribed = sub.ok
      if (!sub.ok) {
        console.warn('[onboarding] HubSpot webhook subscribe failed:', sub.error)
      }
    } else {
      console.warn(
        '[onboarding] Skipping HubSpot webhook subscribe: no public callback URL configured ' +
          '(set NEXT_PUBLIC_APP_URL).',
      )
    }
  }

  await emitAgentEvent(admin, {
    tenant_id: tenantId,
    user_id: userId,
    event_type: 'crm_connected',
    payload: {
      crm_type: parsed.crm_type,
      webhook_subscribed: webhookSubscribed,
    },
  })

  await emitAgentEvent(admin, {
    tenant_id: tenantId,
    user_id: userId,
    event_type: 'onboarding_step_completed',
    payload: { step: 'crm' },
  })

  return { ok: true, webhook_subscribed: webhookSubscribed }
}

// =============================================================================
// Sync pipeline (sync + enrich + score + signals)
// =============================================================================

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

interface PipelineStepResult {
  ok: boolean
  count?: number
  error?: string
}

async function runPipelineStep(
  baseUrl: string,
  path: string,
  authHeaders: Record<string, string>,
  countField: 'synced' | 'enriched' | 'scored',
): Promise<PipelineStepResult> {
  try {
    const res = await fetch(`${baseUrl}${path}`, { headers: authHeaders })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `${path} → ${res.status}: ${body.slice(0, 200)}` }
    }
    const data = (await res.json()) as Record<string, unknown>
    const count = typeof data[countField] === 'number' ? (data[countField] as number) : 0
    return { ok: true, count }
  } catch (err) {
    return {
      ok: false,
      error: `${path} → ${err instanceof Error ? err.message : 'fetch error'}`,
    }
  }
}

export async function runFullOnboardingPipeline(): Promise<{
  synced: number
  enriched: number
  scored: number
}> {
  const { userId, tenantId } = await requireProfile()
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const cronSecret = process.env.CRON_SECRET
  const authHeaders: Record<string, string> = cronSecret
    ? { Authorization: `Bearer ${cronSecret}` }
    : {}
  const baseUrl = `${proto}://${host}`

  // Sync is the BLOCKER step — without it none of the others have data.
  // Throw on failure so the wizard surfaces the error to the user
  // instead of cheerfully reporting `synced: 0`.
  const syncRes = await runPipelineStep(baseUrl, '/api/cron/sync', authHeaders, 'synced')
  if (!syncRes.ok) {
    throw new Error(`CRM sync failed: ${syncRes.error}`)
  }

  // Enrich + score + signals are downstream — best-effort. Each of
  // those routes runs nightly anyway; failing one in the wizard shouldn't
  // block the user from continuing.
  const enrichRes = await runPipelineStep(baseUrl, '/api/cron/enrich', authHeaders, 'enriched')
  const scoreRes = await runPipelineStep(baseUrl, '/api/cron/score', authHeaders, 'scored')
  await runPipelineStep(baseUrl, '/api/cron/signals', authHeaders, 'synced')

  const admin = getServiceSupabase()
  await emitAgentEvent(admin, {
    tenant_id: tenantId,
    user_id: userId,
    event_type: 'onboarding_step_completed',
    payload: {
      step: 'sync',
      synced: syncRes.count ?? 0,
      enriched: enrichRes.count ?? 0,
      scored: scoreRes.count ?? 0,
      enrich_error: enrichRes.ok ? undefined : enrichRes.error,
      score_error: scoreRes.ok ? undefined : scoreRes.error,
    },
  })

  // C1: trigger the first-run digest now that sync + score are done.
  // The workflow is enqueued (not awaited) so the wizard returns
  // immediately and the rep doesn't wait on Slack delivery —
  // the cron drain (or in-process runner if available) will fire
  // it within seconds. SLA is measured by the
  // `first_run_completed` event the workflow emits at the end.
  //
  // Resolved rep: the user starting the onboarding wizard. Greenfield
  // tenants without rep_profiles won't enqueue.
  const { data: userProfile } = await admin
    .from('user_profiles')
    .select('rep_profile_id')
    .eq('id', userId)
    .maybeSingle()

  const repProfileId = userProfile?.rep_profile_id as string | null | undefined
  if (repProfileId) {
    try {
      const { enqueueFirstRun, runFirstRun } = await import('@/lib/workflows')
      const run = await enqueueFirstRun(admin, tenantId, {
        rep_id: repProfileId,
        source: 'onboarding_wizard',
      })
      // Best-effort in-process run so the rep sees the Slack DM
      // before the wizard's "next" CTA fires. Any failure (Slack
      // down, rate limit) is recoverable: the cron drain re-runs
      // pending workflow_runs rows on the next /api/cron/workflows
      // tick. We swallow errors here so the wizard never blocks.
      void runFirstRun(admin, run.id).catch((err) => {
        console.warn('[onboarding] first_run kickoff failed (cron will retry):', err)
      })
    } catch (err) {
      console.warn('[onboarding] could not enqueue first_run:', err)
    }
  }

  return {
    synced: syncRes.count ?? 0,
    enriched: enrichRes.count ?? 0,
    scored: scoreRes.count ?? 0,
  }
}

// =============================================================================
// Preferences
// =============================================================================

export async function saveOnboardingPreferences(input: SavePreferencesInput) {
  const parsed = SavePreferencesSchema.parse(input)
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, rep_profile_id')
    .eq('id', user.id)
    .single()
  if (!profile?.rep_profile_id) throw new Error('No rep profile')

  const repUpdate: Record<string, unknown> = {
    alert_frequency: parsed.alert_frequency,
    comm_style: parsed.comm_style,
    focus_stage: parsed.focus_stage || null,
  }
  if (parsed.outreach_tone) repUpdate.outreach_tone = parsed.outreach_tone
  if (parsed.slack_user_id !== undefined) {
    repUpdate.slack_user_id = parsed.slack_user_id || null
  }

  const { error } = await supabase
    .from('rep_profiles')
    .update(repUpdate)
    .eq('id', profile.rep_profile_id)

  if (error) {
    console.error('[onboarding] saveOnboardingPreferences', error)
    throw new Error(error.message)
  }

  if (parsed.role) {
    const { error: roleErr } = await supabase
      .from('user_profiles')
      .update({ role: parsed.role })
      .eq('id', user.id)
    if (roleErr) {
      console.error('[onboarding] saveOnboardingPreferences (role)', roleErr)
    }
  }

  if (profile.tenant_id) {
    const admin = getServiceSupabase()
    await emitAgentEvent(admin, {
      tenant_id: profile.tenant_id as string,
      user_id: user.id,
      event_type: 'onboarding_step_completed',
      payload: { step: 'preferences', role: parsed.role ?? null },
    })
    await emitAgentEvent(admin, {
      tenant_id: profile.tenant_id as string,
      user_id: user.id,
      event_type: 'onboarding_completed',
      payload: { final_role: parsed.role ?? null },
    })

    // Phase 6 (Section 2.6) — bootstrap the per-tenant CLAUDE.md schema
    // with the default template so /admin/wiki/schema shows v1 from day
    // one (rather than an empty form). The insert is idempotent: if the
    // tenant already has a row (e.g. they re-ran onboarding), the
    // ON CONFLICT DO NOTHING preserves the customised version.
    try {
      const { DEFAULT_TENANT_WIKI_SCHEMA } = await import('@/lib/wiki/schema-template')
      await admin
        .from('tenant_wiki_schema')
        .upsert(
          {
            tenant_id: profile.tenant_id as string,
            body_md: DEFAULT_TENANT_WIKI_SCHEMA,
            version: 1,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id', ignoreDuplicates: true },
        )
    } catch (err) {
      console.warn('[onboarding] tenant_wiki_schema bootstrap failed:', err)
    }
  }
}

// =============================================================================
// Wizard data + proposals
// =============================================================================

export interface SyncSummary {
  companies: number
  opportunities: number
  contacts: number
}

export async function getTenantDataSummary(): Promise<SyncSummary> {
  const { tenantId } = await requireProfile()
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
  const { userId, tenantId } = await requireProfile()
  const admin = getServiceSupabase()

  const [oppsRes, companiesRes, wonOppsRes] = await Promise.all([
    admin
      .from('opportunities')
      .select('stage, stage_order, days_in_stage, is_won, is_closed, value, company_id')
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

  await emitAgentEvent(admin, {
    tenant_id: tenantId,
    user_id: userId,
    event_type: 'onboarding_proposals_loaded',
    payload: {
      icp_source: icp.source,
      funnel_source: funnel.source,
      won_deals: wonCompanies.length,
      stages_found: funnel.analysis?.stages_found ?? 0,
    },
  })

  return { icp, funnel }
}

export async function applyIcpConfig(config: IcpConfig, note?: string) {
  const parsed = IcpConfigSchema.parse(config)
  const { userId, tenantId } = await requireProfile()
  const admin = getServiceSupabase()

  const stamped = {
    ...(parsed as unknown as Record<string, unknown>),
    _updated_at: new Date().toISOString(),
    _updated_note: note ?? null,
  }

  const { error } = await admin
    .from('tenants')
    .update({ icp_config: stamped, updated_at: new Date().toISOString() })
    .eq('id', tenantId)

  if (error) throw new Error(`Failed to save ICP config: ${error.message}`)

  await emitAgentEvent(admin, {
    tenant_id: tenantId,
    user_id: userId,
    event_type: 'onboarding_config_applied',
    payload: { kind: 'icp', dimensions: parsed.dimensions.length },
  })
  await emitAgentEvent(admin, {
    tenant_id: tenantId,
    user_id: userId,
    event_type: 'onboarding_step_completed',
    payload: { step: 'icp' },
  })
}

export async function applyFunnelConfig(config: FunnelConfig, note?: string) {
  const parsed = FunnelConfigSchema.parse(config)
  const { userId, tenantId } = await requireProfile()
  const admin = getServiceSupabase()

  const stamped = {
    ...(parsed as unknown as Record<string, unknown>),
    _updated_at: new Date().toISOString(),
    _updated_note: note ?? null,
  }

  const { error } = await admin
    .from('tenants')
    .update({ funnel_config: stamped, updated_at: new Date().toISOString() })
    .eq('id', tenantId)

  if (error) throw new Error(`Failed to save funnel config: ${error.message}`)

  await emitAgentEvent(admin, {
    tenant_id: tenantId,
    user_id: userId,
    event_type: 'onboarding_config_applied',
    payload: { kind: 'funnel', stages: parsed.stages.length },
  })
  await emitAgentEvent(admin, {
    tenant_id: tenantId,
    user_id: userId,
    event_type: 'onboarding_step_completed',
    payload: { step: 'funnel' },
  })
}
