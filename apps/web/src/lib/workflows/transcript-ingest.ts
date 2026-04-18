import type { SupabaseClient } from '@supabase/supabase-js'
import { TranscriptIngester } from '@prospector/adapters'
import type { TranscriptWebhookPayload } from '@prospector/adapters'
import { emitAgentEvent, urn } from '@prospector/core'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Transcript ingest workflow — durable wrapper around TranscriptIngester.
 * Steps:
 *   1. ingest_transcript  — download + embed + store + MEDDPICC
 *   2. write_crm_note     — (stub for now) hands the extracted summary back
 *                           to the CRM so the sale team see it in-context.
 */
export async function enqueueTranscriptIngest(
  supabase: SupabaseClient,
  tenantId: string,
  payload: TranscriptWebhookPayload,
): Promise<WorkflowRunRow> {
  // Idempotency key is tenant-prefixed even though the runner now scopes
  // by tenant_id on lookup — defense in depth in case the key ever leaks
  // into a log/dashboard or is consumed by an admin tool that joins
  // across tenants.
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'transcript_ingest',
    idempotencyKey: `ti:${tenantId}:${payload.source}:${payload.source_id}`,
    input: payload as unknown as Record<string, unknown>,
  })
}

export async function runTranscriptIngest(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'ingest_transcript',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant for transcript ingest')
        const payload = ctx.input as unknown as TranscriptWebhookPayload
        const ingester = new TranscriptIngester(ctx.supabase, ctx.tenantId)
        const id = await ingester.ingest(payload)

        await emitAgentEvent(ctx.supabase, {
          tenant_id: ctx.tenantId,
          event_type: 'response_finished',
          subject_urn: urn.transcript(ctx.tenantId, id),
          payload: {
            workflow: 'transcript_ingest',
            source: payload.source,
          },
        })

        return { transcript_id: id }
      },
    },
    {
      name: 'write_crm_note',
      run: async (ctx) => {
        const { transcript_id } = ctx.stepState.ingest_transcript as { transcript_id: string }
        if (!ctx.tenantId) return { skipped: true, reason: 'no_tenant' }

        // Defence in depth: scope by tenant_id even though the row was
        // just inserted with this same tenant. RLS catches the
        // cross-tenant case in production, but service-role queries
        // bypass RLS — without explicit `.eq('tenant_id', ...)` here
        // a workflow runner bug that mixed up `transcript_id` could
        // surface another tenant's row.
        const { data: transcript } = await ctx.supabase
          .from('transcripts')
          .select('company_id, summary, themes, meddpicc_extracted')
          .eq('tenant_id', ctx.tenantId)
          .eq('id', transcript_id)
          .maybeSingle()

        if (!transcript?.company_id) return { skipped: true, reason: 'no_company_match' }

        // Persist a note pointer; actual CRM write handled by the nightly
        // writeback job (keeps this step idempotent + retriable).
        return {
          note_summary: transcript.summary ?? null,
          company_id: transcript.company_id,
          themes: transcript.themes ?? [],
          meddpicc: transcript.meddpicc_extracted ?? null,
        }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
