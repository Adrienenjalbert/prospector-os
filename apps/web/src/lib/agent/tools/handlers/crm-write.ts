import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { HubSpotAdapter } from '@prospector/adapters'
import { parseUrn } from '@prospector/core'
import { resolveCredentials } from '@/lib/crypto'
import type { ToolHandler } from '../../tool-loader'

/**
 * CRM write-back tools — Phase 3.6. Three sibling tools that close the
 * recommendation→action loop:
 *
 *   - log_crm_activity     — drop a note/call/email/meeting record on a
 *                            deal/company/contact.
 *   - update_crm_property  — set one property on a deal/company/contact.
 *   - create_crm_task      — schedule a follow-up task with optional
 *                            owner + due date + association.
 *
 * All three are marked `mutates_crm: true` in the tool_registry seed so
 * the existing `writeApprovalGate` middleware blocks the call until the
 * agent re-invokes it with an `approval_token` argument. The agent
 * surfaces the first call as a `[DO]` chip; the rep clicks it; the
 * SuggestedActions UI re-invokes with a token.
 *
 * Each tool returns a citation pointing at the just-written CRM record
 * so the next turn's `current-deal-health` slice already shows the
 * change. Cite-or-shut-up holds: every claim about a CRM mutation
 * cites the URN of what was mutated.
 *
 * Salesforce parity is deferred — the adapter interface is in place but
 * SalesforceAdapter doesn't yet have `createEngagement`/`createTask`.
 * The tools error out cleanly on Salesforce tenants for now.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface ResolvedTarget {
  /** Canonical URN string (returned in citations). */
  urn: string
  /** Canonical Postgres id for tenant-scoped queries. */
  id: string
  /** HubSpot record id (the value the API expects in URLs). */
  crmId: string | null
  type: 'company' | 'deal' | 'contact'
}

type ResolveResult =
  | { ok: true; target: ResolvedTarget }
  | { ok: false; error: string }

async function resolveTarget(
  supabase: SupabaseClient,
  tenantId: string,
  rawUrn: string,
): Promise<ResolveResult> {
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
      target: { urn: rawUrn, id: data.id, crmId: data.crm_id, type: 'company' },
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
      target: { urn: rawUrn, id: data.id, crmId: data.crm_id, type: 'deal' },
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
      target: { urn: rawUrn, id: data.id, crmId: data.crm_id, type: 'contact' },
    }
  }
  return { ok: false, error: `Unsupported URN type: ${parsed.type}` }
}

type CrmClient =
  | { ok: true; client: HubSpotAdapter }
  | { ok: false; error: string }

async function getCrmClient(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<CrmClient> {
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('crm_type, crm_credentials_encrypted')
    .eq('id', tenantId)
    .single()
  if (error || !tenant) {
    return { ok: false, error: 'Tenant not found' }
  }
  if (tenant.crm_type !== 'hubspot') {
    // Salesforce write parity is on the Phase-4 list. Tools error cleanly
    // until then so the agent surfaces the limitation honestly.
    return {
      ok: false,
      error: `CRM write-back tools currently only support HubSpot tenants (got ${tenant.crm_type}). Salesforce parity is on the roadmap.`,
    }
  }
  const rawCreds = (tenant as { crm_credentials_encrypted: unknown })
    .crm_credentials_encrypted
  // resolveCredentials throws on legacy plaintext / missing / corrupt
  // — agent-tool callers want a clean { ok, error } shape, so catch
  // and surface the actionable message back to the agent (it will
  // recommend the rep contact admin / re-onboard).
  let creds: Record<string, string>
  try {
    creds = resolveCredentials(rawCreds)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (!creds.private_app_token) {
    return { ok: false, error: 'HubSpot private_app_token missing' }
  }
  return { ok: true, client: new HubSpotAdapter({ private_app_token: creds.private_app_token }) }
}

// ---------------------------------------------------------------------------
// log_crm_activity
// ---------------------------------------------------------------------------

export const logCrmActivitySchema = z.object({
  target_urn: z
    .string()
    .describe(
      'URN of the deal/company/contact to associate the engagement with (e.g. urn:rev:deal:abc).',
    ),
  activity_type: z
    .enum(['note', 'call', 'email', 'meeting'])
    .describe('Engagement type — note is the safe default for written observations.'),
  body: z
    .string()
    .min(1)
    .describe('Body text of the engagement. For calls/meetings, summarise outcomes; for notes, capture the observation.'),
  duration_minutes: z
    .number()
    .optional()
    .describe('Optional duration for calls/meetings.'),
  approval_token: z
    .string()
    .optional()
    .describe('Approval token from the [DO] chip. The first invocation returns awaiting_approval; the rep clicks the chip; the UI re-invokes with this token.'),
})

export const logCrmActivityHandler: ToolHandler = {
  slug: 'log_crm_activity',
  schema: logCrmActivitySchema,
  build: (ctx) => async (rawArgs) => {
    const args = rawArgs as z.infer<typeof logCrmActivitySchema>

    const targetRes = await resolveTarget(ctx.supabase, ctx.tenantId, args.target_urn)
    if (!targetRes.ok) return { data: null, error: targetRes.error, citations: [] }
    const { target } = targetRes
    if (!target.crmId) {
      return {
        data: null,
        error: `Target ${target.urn} has no crm_id — record not synced from CRM yet`,
        citations: [],
      }
    }

    const crmRes = await getCrmClient(ctx.supabase, ctx.tenantId)
    if (!crmRes.ok) return { data: null, error: crmRes.error, citations: [] }

    const associations = {
      companyId: target.type === 'company' ? target.crmId : undefined,
      dealId: target.type === 'deal' ? target.crmId : undefined,
      contactId: target.type === 'contact' ? target.crmId : undefined,
    }

    const extra: Record<string, unknown> = {}
    if (args.duration_minutes && (args.activity_type === 'call' || args.activity_type === 'meeting')) {
      extra[`hs_${args.activity_type}_duration`] = args.duration_minutes * 60_000
    }

    try {
      const newId = await crmRes.client.createEngagement(
        args.activity_type,
        args.body,
        associations,
        extra,
      )
      return {
        data: {
          activity_type: args.activity_type,
          target_urn: target.urn,
          new_record_id: newId,
        },
        citations: [
          {
            claim_text: `${args.activity_type} logged on ${target.type}`,
            source_type: args.activity_type,
            source_id: newId,
            source_url: HubSpotAdapter.buildRecordUrl(args.activity_type as 'note', newId),
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
        data: null,
        error: `HubSpot createEngagement failed: ${err instanceof Error ? err.message : String(err)}`,
        citations: [],
      }
    }
  },
}

// ---------------------------------------------------------------------------
// update_crm_property
// ---------------------------------------------------------------------------

export const updateCrmPropertySchema = z.object({
  target_urn: z
    .string()
    .describe('URN of the deal/company/contact to update.'),
  property: z
    .string()
    .min(1)
    .describe('HubSpot property name (e.g. dealstage, amount, hs_meddpicc_champion_email).'),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .describe('New value. Strings/numbers go through unchanged; null clears the property.'),
  approval_token: z.string().optional(),
})

export const updateCrmPropertyHandler: ToolHandler = {
  slug: 'update_crm_property',
  schema: updateCrmPropertySchema,
  build: (ctx) => async (rawArgs) => {
    const args = rawArgs as z.infer<typeof updateCrmPropertySchema>

    const targetRes = await resolveTarget(ctx.supabase, ctx.tenantId, args.target_urn)
    if (!targetRes.ok) return { data: null, error: targetRes.error, citations: [] }
    const { target } = targetRes
    if (!target.crmId) {
      return {
        data: null,
        error: `Target ${target.urn} has no crm_id — record not synced from CRM yet`,
        citations: [],
      }
    }

    const crmRes = await getCrmClient(ctx.supabase, ctx.tenantId)
    if (!crmRes.ok) return { data: null, error: crmRes.error, citations: [] }

    const entityKey = target.type === 'deal' ? 'deals' : target.type === 'company' ? 'companies' : 'contacts'

    try {
      await crmRes.client.write(entityKey, {
        id: target.crmId,
        [args.property]: args.value,
      })
      return {
        data: {
          target_urn: target.urn,
          property: args.property,
          value: args.value,
        },
        citations: [
          {
            claim_text: `${target.type} property update: ${args.property}`,
            source_type: target.type,
            source_id: target.id,
            source_url: HubSpotAdapter.buildRecordUrl(target.type, target.crmId),
          },
        ],
      }
    } catch (err) {
      return {
        data: null,
        error: `HubSpot property update failed: ${err instanceof Error ? err.message : String(err)}`,
        citations: [],
      }
    }
  },
}

// ---------------------------------------------------------------------------
// create_crm_task
// ---------------------------------------------------------------------------

export const createCrmTaskSchema = z.object({
  subject: z.string().min(1).describe('Short subject line for the task.'),
  body: z.string().optional().describe('Optional richer description.'),
  due_date_iso: z
    .string()
    .optional()
    .describe('ISO 8601 timestamp for the task due date. Omit for no due date.'),
  priority: z
    .enum(['LOW', 'MEDIUM', 'HIGH'])
    .optional()
    .describe('Task priority — defaults to MEDIUM.'),
  related_to_urn: z
    .string()
    .optional()
    .describe('Optional URN to associate the task with (deal/company/contact).'),
  approval_token: z.string().optional(),
})

export const createCrmTaskHandler: ToolHandler = {
  slug: 'create_crm_task',
  schema: createCrmTaskSchema,
  build: (ctx) => async (rawArgs) => {
    const args = rawArgs as z.infer<typeof createCrmTaskSchema>

    let association:
      | { type: 'deal'; crmId: string; id: string; urn: string }
      | { type: 'company'; crmId: string; id: string; urn: string }
      | { type: 'contact'; crmId: string; id: string; urn: string }
      | null = null
    if (args.related_to_urn) {
      const targetRes = await resolveTarget(
        ctx.supabase,
        ctx.tenantId,
        args.related_to_urn,
      )
      if (!targetRes.ok) {
        return { data: null, error: targetRes.error, citations: [] }
      }
      if (!targetRes.target.crmId) {
        return {
          data: null,
          error: `Target ${targetRes.target.urn} has no crm_id`,
          citations: [],
        }
      }
      association = {
        type: targetRes.target.type,
        crmId: targetRes.target.crmId,
        id: targetRes.target.id,
        urn: targetRes.target.urn,
      }
    }

    const crmRes = await getCrmClient(ctx.supabase, ctx.tenantId)
    if (!crmRes.ok) return { data: null, error: crmRes.error, citations: [] }

    try {
      const newId = await crmRes.client.createTask({
        subject: args.subject,
        body: args.body,
        dueDate: args.due_date_iso,
        priority: args.priority ?? 'MEDIUM',
        companyId: association?.type === 'company' ? association.crmId : undefined,
        dealId: association?.type === 'deal' ? association.crmId : undefined,
        contactId: association?.type === 'contact' ? association.crmId : undefined,
      })

      const citations: Array<{
        claim_text: string
        source_type: string
        source_id?: string
        source_url?: string
      }> = [
        {
          claim_text: `Task created: ${args.subject}`,
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
        data: {
          subject: args.subject,
          new_record_id: newId,
          related_to_urn: association?.urn ?? null,
          due_date_iso: args.due_date_iso ?? null,
          priority: args.priority ?? 'MEDIUM',
        },
        citations,
      }
    } catch (err) {
      return {
        data: null,
        error: `HubSpot createTask failed: ${err instanceof Error ? err.message : String(err)}`,
        citations: [],
      }
    }
  },
}
