import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { emitOutcomeEvent } from '@prospector/core'
import { enqueuePreCallBrief, runPreCallBrief } from '@/lib/workflows'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase credentials')
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * HubSpot v3 signature verification.
 *   base = method + uri + body + timestamp
 *   expected = base64( HMAC-SHA-256(clientSecret, base) )
 * Rejects requests older than MAX_AGE_MS to prevent replay attacks.
 *
 * v2 fallback path:
 *   expected = hex( HMAC-SHA-256(clientSecret, clientSecret + body) )
 * kept because some HubSpot app scopes still post v2 signatures.
 */
function verifyHubSpotSignature(
  request: Request,
  body: string,
  clientSecret: string,
): boolean {
  const v3 = request.headers.get('x-hubspot-signature-v3')
  const v3Timestamp = request.headers.get('x-hubspot-request-timestamp')

  const MAX_AGE_MS = 5 * 60 * 1000

  if (v3 && v3Timestamp) {
    const ts = Number(v3Timestamp)
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_AGE_MS) {
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

interface HubSpotMeetingEvent {
  objectId: number
  propertyName?: string
  propertyValue?: string
  changeSource?: string
  eventId?: number
  subscriptionId?: number
  portalId?: number
  occurredAt?: number
  subscriptionType?: string
  objectTypeId?: string
}

async function resolveTenantByPortal(
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

export async function POST(request: Request) {
  // Fail closed: HUBSPOT_CLIENT_SECRET must be set, signature must verify.
  // This is a public webhook; without HMAC it accepts arbitrary POSTs.
  const hubspotSecret = process.env.HUBSPOT_CLIENT_SECRET
  if (!hubspotSecret) {
    console.error('[webhooks/hubspot-meeting] HUBSPOT_CLIENT_SECRET not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const rawBody = await request.text()

  if (!verifyHubSpotSignature(request, rawBody, hubspotSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let events: HubSpotMeetingEvent[]
  try {
    const parsed = JSON.parse(rawBody)
    events = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const meetingEvents = events.filter(
    (e) =>
      e.subscriptionType === 'meeting.creation' ||
      e.subscriptionType === 'engagement.creation',
  )

  if (meetingEvents.length === 0) {
    return NextResponse.json({ message: 'No meeting events' }, { status: 200 })
  }

  const supabase = getServiceSupabase()
  let processed = 0
  let skipped = 0

  for (const event of meetingEvents) {
    if (!event.portalId) {
      console.warn('[webhooks/hubspot-meeting] event missing portalId; skipping', {
        eventId: event.eventId,
        objectId: event.objectId,
      })
      skipped++
      continue
    }

    const tenantId = await resolveTenantByPortal(supabase, event.portalId)
    if (!tenantId) {
      console.warn('[webhooks/hubspot-meeting] no tenant for portalId; skipping', {
        portalId: event.portalId,
      })
      skipped++
      continue
    }

    // Idempotency: HubSpot can replay events. Dedupe on (portalId, eventId,
    // objectId). The pre-call workflow itself also keys idempotency on
    // meeting_id, but we short-circuit here so we don't even enqueue twice.
    const idempotencyKey = `hubspot-meeting:${event.portalId}:${event.eventId ?? event.objectId}`
    const { data: seen } = await supabase
      .from('webhook_deliveries')
      .select('id, result_id')
      .eq('idempotency_key', idempotencyKey)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (seen) {
      skipped++
      continue
    }

    try {
      // Enqueue the durable DAG workflow. It owns:
      //   - T-15 scheduling (waits if meeting is far out)
      //   - cooldown + push-budget enforcement via SlackDispatcher
      //   - holdout suppression via shouldSuppressPush
      //   - retry on transient failures
      // We deliberately do NOT send Slack here — that path bypassed the
      // harness and could double-fire briefs.
      const run = await enqueuePreCallBrief(supabase, tenantId, {
        meeting_id: String(event.objectId),
        portal_id: event.portalId,
      })

      // Record idempotency so duplicate webhook deliveries become no-ops.
      await supabase
        .from('webhook_deliveries')
        .insert({
          tenant_id: tenantId,
          idempotency_key: idempotencyKey,
          result_id: run.id,
          webhook_type: 'hubspot_meeting',
        })
        .then(() => undefined, () => undefined)

      // Emit a meeting_booked outcome event so attribution can correlate
      // pre-call briefs we sent against actual booked meetings. The
      // attribution workflow reads outcome_events; without this row the
      // ROI page has nothing to credit pre-call briefs against.
      await emitOutcomeEvent(supabase, {
        tenant_id: tenantId,
        subject_urn: `urn:rev:meeting:${event.objectId}`,
        event_type: 'meeting_booked',
        source: 'hubspot_webhook',
        payload: {
          portal_id: event.portalId,
          subscription_type: event.subscriptionType,
          occurred_at: event.occurredAt ?? null,
        },
      })

      // If the meeting is imminent (within 30s of the workflow's scheduled_for),
      // run inline so the brief lands in time. Otherwise the cron drain (every
      // 5 min) picks it up at the right moment.
      const scheduled = run.scheduled_for ? new Date(run.scheduled_for).getTime() : 0
      if (!run.scheduled_for || scheduled <= Date.now() + 30_000) {
        void runPreCallBrief(supabase, run.id).catch((err) => {
          console.warn('[webhooks/hubspot-meeting] workflow run failed', err)
        })
      }

      processed++
    } catch (err) {
      console.error('[webhooks/hubspot-meeting] enqueue failed', err)
    }
  }

  return NextResponse.json({ processed, skipped })
}
