'use server'

import { z } from 'zod'
import { generateObject } from 'ai'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'
import { assembleAgentRun } from '@/lib/agent/run-agent'
import { getModel } from '@/lib/agent/model-registry'
import { emitAgentEvent, urn, parseUrn, type PendingCitation } from '@prospector/core'
import type { AgentRole } from '@/lib/agent/tools'

/**
 * Sprint 5 (Mission–Reality Gap roadmap) — native action panel actions.
 *
 * Pre-this-sprint every Action Panel button opened the chat sidebar
 * with a pre-filled prompt. The audit called this out as the most
 * concrete reason "strategic copilot" felt like "chat wrapper" — six
 * actions, none of which actually act.
 *
 * Two actions get the native treatment here: `draft_outreach` and
 * `diagnose_deal`. Each:
 *   1. Goes through `assembleAgentRun` so the prompt assembly is the
 *      same one the dashboard chat + Slack use (parity contract from
 *      MISSION §9.4).
 *   2. Uses `generateObject` with a Zod schema instead of
 *      streamText, so the UI gets structured fields (subject + body
 *      for outreach; root cause + 3 next steps for diagnose) instead
 *      of free-form prose to parse.
 *   3. Returns citations alongside the structured result so the
 *      cite-or-shut-up contract still holds — the UI renders the
 *      same pills the chat sidebar does.
 *   4. Emits `action_invoked` + `interaction_started` +
 *      `response_finished` events so /admin/roi accounting credits
 *      these actions identically to chat-driven ones.
 */

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function resolveAuthContext(): Promise<{
  user_id: string
  tenant_id: string
  rep_crm_id: string
  role: AgentRole
} | null> {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, rep_profile_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) return null

  let repCrmId = user.id
  if (profile.rep_profile_id) {
    const { data: rep } = await supabase
      .from('rep_profiles')
      .select('crm_id')
      .eq('id', profile.rep_profile_id)
      .single()
    if (rep?.crm_id) repCrmId = rep.crm_id
  }

  return {
    user_id: user.id,
    tenant_id: profile.tenant_id,
    rep_crm_id: repCrmId,
    role: (profile.role ?? 'rep') as AgentRole,
  }
}

interface BaseNativeActionResult {
  ok: boolean
  /** Echoed back so the client can record outcome events tied to this run. */
  interactionId: string
  citations: Array<{
    claim_text: string
    source_type: string
    source_id: string | null
    source_url: string | null
  }>
  error?: string
}

// ─── Draft outreach ─────────────────────────────────────────────────

const DraftOutreachSchema = z.object({
  subject: z.string().min(1).describe('Email subject line.'),
  body: z.string().min(1).describe('Email body, plain text. Should reference the cited signals + ICP fit; close with a single soft ask.'),
  cited_urns: z
    .array(z.string())
    .describe('URNs of the source records (signals, transcripts, contacts) the body relies on. Cite-or-shut-up contract — empty array means the agent had no grounded evidence.'),
})

export interface DraftOutreachResult extends BaseNativeActionResult {
  draft: { subject: string; body: string } | null
}

export async function nativeDraftOutreach(
  subjectUrn: string,
  subjectLabel: string,
): Promise<DraftOutreachResult> {
  const interactionId = crypto.randomUUID()
  const ctx = await resolveAuthContext()
  if (!ctx) {
    return {
      ok: false,
      interactionId,
      citations: [],
      draft: null,
      error: 'Unauthorized',
    }
  }

  const supabase = getServiceSupabase()

  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('crm_type, ai_token_budget_monthly, ai_tokens_used_current, business_config')
    .eq('id', ctx.tenant_id)
    .maybeSingle()

  const tokensUsed = (tenantRow?.ai_tokens_used_current as number | null) ?? 0
  const budget = (tenantRow?.ai_token_budget_monthly as number | null) ?? 1_000_000
  const modelRouting =
    ((tenantRow?.business_config as Record<string, unknown> | null)?.model_routing as
      | Record<string, string>
      | null) ?? null

  // Fire action_invoked early so even an LLM failure is attributable.
  await emitAgentEvent(supabase, {
    tenant_id: ctx.tenant_id,
    interaction_id: interactionId,
    user_id: ctx.user_id,
    role: ctx.role,
    event_type: 'action_invoked',
    subject_urn: subjectUrn,
    payload: { action_id: 'draft_outreach_native', subject_label: subjectLabel },
  })

  try {
    // Assemble through the same path Slack + dashboard use. We force
    // `account-strategist` because it's the surface that knows about
    // outreach drafting, contact resolution, transcript signals.
    const userMessage = `Draft a personalised outreach email to ${subjectLabel}. Reference the most recent signals (hiring, funding, leadership change), the ICP fit, and the rep's value propositions. Keep the body under 120 words. Single soft ask at the end. Cite every concrete claim with the source URN.`

    const assembled = await assembleAgentRun({
      supabase,
      tenantId: ctx.tenant_id,
      repId: ctx.rep_crm_id,
      userId: ctx.user_id,
      role: ctx.role,
      agentTypeOverride: 'account-strategist',
      activeUrn: subjectUrn,
      pageContext: undefined,
      userMessageText: userMessage,
      intentClass: 'draft_outreach',
      messages: [{ role: 'user', content: userMessage }],
      interactionId,
      crmType: (tenantRow?.crm_type as string | null) ?? null,
      tokensUsedThisMonth: tokensUsed,
      monthlyBudget: budget,
      tenantModelRouting: modelRouting,
      // Native action UX wants a tightly-bounded card, not a wall of
      // prose. `casual` keeps body length ≤150 words.
      repCommStyle: 'casual',
    })

    const result = await generateObject({
      model: getModel(assembled.modelId),
      messages: assembled.messages,
      schema: DraftOutreachSchema,
      maxTokens: assembled.responseTokenCap,
      temperature: 0.4,
    })

    const allCitations = (assembled.packedContext?.citations ?? []) as PendingCitation[]
    const cited = allCitations.filter((c) => result.object.cited_urns.some((u) => urnMatchesCitation(u, c)))

    await emitAgentEvent(supabase, {
      tenant_id: ctx.tenant_id,
      interaction_id: interactionId,
      user_id: ctx.user_id,
      role: ctx.role,
      event_type: 'response_finished',
      subject_urn: subjectUrn,
      // The validate-events check requires these fields on every
      // response_finished — same shape the chat agent route emits so
      // /admin/roi (cited %) + Pull-to-Push (response count) +
      // baseline_snapshot all key off the same payload schema.
      payload: {
        agent_type: 'account-strategist',
        intent_class: 'draft_outreach',
        model: assembled.modelId,
        tool_calls: [],
        citation_count: cited.length,
        tokens_total: 0,
        action_id: 'draft_outreach_native',
        response_length: result.object.body.length,
      },
    })

    return {
      ok: true,
      interactionId,
      draft: { subject: result.object.subject, body: result.object.body },
      citations: cited.map(toUiCitation),
    }
  } catch (err) {
    console.error('[nativeDraftOutreach]', err)
    return {
      ok: false,
      interactionId,
      citations: [],
      draft: null,
      error: err instanceof Error ? err.message : 'Generation failed',
    }
  }
}

// ─── Diagnose deal ─────────────────────────────────────────────────

const DiagnoseDealSchema = z.object({
  root_cause: z.string().min(1).describe('Single sentence — the most likely reason this deal is stuck.'),
  next_steps: z
    .array(
      z.object({
        action: z.string().min(1),
        rationale: z.string().min(1),
      }),
    )
    .min(1)
    .max(3)
    .describe('Up to three concrete next steps, ordered by impact. MISSION §9.1: ≤3 buttons.'),
  cited_urns: z
    .array(z.string())
    .describe('URNs of source records (transcripts, signals, opportunity stage history) the diagnosis relies on.'),
})

export interface DiagnoseDealResult extends BaseNativeActionResult {
  diagnosis: {
    root_cause: string
    next_steps: { action: string; rationale: string }[]
  } | null
}

export async function nativeDiagnoseDeal(
  subjectUrn: string,
  subjectLabel: string,
): Promise<DiagnoseDealResult> {
  const interactionId = crypto.randomUUID()
  const ctx = await resolveAuthContext()
  if (!ctx) {
    return {
      ok: false,
      interactionId,
      citations: [],
      diagnosis: null,
      error: 'Unauthorized',
    }
  }

  const supabase = getServiceSupabase()

  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('crm_type, ai_token_budget_monthly, ai_tokens_used_current, business_config')
    .eq('id', ctx.tenant_id)
    .maybeSingle()

  const tokensUsed = (tenantRow?.ai_tokens_used_current as number | null) ?? 0
  const budget = (tenantRow?.ai_token_budget_monthly as number | null) ?? 1_000_000
  const modelRouting =
    ((tenantRow?.business_config as Record<string, unknown> | null)?.model_routing as
      | Record<string, string>
      | null) ?? null

  await emitAgentEvent(supabase, {
    tenant_id: ctx.tenant_id,
    interaction_id: interactionId,
    user_id: ctx.user_id,
    role: ctx.role,
    event_type: 'action_invoked',
    subject_urn: subjectUrn,
    payload: { action_id: 'diagnose_deal_native', subject_label: subjectLabel },
  })

  try {
    const userMessage = `Diagnose the ${subjectLabel} deal. Identify the most likely root cause it is stuck (stage velocity vs benchmark, missing decision-maker, signal silence, etc.). Recommend up to three concrete next steps, ordered by impact. Cite every numeric or factual claim with its source URN.`

    const assembled = await assembleAgentRun({
      supabase,
      tenantId: ctx.tenant_id,
      repId: ctx.rep_crm_id,
      userId: ctx.user_id,
      role: ctx.role,
      agentTypeOverride: 'account-strategist',
      activeUrn: subjectUrn,
      pageContext: undefined,
      userMessageText: userMessage,
      intentClass: 'diagnosis',
      messages: [{ role: 'user', content: userMessage }],
      interactionId,
      crmType: (tenantRow?.crm_type as string | null) ?? null,
      tokensUsedThisMonth: tokensUsed,
      monthlyBudget: budget,
      tenantModelRouting: modelRouting,
      repCommStyle: 'casual',
    })

    const result = await generateObject({
      model: getModel(assembled.modelId),
      messages: assembled.messages,
      schema: DiagnoseDealSchema,
      maxTokens: assembled.responseTokenCap,
      temperature: 0.3,
    })

    const allCitations = (assembled.packedContext?.citations ?? []) as PendingCitation[]
    const cited = allCitations.filter((c) => result.object.cited_urns.some((u) => urnMatchesCitation(u, c)))

    await emitAgentEvent(supabase, {
      tenant_id: ctx.tenant_id,
      interaction_id: interactionId,
      user_id: ctx.user_id,
      role: ctx.role,
      event_type: 'response_finished',
      subject_urn: subjectUrn,
      payload: {
        agent_type: 'account-strategist',
        intent_class: 'diagnosis',
        model: assembled.modelId,
        tool_calls: [],
        citation_count: cited.length,
        tokens_total: 0,
        action_id: 'diagnose_deal_native',
      },
    })

    return {
      ok: true,
      interactionId,
      diagnosis: {
        root_cause: result.object.root_cause,
        next_steps: result.object.next_steps,
      },
      citations: cited.map(toUiCitation),
    }
  } catch (err) {
    console.error('[nativeDiagnoseDeal]', err)
    return {
      ok: false,
      interactionId,
      citations: [],
      diagnosis: null,
      error: err instanceof Error ? err.message : 'Generation failed',
    }
  }
}

// ─── Push outreach to CRM ─────────────────────────────────────────────

export interface PushOutreachToCrmResult {
  ok: boolean
  /** Echoed for telemetry stitching. */
  interactionId: string
  /** Newly-created HubSpot engagement id when the push succeeded. */
  newRecordId?: string
  error?: string
}

/**
 * Push an outreach draft into the source CRM as a 'note' engagement
 * associated with the company URN. The note's body carries the
 * subject + body verbatim so the rep can copy/paste into their
 * actual outbound channel later. We deliberately do NOT auto-send
 * an email — MISSION §6 ("we do not auto-send any external
 * communication") forbids it.
 *
 * Reuses the existing `log_crm_activity` adapter path rather than
 * importing the agent-tool handler — it owns the retry classification
 * and credential decryption for HubSpot/Salesforce.
 */
export async function pushOutreachToCrm(
  subjectUrn: string,
  draft: { subject: string; body: string },
  interactionId: string,
): Promise<PushOutreachToCrmResult> {
  const ctx = await resolveAuthContext()
  if (!ctx) {
    return { ok: false, interactionId, error: 'Unauthorized' }
  }

  const parsed = parseUrn(subjectUrn)
  if (!parsed || (parsed.type !== 'company' && parsed.type !== 'deal' && parsed.type !== 'opportunity')) {
    return { ok: false, interactionId, error: `Unsupported URN: ${subjectUrn}` }
  }

  const supabase = getServiceSupabase()

  // Resolve crm_id of the target — we associate the note with the
  // CRM-side record, not the local Postgres id.
  const tableName =
    parsed.type === 'company'
      ? 'companies'
      : 'opportunities'
  const { data: target } = await supabase
    .from(tableName)
    .select('id, crm_id')
    .eq('tenant_id', ctx.tenant_id)
    .eq('id', parsed.id)
    .maybeSingle()

  if (!target?.crm_id) {
    return {
      ok: false,
      interactionId,
      error: `Target ${subjectUrn} has no crm_id (record not synced from CRM yet)`,
    }
  }

  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('crm_type, crm_credentials_encrypted')
    .eq('id', ctx.tenant_id)
    .maybeSingle()

  if (tenantRow?.crm_type !== 'hubspot') {
    return {
      ok: false,
      interactionId,
      error: 'Push to CRM currently only supports HubSpot tenants. Salesforce parity is on the roadmap.',
    }
  }

  try {
    const { HubSpotAdapter } = await import('@prospector/adapters')
    const { decryptCredentials, isEncryptedString } = await import('@/lib/crypto')
    const rawCreds = tenantRow.crm_credentials_encrypted
    if (!rawCreds) {
      return { ok: false, interactionId, error: 'CRM credentials missing' }
    }
    const creds = isEncryptedString(rawCreds)
      ? (decryptCredentials(rawCreds) as Record<string, string>)
      : (rawCreds as Record<string, string>)
    if (!creds.private_app_token) {
      return { ok: false, interactionId, error: 'HubSpot private_app_token missing' }
    }

    const client = new HubSpotAdapter({ private_app_token: creds.private_app_token })
    const noteBody = `Subject: ${draft.subject}\n\n${draft.body}\n\n— Drafted by Prospector OS (interaction ${interactionId})`
    const newId = await client.createEngagement(
      'note',
      noteBody,
      parsed.type === 'company'
        ? { companyId: target.crm_id }
        : { dealId: target.crm_id },
    )

    await emitAgentEvent(supabase, {
      tenant_id: ctx.tenant_id,
      interaction_id: interactionId,
      user_id: ctx.user_id,
      role: ctx.role,
      event_type: 'action_invoked',
      subject_urn: subjectUrn,
      payload: {
        action_id: 'push_outreach_to_crm',
        crm_record_id: newId,
        outcome: 'pushed_to_crm',
      },
    })

    return { ok: true, interactionId, newRecordId: newId }
  } catch (err) {
    console.error('[pushOutreachToCrm]', err)
    return {
      ok: false,
      interactionId,
      error: err instanceof Error ? err.message : 'CRM write failed',
    }
  }
}

// ─── helpers ─────────────────────────────────────────────────────────

/**
 * Match a URN string to a citation row. The agent's `cited_urns`
 * field carries verbatim URNs ("urn:rev:t:company:abc"); the
 * citation row exposes (source_type, source_id) plus an optional
 * source_url. We compare on the (type, id) pair extracted from the
 * URN — that's the canonical join key.
 */
function urnMatchesCitation(rawUrn: string, citation: PendingCitation): boolean {
  const parsed = parseUrn(rawUrn)
  if (!parsed) return false
  return parsed.type === citation.source_type && parsed.id === citation.source_id
}

function toUiCitation(c: PendingCitation) {
  return {
    claim_text: c.claim_text,
    source_type: c.source_type,
    source_id: c.source_id ?? null,
    source_url: c.source_url ?? null,
  }
}

// urn helper used in scoped narration when needed
void urn
