import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { emitOutcomeEvent, urn, type OutcomeEventInput } from '@prospector/core'
import {
  verifyHubSpotSignature,
  resolveTenantByPortal,
  isAlreadyProcessed,
  recordWebhookDelivery,
  type HubSpotSubscriptionEvent,
} from '@/lib/hubspot-webhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * HubSpot property-change webhook receiver.
 *
 * Handles three subscription types: deal.propertyChange,
 * contact.propertyChange, company.propertyChange. The agent's `cron/sync`
 * already mirrors HubSpot into Supabase every 6 hours; this webhook drops
 * staleness for changed properties to <60s. Without it, a deal stage move
 * at 08:00 isn't visible to the agent until ~12:00 — and worse, the
 * agent's own writes via the Phase-3.6 `update_crm_property` tool stay
 * invisible to subsequent turns until the next sync runs.
 *
 * Design choice: rather than re-fetch each object on every event (chatty,
 * costly), we maintain a property→column map per object type and apply
 * focused UPDATE statements. Unmapped properties (tenant-specific custom
 * fields) no-op; Phase 4 will add the `crm-custom-fields` slice +
 * `field_mapping_registry` to surface them.
 *
 * For deals, mirror the same outcome event emission as `cron/sync` so the
 * attribution workflow learns from webhook-driven changes the same way.
 *
 * Idempotency: keyed on (portal, eventId, objectId) via webhook_deliveries.
 * HubSpot retries on non-2xx so we MUST 200 even on partial failures.
 */

function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase credentials')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ---------------------------------------------------------------------------
// Property → column maps
// Each map declares which HubSpot property names update which Supabase
// column on the matching table. Unmapped properties are silently skipped.
// ---------------------------------------------------------------------------

type ColumnSetter = {
  /** Supabase column to set. */
  column: string
  /** Optional value transformer (cast / parse). */
  transform?: (raw: string) => unknown
}

const numberTransform = (raw: string): number | null => {
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

const boolTransform = (raw: string): boolean => raw === 'true' || raw === '1'

const DEAL_PROPERTY_MAP: Record<string, ColumnSetter> = {
  dealstage: { column: 'stage' },
  amount: { column: 'value', transform: numberTransform },
  closedate: { column: 'expected_close_date' },
  dealname: { column: 'name' },
  hubspot_owner_id: { column: 'owner_crm_id' },
  hs_is_closed: { column: 'is_closed', transform: boolTransform },
  hs_is_closed_won: { column: 'is_won', transform: boolTransform },
}

const COMPANY_PROPERTY_MAP: Record<string, ColumnSetter> = {
  name: { column: 'name' },
  industry: { column: 'industry' },
  numberofemployees: { column: 'employee_count', transform: numberTransform },
  annualrevenue: { column: 'annual_revenue', transform: numberTransform },
  domain: { column: 'domain' },
  website: { column: 'website' },
  hubspot_owner_id: { column: 'owner_crm_id' },
  hs_lead_status: { column: 'priority_tier' },
}

const CONTACT_PROPERTY_MAP: Record<string, ColumnSetter> = {
  firstname: { column: 'first_name' },
  lastname: { column: 'last_name' },
  email: { column: 'email' },
  jobtitle: { column: 'title' },
  phone: { column: 'phone' },
  hubspot_owner_id: { column: 'owner_crm_id' },
}

interface ResolvedTarget {
  tableName: 'opportunities' | 'companies' | 'contacts'
  propertyMap: Record<string, ColumnSetter>
  outcomeUrnType: 'opportunity' | 'company' | 'contact'
  emitOutcomes: boolean
}

function resolveTarget(subscriptionType: string | undefined): ResolvedTarget | null {
  switch (subscriptionType) {
    case 'deal.propertyChange':
      return {
        tableName: 'opportunities',
        propertyMap: DEAL_PROPERTY_MAP,
        outcomeUrnType: 'opportunity',
        emitOutcomes: true,
      }
    case 'company.propertyChange':
      return {
        tableName: 'companies',
        propertyMap: COMPANY_PROPERTY_MAP,
        outcomeUrnType: 'company',
        emitOutcomes: false,
      }
    case 'contact.propertyChange':
      return {
        tableName: 'contacts',
        propertyMap: CONTACT_PROPERTY_MAP,
        outcomeUrnType: 'contact',
        emitOutcomes: false,
      }
    default:
      return null
  }
}

/**
 * Compute outcome events for a deal property change. Mirrors the
 * diffOppForOutcomes helper in cron/sync but operates on the focused
 * single-property update we're applying — we read the prior values from
 * Supabase before the update, then compare. The outcome event types are
 * the same so the attribution workflow doesn't need to know whether the
 * change came from cron/sync or the webhook.
 */
function diffOppForOutcomes(
  tenantId: string,
  // Canonical Postgres opportunities.id — required for the URN. Drop
  // outcome events when this is missing rather than emitting an
  // un-attributable URN. The CRM id is recorded in payload as crm_id.
  oppId: string | null,
  oppCrmId: string,
  prev: { stage?: string | null; value?: number | null; is_won?: boolean | null; is_closed?: boolean | null } | null,
  next: Record<string, unknown>,
): OutcomeEventInput[] {
  if (!oppId) return []
  const events: OutcomeEventInput[] = []
  // Canonical URN — see cron/sync's diffOppForOutcomes for the
  // rationale: shorthand `urn:rev:opportunity:{crmId}` lacks the
  // tenant segment and uses the CRM id (not Postgres UUID), so it
  // doesn't round-trip through `parseUrn` and breaks attribution joins.
  const subjectUrn = urn.opportunity(tenantId, oppId)
  const crmRefPayload = { crm_id: oppCrmId }

  if ('stage' in next && prev && (prev.stage ?? null) !== (next.stage ?? null)) {
    events.push({
      tenant_id: tenantId,
      subject_urn: subjectUrn,
      event_type: 'deal_stage_changed',
      source: 'hubspot_webhook',
      payload: { ...crmRefPayload, from: prev.stage ?? null, to: (next.stage as string | null) ?? null },
    })
  }

  if ('value' in next && prev) {
    const prevValue = Number(prev.value ?? 0)
    const nextValue = Number(next.value ?? 0)
    const delta = Math.abs(nextValue - prevValue)
    const pct = prevValue > 0 ? delta / prevValue : 0
    if (delta > 1000 || pct > 0.05) {
      events.push({
        tenant_id: tenantId,
        subject_urn: subjectUrn,
        event_type: 'deal_amount_changed',
        source: 'hubspot_webhook',
        payload: { ...crmRefPayload, from: prevValue, to: nextValue },
        value_amount: nextValue,
      })
    }
  }

  if ('is_won' in next && next.is_won && !prev?.is_won) {
    events.push({
      tenant_id: tenantId,
      subject_urn: subjectUrn,
      event_type: 'deal_closed_won',
      source: 'hubspot_webhook',
      payload: { ...crmRefPayload, stage: (next.stage as string | null) ?? prev?.stage ?? null },
      value_amount: Number((next.value as number | null) ?? prev?.value ?? 0),
    })
  }

  if (
    'is_closed' in next &&
    next.is_closed &&
    !next.is_won &&
    !prev?.is_closed
  ) {
    events.push({
      tenant_id: tenantId,
      subject_urn: subjectUrn,
      event_type: 'deal_closed_lost',
      source: 'hubspot_webhook',
      payload: { ...crmRefPayload, stage: (next.stage as string | null) ?? prev?.stage ?? null },
      value_amount: Number((next.value as number | null) ?? prev?.value ?? 0),
    })
  }

  return events
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const hubspotSecret = process.env.HUBSPOT_CLIENT_SECRET
  if (!hubspotSecret) {
    console.error('[webhooks/hubspot-properties] HUBSPOT_CLIENT_SECRET not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  if (!verifyHubSpotSignature(request, rawBody, hubspotSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let events: HubSpotSubscriptionEvent[]
  try {
    const parsed = JSON.parse(rawBody)
    events = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const propertyEvents = events.filter(
    (e) =>
      e.subscriptionType === 'deal.propertyChange' ||
      e.subscriptionType === 'contact.propertyChange' ||
      e.subscriptionType === 'company.propertyChange',
  )

  if (propertyEvents.length === 0) {
    return NextResponse.json({ message: 'No property-change events' })
  }

  const supabase = getServiceSupabase()
  let processed = 0
  let skipped = 0
  let unmapped = 0

  for (const event of propertyEvents) {
    if (!event.portalId || !event.objectId || !event.propertyName) {
      skipped++
      continue
    }

    const target = resolveTarget(event.subscriptionType)
    if (!target) {
      skipped++
      continue
    }

    const setter = target.propertyMap[event.propertyName]
    if (!setter) {
      // Tenant-specific custom property — no canonical column to update.
      // Phase 4's field_mapping_registry will handle these.
      unmapped++
      continue
    }

    const tenantId = await resolveTenantByPortal(supabase, event.portalId)
    if (!tenantId) {
      skipped++
      continue
    }

    const idempotencyKey = `hubspot-properties:${event.portalId}:${event.eventId ?? `${event.objectId}:${event.propertyName}:${event.occurredAt}`}`
    if (
      await isAlreadyProcessed(supabase, {
        tenantId,
        idempotencyKey,
        webhookType: 'hubspot_properties',
      })
    ) {
      skipped++
      continue
    }

    const transformedValue =
      event.propertyValue == null
        ? null
        : setter.transform
          ? setter.transform(String(event.propertyValue))
          : String(event.propertyValue)

    const crmId = String(event.objectId)

    try {
      // For deals, fetch the prior values so we can emit outcome events
      // BEFORE the update. The update itself is a focused one-column
      // patch; the outcome diff compares prior canonical state vs the
      // new property value.
      let prevForOutcome: { stage?: string | null; value?: number | null; is_won?: boolean | null; is_closed?: boolean | null } | null = null
      if (target.emitOutcomes) {
        const { data: prev } = await supabase
          .from(target.tableName)
          .select('id, stage, value, is_won, is_closed')
          .eq('tenant_id', tenantId)
          .eq('crm_id', crmId)
          .maybeSingle()
        prevForOutcome = prev
      }

      // Focused update — only the changed column + last_crm_sync. Avoids
      // the chattier "fetch-full-record-and-upsert" path and keeps the
      // sync metadata honest.
      const { error: updateErr } = await supabase
        .from(target.tableName)
        .update({
          [setter.column]: transformedValue,
          last_crm_sync: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .eq('crm_id', crmId)

      if (updateErr) {
        // Row doesn't exist yet — this can happen if the webhook arrives
        // before the first cron/sync. Skip; the next cron run will pick
        // it up.
        skipped++
        await recordWebhookDelivery(supabase, {
          tenantId,
          idempotencyKey,
          webhookType: 'hubspot_properties',
          resultId: 'row_not_found',
        })
        continue
      }

      // Outcome events for deal-level changes. Same shape as cron/sync
      // emits so the attribution workflow doesn't need to know the
      // source. Pull the canonical Postgres id off the prevForOutcome
      // row (we just fetched it above) so the URN is canonical.
      if (target.emitOutcomes) {
        const nextForOutcome: Record<string, unknown> = {
          [setter.column]: transformedValue,
        }
        const oppId = (prevForOutcome as { id?: string } | null)?.id ?? null
        const outcomeEvents = diffOppForOutcomes(
          tenantId,
          oppId,
          crmId,
          prevForOutcome,
          nextForOutcome,
        )
        for (const e of outcomeEvents) {
          await emitOutcomeEvent(supabase, e)
        }
      }

      await recordWebhookDelivery(supabase, {
        tenantId,
        idempotencyKey,
        webhookType: 'hubspot_properties',
        resultId: `${target.outcomeUrnType}:${crmId}:${setter.column}`,
      })

      processed++
    } catch (err) {
      console.error('[webhooks/hubspot-properties] event processing failed', err)
      // Don't return non-2xx — HubSpot would retry the whole batch and we
      // want partial success to stick. Already-processed events from a
      // retried batch are deduped via the idempotency key.
    }
  }

  return NextResponse.json({ processed, skipped, unmapped })
}
