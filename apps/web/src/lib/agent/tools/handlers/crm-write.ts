import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseUrn } from '@prospector/core'
import type { ToolHandler } from '../../tool-loader'

/**
 * CRM write-back tools — Phase 3 T3.1 (rewrite of original Phase 3.6).
 *
 * The agent path NEVER calls HubSpot directly anymore. Instead, every
 * write-back tool STAGES a row in `pending_crm_writes` and returns
 * `{ pending_id, status: 'pending', summary }` to the agent. The
 * agent surfaces the proposal as a `[DO]` chip; the rep clicks it;
 * `/api/agent/approve` flips the row to `approved` + executes the
 * actual HubSpot call via `lib/crm-writes/executor.ts`.
 *
 * Why STAGE-only?
 *
 *   - **Trust boundary.** Before T3.1 the model literally held the
 *     ability to mutate CRM state mid-turn (gated only by a
 *     pre-flight middleware that checked for an `approval_token`
 *     argument — and the model could fabricate that token). T1.1
 *     fail-closed-everywhere fixed the symptom; T3.1 fixes the cause:
 *     the staging table is the architectural enforcement.
 *
 *   - **Auditability.** Every staged row is a durable record of "the
 *     model proposed this write at this time on behalf of this user
 *     in this conversation". Approvals + executions persist on the
 *     same row. A future auditor reads `pending_crm_writes` joined
 *     with `admin_audit_log` to reconstruct any mutation.
 *
 *   - **Reversibility.** A `pending` or `approved` row that hasn't
 *     executed yet can be cancelled by the rep / by an admin / by the
 *     24h TTL — without ever touching HubSpot.
 *
 *   - **Decoupling.** The executor moved to `lib/crm-writes/executor.ts`
 *     so a future cron retry path can re-run failed approvals
 *     without rebuilding the agent context.
 *
 * Each handler returns a citation pointing at the **pending row** so
 * the agent can quote it back ("staged write #abc"). After approval,
 * the approve endpoint's response cites the actual CRM record id.
 *
 * Salesforce parity is still deferred — the staging path is
 * provider-agnostic but `executor.ts` only knows HubSpot today.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Cap on the JSONB blob we'll persist as `proposed_args`. Mirrors the
 *  admin-config payload cap; protects the table from a malicious or
 *  runaway prompt staging a megabyte of garbage. */
const MAX_PROPOSED_ARGS_BYTES = 64 * 1024

interface StageInput {
  supabase: SupabaseClient
  tenantId: string
  userId: string | null
  interactionId: string | null
  toolSlug: string
  targetUrn: string
  proposedArgs: Record<string, unknown>
  /** Human-readable summary for the agent + chip text. */
  summary: string
}

interface StageOutput {
  pending_id: string
  status: 'pending'
  summary: string
  expires_at: string
  /** Hint for the agent — what UI affordance to surface. */
  next_action: string
}

/**
 * The shared staging helper. Validates the URN, ensures the target
 * exists in this tenant, caps the args size, and inserts the row.
 * Returns either the staged shape or a tool-shaped `{ data, error,
 * citations }` so the handlers can short-circuit.
 */
async function stagePendingWrite(
  input: StageInput,
): Promise<{ ok: true; row: StageOutput } | { ok: false; error: string }> {
  // URN parse + tenant-scoped existence check. Without this, a
  // malicious prompt could stage a write against a deal id that
  // belongs to another tenant; the executor would catch it at
  // approval time, but better to fail at staging.
  const parsed = parseUrn(input.targetUrn)
  if (!parsed) return { ok: false, error: `Invalid URN: ${input.targetUrn}` }

  const table =
    parsed.type === 'company'
      ? 'companies'
      : parsed.type === 'deal' || parsed.type === 'opportunity'
        ? 'opportunities'
        : parsed.type === 'contact'
          ? 'contacts'
          : null

  if (!table) {
    return { ok: false, error: `Unsupported URN type for write: ${parsed.type}` }
  }

  const { data: target, error: targetErr } = await input.supabase
    .from(table)
    .select('id, crm_id')
    .eq('tenant_id', input.tenantId)
    .eq('id', parsed.id)
    .maybeSingle()
  if (targetErr) {
    return { ok: false, error: `Lookup failed: ${targetErr.message}` }
  }
  if (!target) {
    return { ok: false, error: `${parsed.type} ${parsed.id} not found in this tenant` }
  }

  // Size cap. JSON.stringify is the cheap way to measure JSONB size.
  let argsBytes = 0
  try {
    argsBytes = JSON.stringify(input.proposedArgs).length
  } catch {
    return { ok: false, error: 'proposed_args is not JSON-serialisable' }
  }
  if (argsBytes > MAX_PROPOSED_ARGS_BYTES) {
    return {
      ok: false,
      error: `proposed_args too large (${argsBytes} bytes; cap ${MAX_PROPOSED_ARGS_BYTES})`,
    }
  }

  const { data: row, error: insertErr } = await input.supabase
    .from('pending_crm_writes')
    .insert({
      tenant_id: input.tenantId,
      requested_by_user_id: input.userId,
      agent_interaction_id: input.interactionId,
      tool_slug: input.toolSlug,
      target_urn: input.targetUrn,
      proposed_args: input.proposedArgs,
      // status defaults to 'pending'; expires_at defaults to NOW + 24h.
    })
    .select('id, expires_at')
    .single()

  if (insertErr || !row) {
    return {
      ok: false,
      error: `Could not stage write: ${insertErr?.message ?? 'unknown error'}`,
    }
  }

  return {
    ok: true,
    row: {
      pending_id: row.id as string,
      status: 'pending',
      summary: input.summary,
      expires_at: row.expires_at as string,
      next_action: `Surface this proposal to the user as a [DO] chip with text: "${input.summary}". On click, POST { pending_id: "${row.id}" } to /api/agent/approve.`,
    },
  }
}

/**
 * Build the citations a staging tool returns. Always cites the
 * pending row + the target object — the citation enforcer middleware
 * needs at least one citation, and these are the two URNs the agent
 * can verify in its next turn.
 */
function stagingCitations(
  pendingId: string,
  targetUrn: string,
  type: string,
): Array<{
  claim_text: string
  source_type: string
  source_id?: string
  source_url?: string
}> {
  return [
    {
      claim_text: 'Staged write awaiting approval',
      source_type: 'pending_crm_write',
      source_id: pendingId,
    },
    {
      claim_text: `Target ${type}`,
      source_type: type,
      source_id: parseUrn(targetUrn)?.id,
    },
  ]
}

// ---------------------------------------------------------------------------
// log_crm_activity — STAGE only
// ---------------------------------------------------------------------------

export const logCrmActivitySchema = z.object({
  target_urn: z
    .string()
    .describe('URN of the deal/company/contact to associate the engagement with (e.g. urn:rev:deal:abc).'),
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
  // Phase 3 T3.1 — `approval_token` is no longer accepted. The
  // staging→approval split makes it obsolete; left as an optional
  // ignored field for one release so older agent prompts don't hard-
  // fail at validation. Remove in T3.2 once all agents have rolled
  // over to the new shape.
  approval_token: z
    .string()
    .optional()
    .describe('DEPRECATED. Ignored. The staging→approval split replaces the token mechanism.'),
})

export const logCrmActivityHandler: ToolHandler = {
  slug: 'log_crm_activity',
  schema: logCrmActivitySchema,
  build: (ctx) => async (rawArgs) => {
    const args = rawArgs as z.infer<typeof logCrmActivitySchema>

    const summary = `${args.activity_type === 'note' ? 'Note' : args.activity_type[0].toUpperCase() + args.activity_type.slice(1)} on ${args.target_urn}: ${args.body.slice(0, 80)}${args.body.length > 80 ? '…' : ''}`

    const staged = await stagePendingWrite({
      supabase: ctx.supabase,
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      interactionId: ctx.interactionId ?? null,
      toolSlug: 'log_crm_activity',
      targetUrn: args.target_urn,
      proposedArgs: {
        activity_type: args.activity_type,
        body: args.body,
        duration_minutes: args.duration_minutes ?? null,
      },
      summary,
    })

    if (!staged.ok) {
      return { data: null, error: staged.error, citations: [] }
    }

    return {
      data: staged.row,
      citations: stagingCitations(
        staged.row.pending_id,
        args.target_urn,
        parseUrn(args.target_urn)?.type ?? 'unknown',
      ),
    }
  },
}

// ---------------------------------------------------------------------------
// update_crm_property — STAGE only
// ---------------------------------------------------------------------------

export const updateCrmPropertySchema = z.object({
  target_urn: z.string().describe('URN of the deal/company/contact to update.'),
  property: z
    .string()
    .min(1)
    .describe('HubSpot property name (e.g. dealstage, amount, hs_meddpicc_champion_email).'),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .describe('New value. Strings/numbers go through unchanged; null clears the property.'),
  approval_token: z.string().optional().describe('DEPRECATED. Ignored.'),
})

export const updateCrmPropertyHandler: ToolHandler = {
  slug: 'update_crm_property',
  schema: updateCrmPropertySchema,
  build: (ctx) => async (rawArgs) => {
    const args = rawArgs as z.infer<typeof updateCrmPropertySchema>

    const valueText =
      args.value === null
        ? '(clear)'
        : typeof args.value === 'string'
          ? `"${args.value.slice(0, 60)}"`
          : String(args.value)
    const summary = `Set ${args.property} = ${valueText} on ${args.target_urn}`

    const staged = await stagePendingWrite({
      supabase: ctx.supabase,
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      interactionId: ctx.interactionId ?? null,
      toolSlug: 'update_crm_property',
      targetUrn: args.target_urn,
      proposedArgs: {
        property: args.property,
        value: args.value,
      },
      summary,
    })

    if (!staged.ok) {
      return { data: null, error: staged.error, citations: [] }
    }

    return {
      data: staged.row,
      citations: stagingCitations(
        staged.row.pending_id,
        args.target_urn,
        parseUrn(args.target_urn)?.type ?? 'unknown',
      ),
    }
  },
}

// ---------------------------------------------------------------------------
// create_crm_task — STAGE only
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
  approval_token: z.string().optional().describe('DEPRECATED. Ignored.'),
})

export const createCrmTaskHandler: ToolHandler = {
  slug: 'create_crm_task',
  schema: createCrmTaskSchema,
  build: (ctx) => async (rawArgs) => {
    const args = rawArgs as z.infer<typeof createCrmTaskSchema>

    // create_crm_task doesn't have an obvious `target_urn` — its
    // primary effect is a standalone task. We use `related_to_urn`
    // when present, otherwise stage with a synthetic
    // `urn:rev:tenant:<id>` that the executor will treat as "no
    // association". Synthetic URN keeps the NOT NULL constraint
    // happy without polluting the namespace.
    const targetUrn =
      args.related_to_urn ?? `urn:rev:standalone:task:${ctx.tenantId}`

    const summary = `Create task "${args.subject.slice(0, 60)}"${
      args.due_date_iso ? ` due ${args.due_date_iso.slice(0, 10)}` : ''
    }${args.related_to_urn ? ` on ${args.related_to_urn}` : ''}`

    // Tasks with no related_to_urn skip the tenant-scoped target
    // existence check — the synthetic URN doesn't refer to a real
    // object. We still validate any provided related_to_urn via the
    // helper.
    if (args.related_to_urn) {
      const parsed = parseUrn(args.related_to_urn)
      if (!parsed) {
        return {
          data: null,
          error: `Invalid related_to_urn: ${args.related_to_urn}`,
          citations: [],
        }
      }
    }

    const staged = args.related_to_urn
      ? await stagePendingWrite({
          supabase: ctx.supabase,
          tenantId: ctx.tenantId,
          userId: ctx.userId ?? null,
          interactionId: ctx.interactionId ?? null,
          toolSlug: 'create_crm_task',
          targetUrn: args.related_to_urn,
          proposedArgs: {
            subject: args.subject,
            body: args.body ?? null,
            due_date_iso: args.due_date_iso ?? null,
            priority: args.priority ?? 'MEDIUM',
            related_to_urn: args.related_to_urn,
          },
          summary,
        })
      : await stageStandaloneTask({
          supabase: ctx.supabase,
          tenantId: ctx.tenantId,
          userId: ctx.userId ?? null,
          interactionId: ctx.interactionId ?? null,
          targetUrn,
          proposedArgs: {
            subject: args.subject,
            body: args.body ?? null,
            due_date_iso: args.due_date_iso ?? null,
            priority: args.priority ?? 'MEDIUM',
            related_to_urn: null,
          },
          summary,
        })

    if (!staged.ok) {
      return { data: null, error: staged.error, citations: [] }
    }

    return {
      data: staged.row,
      citations: [
        {
          claim_text: 'Staged task awaiting approval',
          source_type: 'pending_crm_write',
          source_id: staged.row.pending_id,
        },
        ...(args.related_to_urn
          ? [
              {
                claim_text: `Associated ${parseUrn(args.related_to_urn)?.type ?? 'object'}`,
                source_type: parseUrn(args.related_to_urn)?.type ?? 'unknown',
                source_id: parseUrn(args.related_to_urn)?.id,
              },
            ]
          : []),
      ],
    }
  },
}

/**
 * Stage a standalone task that has no related_to_urn. Bypasses the
 * tenant-scoped target existence check (there is no target).
 */
async function stageStandaloneTask(input: {
  supabase: SupabaseClient
  tenantId: string
  userId: string | null
  interactionId: string | null
  targetUrn: string
  proposedArgs: Record<string, unknown>
  summary: string
}): Promise<{ ok: true; row: StageOutput } | { ok: false; error: string }> {
  let argsBytes = 0
  try {
    argsBytes = JSON.stringify(input.proposedArgs).length
  } catch {
    return { ok: false, error: 'proposed_args is not JSON-serialisable' }
  }
  if (argsBytes > MAX_PROPOSED_ARGS_BYTES) {
    return {
      ok: false,
      error: `proposed_args too large (${argsBytes} bytes; cap ${MAX_PROPOSED_ARGS_BYTES})`,
    }
  }

  const { data: row, error } = await input.supabase
    .from('pending_crm_writes')
    .insert({
      tenant_id: input.tenantId,
      requested_by_user_id: input.userId,
      agent_interaction_id: input.interactionId,
      tool_slug: 'create_crm_task',
      target_urn: input.targetUrn,
      proposed_args: input.proposedArgs,
    })
    .select('id, expires_at')
    .single()

  if (error || !row) {
    return {
      ok: false,
      error: `Could not stage standalone task: ${error?.message ?? 'unknown error'}`,
    }
  }

  return {
    ok: true,
    row: {
      pending_id: row.id as string,
      status: 'pending',
      summary: input.summary,
      expires_at: row.expires_at as string,
      next_action: `Surface this proposal to the user as a [DO] chip with text: "${input.summary}". On click, POST { pending_id: "${row.id}" } to /api/agent/approve.`,
    },
  }
}
