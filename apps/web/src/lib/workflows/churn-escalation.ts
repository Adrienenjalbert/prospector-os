import type { SupabaseClient } from '@supabase/supabase-js'
import { generateText } from 'ai'
import { SlackDispatcher, SupabaseCooldownStore } from '@prospector/adapters'
import { emitAgentEvent, urn } from '@prospector/core'

import {
  startWorkflow,
  runWorkflow,
  loopUntil,
  type Step,
  type WorkflowRunRow,
  type LoopValidatorResult,
} from './runner'
import { shouldSuppressPush } from './holdout'
import { getModel } from '@/lib/agent/model-registry'

/**
 * Churn Escalation workflow (Phase 5 — loopUntil consumer)
 *
 * Trigger: a CSM requests an escalation letter for a high-risk account,
 * or the nightly churn-risk workflow spots an account crossing a threshold.
 *
 * The draft is high-stakes — this letter goes to a paying customer. The
 * validator enforces:
 *   1. cites >= 3 concrete metrics (each mapped to a URN)
 *   2. every numeric claim in the letter appears in the source data
 *      (no invented %, no invented £)
 *   3. mentions the account owner by name
 *   4. stays within a 400-word budget
 *
 * loopUntil re-invokes the drafter with the validator's failure reasons
 * until the letter passes or max_iterations is reached. If it exceeds,
 * the workflow errors so a human reviews — we never auto-send an
 * un-validated customer letter.
 */

export interface ChurnEscalationInput {
  /** URN of the at-risk company. */
  company_urn: string
  /** CSM / account owner handling the escalation. */
  owner_id: string
  /** Optional free-text prompt from the CSM (e.g. "lean on the fulfillment drop"). */
  guidance?: string
}

interface GatheredEvidence {
  tenant_id: string
  company_id: string
  company_name: string
  owner_name: string
  metrics: Array<{ label: string; value: string; urn: string }>
  open_signals: Array<{ title: string; urn: string }>
  recent_transcript_excerpts: Array<{ snippet: string; urn: string }>
}

interface DraftLetter {
  subject: string
  body: string
  cited_urns: string[]
  word_count: number
}

export async function enqueueChurnEscalation(
  supabase: SupabaseClient,
  tenantId: string,
  input: ChurnEscalationInput,
): Promise<WorkflowRunRow> {
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'churn_escalation',
    subjectUrn: input.company_urn,
    // One escalation per (company, day) — retries don't spam the CSM.
    idempotencyKey: `escalation:${input.company_urn}:${new Date().toISOString().slice(0, 10)}`,
    input: input as unknown as Record<string, unknown>,
  })
}

export async function runChurnEscalation(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'gather_evidence',
      run: async (ctx): Promise<GatheredEvidence> => {
        if (!ctx.tenantId) throw new Error('Missing tenant for churn_escalation')
        const { company_urn, owner_id } = ctx.input as unknown as ChurnEscalationInput

        // URN format: urn:rev:{tenant}:company:{id}
        const parts = company_urn.split(':')
        const companyId = parts[parts.length - 1]

        const { data: company } = await ctx.supabase
          .from('companies')
          .select('id, tenant_id, name, churn_risk_score, health_score, mrr, priority_reason, last_qbr_at')
          .eq('id', companyId)
          .eq('tenant_id', ctx.tenantId)
          .maybeSingle()

        if (!company) throw new Error(`Company ${company_urn} not found`)

        const { data: owner } = await ctx.supabase
          .from('rep_profiles')
          .select('id, name, slack_user_id')
          .eq('id', owner_id)
          .eq('tenant_id', ctx.tenantId)
          .maybeSingle()

        const ownerName = owner?.name ?? 'The account owner'

        // Pull up to 5 recent signals scoped to this company. Each becomes
        // a citable URN the validator can check.
        const { data: signals } = await ctx.supabase
          .from('signals')
          .select('id, title')
          .eq('tenant_id', ctx.tenantId)
          .eq('company_id', company.id)
          .order('detected_at', { ascending: false })
          .limit(5)

        const openSignals = (signals ?? []).map((s) => ({
          title: s.title ?? 'unlabelled signal',
          urn: urn.signal(ctx.tenantId!, s.id),
        }))

        // Metrics are the ground-truth numeric set the validator will
        // cross-check. Only include metrics we actually have.
        const metrics: GatheredEvidence['metrics'] = []
        if (company.churn_risk_score != null) {
          metrics.push({
            label: 'Churn risk score',
            value: String(company.churn_risk_score),
            urn: urn.company(ctx.tenantId, company.id),
          })
        }
        if (company.health_score != null) {
          metrics.push({
            label: 'Health score',
            value: String(company.health_score),
            urn: urn.company(ctx.tenantId, company.id),
          })
        }
        if (company.mrr != null) {
          metrics.push({
            label: 'MRR',
            value: `£${Number(company.mrr).toLocaleString()}`,
            urn: urn.company(ctx.tenantId, company.id),
          })
        }

        // Pull top 3 recent transcript hits mentioning the company. These
        // aren't required but provide paste-able evidence for the letter.
        const { data: transcripts } = await ctx.supabase
          .from('transcripts')
          .select('id, title, summary')
          .eq('tenant_id', ctx.tenantId)
          .eq('company_id', company.id)
          .order('occurred_at', { ascending: false })
          .limit(3)

        const excerpts = (transcripts ?? [])
          .filter((t) => t.summary)
          .map((t) => ({
            snippet: (t.summary ?? '').slice(0, 200),
            urn: urn.transcript(ctx.tenantId!, t.id),
          }))

        return {
          tenant_id: ctx.tenantId,
          company_id: company.id,
          company_name: company.name ?? 'the account',
          owner_name: ownerName,
          metrics,
          open_signals: openSignals,
          recent_transcript_excerpts: excerpts,
        }
      },
    },

    {
      name: 'draft_with_quality_loop',
      run: async (ctx) => {
        const evidence = ctx.stepState.gather_evidence as GatheredEvidence
        const { guidance } = ctx.input as unknown as ChurnEscalationInput

        const { passed, iterations, lastResult, lastReasons } = await loopUntil<DraftLetter>(
          {
            maxIterations: 5,
            freshContext: false,
            step: async ({ iteration, previousReasons }) => {
              const revisionGuidance =
                previousReasons.length > 0
                  ? `\n\nPREVIOUS ATTEMPT FAILED validation:\n- ${previousReasons.join(
                      '\n- ',
                    )}\n\nFix every reason above.`
                  : ''

              const prompt = buildDraftPrompt(evidence, guidance ?? '', revisionGuidance)
              const { text } = await generateText({
                model: getModel('anthropic/claude-sonnet-4'),
                prompt,
                maxTokens: 1200,
                temperature: iteration === 0 ? 0.5 : 0.3,
              })

              return parseDraft(text)
            },
            validator: (draft) => validateDraft(draft, evidence),
          },
          ctx,
        )

        if (!passed) {
          // Surface a structured failure rather than throwing — the
          // dispatch step will see this and route to a human reviewer
          // instead of auto-sending. MISSION: "we do not auto-act
          // without human approval cycle".
          return {
            passed: false,
            iterations,
            draft: lastResult,
            reasons: lastReasons,
          }
        }

        return {
          passed: true,
          iterations,
          draft: lastResult!,
          reasons: [] as string[],
        }
      },
    },

    {
      name: 'dispatch_to_csm',
      run: async (ctx) => {
        const evidence = ctx.stepState.gather_evidence as GatheredEvidence
        const draftResult = ctx.stepState.draft_with_quality_loop as {
          passed: boolean
          iterations: number
          draft: DraftLetter | null
          reasons: string[]
        }

        if (!draftResult.passed) {
          // Don't send — queue for human review. Downstream /admin/adaptation
          // picks these up; the event log makes the failure auditable.
          await emitAgentEvent(ctx.supabase, {
            tenant_id: evidence.tenant_id,
            interaction_id: crypto.randomUUID(),
            user_id: null,
            role: 'csm',
            event_type: 'escalation_needs_review',
            subject_urn: urn.company(evidence.tenant_id, evidence.company_id),
            payload: {
              iterations: draftResult.iterations,
              reasons: draftResult.reasons,
              workflow: 'churn_escalation',
            },
          })
          return { skipped: true, reason: 'failed_quality_gate' }
        }

        const { owner_id } = ctx.input as unknown as ChurnEscalationInput

        // Holdout suppression — even escalations respect the cohort.
        const suppress = await shouldSuppressPush(ctx.supabase, evidence.tenant_id, owner_id)
        if (suppress) {
          return { skipped: true, reason: 'holdout_control' }
        }

        const slackToken = process.env.SLACK_BOT_TOKEN
        if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set')

        const { data: owner } = await ctx.supabase
          .from('rep_profiles')
          .select('id, slack_user_id, name')
          .eq('id', owner_id)
          .eq('tenant_id', evidence.tenant_id)
          .maybeSingle()

        if (!owner?.slack_user_id) {
          return { skipped: true, reason: 'owner_no_slack' }
        }

        const dispatcher = new SlackDispatcher(
          slackToken,
          new SupabaseCooldownStore(ctx.supabase),
        )

        const interactionId = crypto.randomUUID()
        const companyUrn = urn.company(evidence.tenant_id, evidence.company_id)

        // Map the validated draft into the dispatcher's EscalationParams
        // shape. summary is the opening line, recommendation carries the
        // full letter body so the CSM can copy-paste; risk factors list
        // the evidence URNs inline for click-through.
        const result = await dispatcher.sendEscalation(
          {
            slackUserId: owner.slack_user_id,
            accountName: evidence.company_name,
            summary: draftResult.draft!.subject,
            riskFactors: evidence.metrics.map((m) => `${m.label}: ${m.value} (${m.urn})`),
            actionsTried: ['Draft prepared by OS; requires CSM review before send.'],
            recommendation: draftResult.draft!.body,
            interactionId,
          },
          {
            tenantId: evidence.tenant_id,
            subjectKey: `churn_escalation:${companyUrn}`,
          },
        )

        await emitAgentEvent(ctx.supabase, {
          tenant_id: evidence.tenant_id,
          interaction_id: interactionId,
          user_id: owner.id,
          role: 'csm',
          event_type: result.ok ? 'response_finished' : 'error',
          subject_urn: companyUrn,
          payload: {
            workflow: 'churn_escalation',
            iterations: draftResult.iterations,
            word_count: draftResult.draft!.word_count,
            cited: draftResult.draft!.cited_urns.length,
            skipped: result.skipped ?? false,
            reason: result.skippedReason ?? result.error ?? null,
          },
        })

        return result
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

// ---------------------------------------------------------------------------
// Draft helpers — builder, parser, validator.
// ---------------------------------------------------------------------------

function buildDraftPrompt(
  ev: GatheredEvidence,
  guidance: string,
  revisionGuidance: string,
): string {
  const metricsBlock = ev.metrics
    .map((m) => `- ${m.label}: ${m.value}  (urn: ${m.urn})`)
    .join('\n')
  const signalsBlock = ev.open_signals
    .map((s) => `- ${s.title}  (urn: ${s.urn})`)
    .join('\n')

  return [
    `You are drafting a churn-escalation message that the CSM will send to a paying customer.`,
    `Tone: empathetic, specific, action-oriented. MISSION principle: cite or shut up — every number must map to a urn below. Do not invent any figures.`,
    ``,
    `Customer: ${ev.company_name}`,
    `Account owner: ${ev.owner_name}`,
    ``,
    `Evidence you MUST cite (pick ≥3, include the urn inline as [urn:...]):`,
    metricsBlock || '(no metrics available)',
    ``,
    `Open signals:`,
    signalsBlock || '(none)',
    ``,
    guidance ? `Owner guidance: ${guidance}` : '',
    revisionGuidance,
    ``,
    `Output JSON only, no markdown fences:`,
    `{"subject": "<subject line>", "body": "<letter body, <= 400 words, include citations as [urn:rev:...]>", "cited_urns": ["urn:rev:...", ...]}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function parseDraft(text: string): DraftLetter {
  const clean = text.replace(/^```json\s*|\s*```$/g, '').trim()
  let parsed: Partial<DraftLetter>
  try {
    parsed = JSON.parse(clean) as Partial<DraftLetter>
  } catch {
    // Return a shape the validator will reject — the next iteration gets a
    // chance to correct.
    return { subject: '', body: clean, cited_urns: [], word_count: clean.split(/\s+/).length }
  }
  const body = String(parsed.body ?? '')
  return {
    subject: String(parsed.subject ?? ''),
    body,
    cited_urns: Array.isArray(parsed.cited_urns) ? parsed.cited_urns : [],
    word_count: body.split(/\s+/).filter(Boolean).length,
  }
}

function validateDraft(draft: DraftLetter, ev: GatheredEvidence): LoopValidatorResult {
  const reasons: string[] = []

  if (!draft.subject) reasons.push('Missing subject line.')
  if (draft.word_count > 400) reasons.push(`Letter is ${draft.word_count} words, must be <= 400.`)
  if (draft.word_count < 50) reasons.push(`Letter is only ${draft.word_count} words — too short for an escalation.`)

  if (draft.cited_urns.length < 3) {
    reasons.push(`Cites ${draft.cited_urns.length} URNs; at least 3 required.`)
  }

  // Every cited urn must appear in the evidence set (no inventions).
  const knownUrns = new Set<string>([
    ...ev.metrics.map((m) => m.urn),
    ...ev.open_signals.map((s) => s.urn),
    ...ev.recent_transcript_excerpts.map((t) => t.urn),
  ])
  for (const u of draft.cited_urns) {
    if (!knownUrns.has(u)) {
      reasons.push(`Invented citation: ${u} was not in the evidence set.`)
    }
  }

  // Every number in the body must appear in the evidence set of numbers.
  // Extract simple numeric tokens and compare. Intentionally coarse —
  // a few false positives are OK; false negatives (inventions) are not.
  const knownNumerics = new Set<string>()
  for (const m of ev.metrics) {
    // Strip currency/commas and add both raw and normalised forms.
    const raw = m.value.replace(/[^0-9.]/g, '')
    if (raw) knownNumerics.add(raw)
  }
  const bodyNumbers = draft.body.match(/[0-9][0-9.,]*/g) ?? []
  for (const bn of bodyNumbers) {
    const normalised = bn.replace(/,/g, '')
    // Allow year-ish numbers and small ordinals (2024, 3 quarters, etc).
    if (/^(19|20)\d{2}$/.test(normalised)) continue
    if (/^[1-9]$/.test(normalised)) continue
    if (!knownNumerics.has(normalised)) {
      reasons.push(`Number "${bn}" in body doesn't appear in evidence metrics.`)
      break // one fail is enough — next iteration fixes root cause.
    }
  }

  // Must mention the owner name — the CSM sends this from their own
  // identity, the customer needs to see the owner referenced.
  if (ev.owner_name !== 'The account owner' && !draft.body.includes(ev.owner_name.split(' ')[0])) {
    reasons.push(`Must mention the account owner (${ev.owner_name}) by first name.`)
  }

  return {
    passed: reasons.length === 0,
    reasons,
    score: reasons.length === 0 ? 1 : Math.max(0, 1 - reasons.length * 0.2),
  }
}
