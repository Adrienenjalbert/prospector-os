import type { SupabaseClient } from '@supabase/supabase-js'
import { HubSpotAdapter } from '@prospector/adapters'
import { parseUrn } from '@prospector/core'
import { decryptCredentials, isEncryptedString } from '@/lib/crypto'

/**
 * Phase 3 T3.1 — CRM-write executor.
 *
 * The agent path no longer calls HubSpot directly (see T3.1 in
 * `02-proposal.md`). Instead, the agent stages a row in
 * `pending_crm_writes` and the user clicks `[DO]` to approve. THIS
 * executor is what runs at approval time:
 *
 *   - It receives the `pending_crm_writes` row.
 *   - It re-resolves the tenant's CRM credentials + target object.
 *   - It performs the actual HubSpot mutation.
 *   - It returns `{ external_record_id, citations }` so the
 *     `/api/agent/approve` endpoint can persist the id back on the
 *     pending row + cite the new CRM record in its response.
 *
 * Why a separate file vs inline in the API route?
 *
 *   - The same executor is reachable from a future cron sweep that
 *     would re-try `approved` rows that hit a transient HubSpot
 *     5xx. Today the route fires synchronously; the cron path is
 *     not in T3.1 scope but the executor's interface is built so
 *     adding it is a one-file change.
 *   - Keeps the route file thin (auth + routing only) so it's
 *     easier to audit.
 *   - Lets the unit tests exercise execution shapes without
 *     spinning up a request fixture.
 *
 * The executor is intentionally NOT a workflow. Approval is
 * synchronous — the rep clicks `[DO]` and expects the chat to
 * confirm within a couple of seconds. A workflow round-trip would
 * blow that latency budget. If a single execution legitimately
 * needs to wait (e.g. for HubSpot rate-limit backoff), the
 * executor returns a structured error and the route surfaces it;
 * the rep can re-click after the cooldown.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ExecutorTarget =
  | { ok: true; type: 'company' | 'deal' | 'contact'; id: string; crmId: string; urn: string }
  | { ok: false; error: string }

export interface ExecutorCitation {
  claim_text: string
  source_type: string
  source_id?: string
  source_url?: string
}

export type ExecutorResult =
  | {
      ok: true
      external_record_id: string
      data: Record<string, unknown>
      citations: ExecutorCitation[]
    }
  | { ok: false; error: string }

export interface PendingWriteRow {
  id: string
  tenant_id: string
  tool_slug: string
  target_urn: string
  proposed_args: Record<string, unknown>
}

/**
 * Execute one approved write. Re-validates everything (target
 * exists, credentials present) before calling HubSpot — the
 * approval endpoint trusts the executor to be the single source
 * of truth for "is this write actually safe to fire?", so we
 * don't trust the staged row blindly.
 */
export async function executePendingWrite(
  supabase: SupabaseClient,
  row: PendingWriteRow,
): Promise<ExecutorResult> {
  const targetRes = await resolveTarget(supabase, row.tenant_id, row.target_urn)
  if (!targetRes.ok) {
    return { ok: false, error: targetRes.error }
  }
  const target = targetRes
  if (!target.crmId) {
    return {
      ok: false,
      error: `Target ${target.urn} has no crm_id — record not synced from CRM yet`,
    }
  }

  const crmRes = await getHubspotClient(supabase, row.tenant_id)
  if (!crmRes.ok) return { ok: false, error: crmRes.error }
  const client = crmRes.client

  switch (row.tool_slug) {
    case 'log_crm_activity':
      return executeLogActivity(client, target, row.proposed_args)
    case 'update_crm_property':
      return executeUpdateProperty(client, target, row.proposed_args)
    case 'create_crm_task':
      return executeCreateTask(client, supabase, row.tenant_id, row.proposed_args)
    default:
      return {
        ok: false,
        error: `Unknown tool_slug: ${row.tool_slug}`,
      }
  }
}

// ---------------------------------------------------------------------------
// Per-tool execution
// ---------------------------------------------------------------------------

async function executeLogActivity(
  client: HubSpotAdapter,
  target: Extract<ExecutorTarget, { ok: true }>,
  args: Record<string, unknown>,
): Promise<ExecutorResult> {
  const activityType = String(args.activity_type ?? 'note') as
    | 'note'
    | 'call'
    | 'email'
    | 'meeting'
  const body = String(args.body ?? '')
  const associations = {
    companyId: target.type === 'company' ? target.crmId : undefined,
    dealId: target.type === 'deal' ? target.crmId : undefined,
    contactId: target.type === 'contact' ? target.crmId : undefined,
  }
  const extra: Record<string, unknown> = {}
  if (
    typeof args.duration_minutes === 'number' &&
    (activityType === 'call' || activityType === 'meeting')
  ) {
    extra[`hs_${activityType}_duration`] = args.duration_minutes * 60_000
  }
  try {
    const newId = await client.createEngagement(activityType, body, associations, extra)
    return {
      ok: true,
      external_record_id: newId,
      data: {
        activity_type: activityType,
        target_urn: target.urn,
        new_record_id: newId,
      },
      citations: [
        {
          claim_text: `${activityType} logged on ${target.type}`,
          source_type: activityType,
          source_id: newId,
          source_url: HubSpotAdapter.buildRecordUrl(activityType as 'note', newId),
        },
        {
          claim_text: `Target ${target.type}`,
          source_type: target.type,
          source_id: target.id,
        },
      ],
    }
  } catch (err) {
    return {
      ok: false,
      error: `HubSpot createEngagement failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function executeUpdateProperty(
  client: HubSpotAdapter,
  target: Extract<ExecutorTarget, { ok: true }>,
  args: Record<string, unknown>,
): Promise<ExecutorResult> {
  const property = String(args.property ?? '')
  const value = args.value as string | number | boolean | null
  const entityKey =
    target.type === 'deal' ? 'deals' : target.type === 'company' ? 'companies' : 'contacts'
  try {
    await client.write(entityKey, {
      id: target.crmId,
      [property]: value,
    })
    return {
      ok: true,
      external_record_id: target.crmId,
      data: {
        target_urn: target.urn,
        property,
        value,
      },
      citations: [
        {
          claim_text: `${target.type} property update: ${property}`,
          source_type: target.type,
          source_id: target.id,
          source_url: HubSpotAdapter.buildRecordUrl(target.type, target.crmId),
        },
      ],
    }
  } catch (err) {
    return {
      ok: false,
      error: `HubSpot property update failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function executeCreateTask(
  client: HubSpotAdapter,
  supabase: SupabaseClient,
  tenantId: string,
  args: Record<string, unknown>,
): Promise<ExecutorResult> {
  // create_crm_task uses `related_to_urn` (optional) instead of the
  // staging-time `target_urn`. The staging handler stores the task's
  // own subject as the target_urn for surfacing in the chip; the
  // related_to_urn is the actual association.
  const subject = String(args.subject ?? '')
  const body = typeof args.body === 'string' ? args.body : undefined
  const dueDate = typeof args.due_date_iso === 'string' ? args.due_date_iso : undefined
  const priority = (args.priority as 'LOW' | 'MEDIUM' | 'HIGH' | undefined) ?? 'MEDIUM'

  let association:
    | { type: 'deal'; crmId: string; id: string; urn: string }
    | { type: 'company'; crmId: string; id: string; urn: string }
    | { type: 'contact'; crmId: string; id: string; urn: string }
    | null = null

  const relatedUrn = typeof args.related_to_urn === 'string' ? args.related_to_urn : null
  if (relatedUrn) {
    const t = await resolveTarget(supabase, tenantId, relatedUrn)
    if (!t.ok) return { ok: false, error: t.error }
    if (!t.crmId) {
      return { ok: false, error: `Target ${t.urn} has no crm_id` }
    }
    association = { type: t.type, crmId: t.crmId, id: t.id, urn: t.urn }
  }

  try {
    const newId = await client.createTask({
      subject,
      body,
      dueDate,
      priority,
      companyId: association?.type === 'company' ? association.crmId : undefined,
      dealId: association?.type === 'deal' ? association.crmId : undefined,
      contactId: association?.type === 'contact' ? association.crmId : undefined,
    })
    const citations: ExecutorCitation[] = [
      {
        claim_text: `Task created: ${subject}`,
        source_type: 'task',
        source_id: newId,
        source_url: HubSpotAdapter.buildRecordUrl('task', newId),
      },
    ]
    if (association) {
      citations.push({
        claim_text: `Associated ${association.type}`,
        source_type: association.type,
        source_id: association.id,
      })
    }
    return {
      ok: true,
      external_record_id: newId,
      data: {
        subject,
        new_record_id: newId,
        related_to_urn: association?.urn ?? null,
        due_date_iso: dueDate ?? null,
        priority,
      },
      citations,
    }
  } catch (err) {
    return {
      ok: false,
      error: `HubSpot createTask failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Shared helpers (mirror the originals from crm-write.ts)
// ---------------------------------------------------------------------------

async function resolveTarget(
  supabase: SupabaseClient,
  tenantId: string,
  rawUrn: string,
): Promise<ExecutorTarget> {
  const parsed = parseUrn(rawUrn)
  if (!parsed) return { ok: false, error: `Invalid URN: ${rawUrn}` }

  if (parsed.type === 'company') {
    const { data } = await supabase
      .from('companies')
      .select('id, crm_id')
      .eq('tenant_id', tenantId)
      .eq('id', parsed.id)
      .maybeSingle()
    if (!data) return { ok: false, error: `Company ${parsed.id} not found` }
    return {
      ok: true,
      type: 'company',
      id: data.id as string,
      crmId: data.crm_id as string,
      urn: rawUrn,
    }
  }
  if (parsed.type === 'deal' || parsed.type === 'opportunity') {
    const { data } = await supabase
      .from('opportunities')
      .select('id, crm_id')
      .eq('tenant_id', tenantId)
      .eq('id', parsed.id)
      .maybeSingle()
    if (!data) return { ok: false, error: `Deal ${parsed.id} not found` }
    return {
      ok: true,
      type: 'deal',
      id: data.id as string,
      crmId: data.crm_id as string,
      urn: rawUrn,
    }
  }
  if (parsed.type === 'contact') {
    const { data } = await supabase
      .from('contacts')
      .select('id, crm_id')
      .eq('tenant_id', tenantId)
      .eq('id', parsed.id)
      .maybeSingle()
    if (!data) return { ok: false, error: `Contact ${parsed.id} not found` }
    return {
      ok: true,
      type: 'contact',
      id: data.id as string,
      crmId: data.crm_id as string,
      urn: rawUrn,
    }
  }
  return { ok: false, error: `Unsupported URN type: ${parsed.type}` }
}

async function getHubspotClient(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ ok: true; client: HubSpotAdapter } | { ok: false; error: string }> {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('crm_type, crm_credentials_encrypted')
    .eq('id', tenantId)
    .single()
  if (!tenant) return { ok: false, error: 'Tenant not found' }
  if (tenant.crm_type !== 'hubspot') {
    return {
      ok: false,
      error: `CRM write-back currently only supports HubSpot tenants (got ${tenant.crm_type}). Salesforce parity is on the roadmap.`,
    }
  }
  const rawCreds = (tenant as { crm_credentials_encrypted: unknown })
    .crm_credentials_encrypted
  if (!rawCreds) {
    return { ok: false, error: 'CRM credentials missing for this tenant' }
  }
  // Mirrors the original handlers' pattern. T1.4 (PR #4) introduces
  // a strict resolver that replaces this branch with a single
  // `await resolveCredentials(rawCreds)`. The merge with PR #4 is
  // mechanical — both branches arrive at the same private_app_token
  // string at this point.
  let creds: Record<string, string>
  try {
    creds = isEncryptedString(rawCreds)
      ? (decryptCredentials(rawCreds) as Record<string, string>)
      : (rawCreds as Record<string, string>)
  } catch (err) {
    return {
      ok: false,
      error: `CRM credentials unreadable: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }
  if (!creds.private_app_token) {
    return { ok: false, error: 'HubSpot private_app_token missing' }
  }
  return {
    ok: true,
    client: new HubSpotAdapter({ private_app_token: creds.private_app_token }),
  }
}
