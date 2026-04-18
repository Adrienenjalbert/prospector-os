import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared HubSpot webhook plumbing — extracted from the original
 * hubspot-meeting route in Phase 3.8 so the new property-change webhook
 * routes don't duplicate verification, tenant resolution, or the
 * idempotency check.
 *
 * Three concerns owned here:
 *
 *   1. Signature verification (v3 + v2 fallback).
 *   2. Tenant resolution by HubSpot portal id.
 *   3. Idempotency check via webhook_deliveries.
 *
 * Each route still owns its own event filtering + business logic — the
 * shared helpers stop short of "what should we do with this event".
 */

const HMAC_MAX_AGE_MS = 5 * 60 * 1000

/**
 * HubSpot v3 signature verification.
 *   base = method + uri + body + timestamp
 *   expected = base64( HMAC-SHA-256(clientSecret, base) )
 * Rejects requests older than HMAC_MAX_AGE_MS (5 min) to prevent replay.
 *
 * v2 fallback path:
 *   expected = hex( HMAC-SHA-256(clientSecret, clientSecret + body) )
 * kept because some HubSpot app scopes still post v2 signatures.
 */
export function verifyHubSpotSignature(
  request: Request,
  body: string,
  clientSecret: string,
): boolean {
  const v3 = request.headers.get('x-hubspot-signature-v3')
  const v3Timestamp = request.headers.get('x-hubspot-request-timestamp')

  if (v3 && v3Timestamp) {
    const ts = Number(v3Timestamp)
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > HMAC_MAX_AGE_MS) {
      return false
    }
    const url = new URL(request.url)
    const uri = `${url.origin}${url.pathname}${url.search}`
    const base = `${request.method}${uri}${body}${v3Timestamp}`
    const expected = createHmac('sha256', clientSecret).update(base).digest('base64')
    return safeEqual(expected, v3)
  }

  const v2 = request.headers.get('x-hubspot-signature')
  if (v2) {
    const expected = createHmac('sha256', clientSecret)
      .update(clientSecret + body)
      .digest('hex')
    return safeEqual(expected, v2)
  }

  return false
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

/** Resolve the tenant id for a given HubSpot portal id, or null. */
export async function resolveTenantByPortal(
  supabase: SupabaseClient,
  portalId: number,
): Promise<string | null> {
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .eq('hubspot_portal_id', portalId)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Atomic-ish idempotency check + record. Returns true if the event was
 * already processed (caller should skip), false if this is the first
 * time. Records the delivery row when first seen so subsequent calls
 * with the same idempotency_key short-circuit.
 *
 * Pattern matches the existing hubspot-meeting route — we always insert
 * the row up-front and let the unique constraint handle dedup. This
 * means a "saw it" answer is only reliable AFTER the insert succeeded;
 * a concurrent duplicate could squeak through. For our throughput
 * (HubSpot batches ~10s of events/sec at peak) this is acceptable —
 * the upsert path the route follows is itself idempotent on the row
 * level via `onConflict: 'tenant_id,crm_id'`.
 */
export async function isAlreadyProcessed(
  supabase: SupabaseClient,
  opts: {
    tenantId: string
    idempotencyKey: string
    webhookType: string
  },
): Promise<boolean> {
  const { data } = await supabase
    .from('webhook_deliveries')
    .select('id')
    .eq('tenant_id', opts.tenantId)
    .eq('idempotency_key', opts.idempotencyKey)
    .maybeSingle()
  return data != null
}

export async function recordWebhookDelivery(
  supabase: SupabaseClient,
  opts: {
    tenantId: string
    idempotencyKey: string
    webhookType: string
    resultId?: string
  },
): Promise<void> {
  await supabase
    .from('webhook_deliveries')
    .insert({
      tenant_id: opts.tenantId,
      idempotency_key: opts.idempotencyKey,
      result_id: opts.resultId ?? null,
      webhook_type: opts.webhookType,
    })
    .then(() => undefined, () => undefined)
}

/**
 * Common shape of every HubSpot subscription event. The fields the v3
 * payload guarantees: subscriptionType, portalId, occurredAt, objectId,
 * eventId. propertyName/propertyValue/changeSource appear on
 * propertyChange events.
 */
export interface HubSpotSubscriptionEvent {
  subscriptionType?: string
  portalId?: number
  appId?: number
  occurredAt?: number
  subscriptionId?: number
  attemptNumber?: number
  objectId?: number
  eventId?: number
  propertyName?: string
  propertyValue?: string
  changeSource?: string
  objectTypeId?: string
}
