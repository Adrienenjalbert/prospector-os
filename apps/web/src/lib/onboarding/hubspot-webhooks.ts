import { HubSpotAdapter } from '@prospector/adapters'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptCredentials, isEncryptedString } from '@/lib/crypto'

/**
 * Phase 3.8 onboarding helper — subscribes the tenant's HubSpot app to
 * the property-change events the new /api/webhooks/hubspot-properties
 * route consumes.
 *
 * Called from /onboarding when a tenant completes HubSpot connection,
 * and re-callable from /admin/connectors as a "resync subscriptions"
 * action when HubSpot's webhook UI shows them missing.
 *
 * Event list reflects the property→column maps in the webhook route.
 * If the maps grow to cover more properties, add the corresponding
 * subscription entries here so HubSpot starts pushing them.
 */

/**
 * The subscription strings the route knows how to consume. Format
 * matches HubSpotAdapter.setupWebhook expectations:
 *   <objectType>.propertyChange.<propertyName>  (per-property)
 *   <objectType>.propertyChange                 (all properties)
 *
 * We subscribe per-property rather than to the whole object because
 * (a) HubSpot bills per event regardless and (b) it keeps the noise
 * floor down — a custom property change we can't map produces no
 * webhook delivery at all.
 */
export const HUBSPOT_PROPERTY_SUBSCRIPTIONS = [
  // Deal stage moves are the highest-leverage — when the rep moves a
  // deal to Negotiation, the agent's current-deal-health slice should
  // reflect it on the next turn, not 6h later.
  'deal.propertyChange.dealstage',
  'deal.propertyChange.amount',
  'deal.propertyChange.closedate',
  'deal.propertyChange.dealname',
  'deal.propertyChange.hubspot_owner_id',
  'deal.propertyChange.hs_is_closed_won',
  'deal.propertyChange.hs_is_closed',

  // Company-level changes that affect ICP scoring + selection.
  'company.propertyChange.industry',
  'company.propertyChange.numberofemployees',
  'company.propertyChange.annualrevenue',
  'company.propertyChange.hs_lead_status',
  'company.propertyChange.hubspot_owner_id',

  // Contact role/title changes power the champion-map slice.
  'contact.propertyChange.jobtitle',
  'contact.propertyChange.email',
  'contact.propertyChange.hubspot_owner_id',
] as const

export interface HubspotWebhookSetupResult {
  ok: boolean
  events_subscribed: number
  error?: string
}

/**
 * Subscribe the tenant's HubSpot app to the property-change events that
 * the /api/webhooks/hubspot-properties route consumes. Returns a result
 * structure rather than throwing — callers (onboarding wizard, admin
 * UI) want to surface failures cleanly.
 *
 * The callback URL must point at the deployed /api/webhooks/hubspot-properties
 * route. We accept it as an arg so dev/staging/prod can each register
 * their own URL without env coupling at this layer.
 */
export async function subscribeHubspotPropertyWebhooks(
  supabase: SupabaseClient,
  tenantId: string,
  callbackUrl: string,
): Promise<HubspotWebhookSetupResult> {
  // Resolve credentials — same pattern as cron/sync + Champion Alumni
  // detector use.
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('crm_type, crm_credentials_encrypted')
    .eq('id', tenantId)
    .single()
  if (error || !tenant) {
    return { ok: false, events_subscribed: 0, error: 'Tenant not found' }
  }
  if (tenant.crm_type !== 'hubspot') {
    return {
      ok: false,
      events_subscribed: 0,
      error: `Tenant CRM is ${tenant.crm_type}, not hubspot`,
    }
  }
  const rawCreds = (tenant as { crm_credentials_encrypted: unknown })
    .crm_credentials_encrypted
  if (!rawCreds) {
    return { ok: false, events_subscribed: 0, error: 'CRM credentials missing' }
  }
  const creds = isEncryptedString(rawCreds)
    ? (decryptCredentials(rawCreds) as Record<string, string>)
    : (rawCreds as Record<string, string>)
  if (!creds.private_app_token) {
    return { ok: false, events_subscribed: 0, error: 'HubSpot private_app_token missing' }
  }

  const adapter = new HubSpotAdapter({ private_app_token: creds.private_app_token })

  try {
    await adapter.setupWebhook(
      [...HUBSPOT_PROPERTY_SUBSCRIPTIONS],
      callbackUrl,
    )
    return { ok: true, events_subscribed: HUBSPOT_PROPERTY_SUBSCRIPTIONS.length }
  } catch (err) {
    return {
      ok: false,
      events_subscribed: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
