import type { SupabaseClient } from '@supabase/supabase-js'
import {
  emitAgentEvent,
  RETENTION_DEFAULT_DAYS,
  RETENTION_TABLE_NAMES,
  type RetentionTableName,
} from '@prospector/core'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Retention sweep — Phase 3 T1.3.
 *
 * Closes the audit-area-A retention gap (no job today purges any of
 * `agent_events`, `outcome_events`, `transcripts`, `agent_citations`,
 * `ai_conversations`, `ai_conversation_notes`, `webhook_deliveries`,
 * `attributions`). Cleartext PII accumulates forever today — itself a
 * GDPR breach risk in addition to a SOC 2 control gap.
 *
 * Per-table windows:
 *
 *   - DEFAULTS live in `@prospector/core` `RETENTION_DEFAULT_DAYS`
 *     (`packages/core/src/retention/defaults.ts`).
 *   - PER-TENANT OVERRIDES live in `retention_policies` (migration 010).
 *     The longer-only rule is enforced at the admin-config write boundary
 *     (`apps/web/src/app/api/admin/config/route.ts`); this workflow only
 *     READS the resolved window, never validates.
 *
 * Special case — `transcripts.raw_text`:
 *
 *   The 90-day TTL on `transcripts.raw_text` is a COLUMN-LEVEL NULL,
 *   not a row-level DELETE. The summary + embedding survive at 1095
 *   days under the `transcripts_summary` policy. This is the single
 *   per-key behavioural difference; everything else is row-delete.
 *
 * Shadow mode:
 *
 *   `RETENTION_SWEEP_DRY_RUN=true` (default ON until owner sign-off,
 *   per OQ-4 rollout note) — counts rows that WOULD be purged but does
 *   not execute. The `retention_sweep_completed` event payload still
 *   fires with `dry_run: true` so the operator can preview the volume
 *   on /admin/adaptation. Flip to `=false` after one week of clean
 *   shadow runs.
 *
 * Lock storms:
 *
 *   Each delete batch is bounded to BATCH_SIZE rows. The workflow loops
 *   per table until a sub-batch returns < BATCH_SIZE (drain complete)
 *   or `MAX_BATCHES_PER_TABLE_PER_RUN` is hit (overflow protection on
 *   tenants with months-of-backlog). On overflow the workflow logs the
 *   leftover and returns; the next nightly run picks up where this one
 *   left off.
 */

const BATCH_SIZE = 1000
const MAX_BATCHES_PER_TABLE_PER_RUN = 50 // 50 × 1000 = 50k rows / table / run

interface PerTablePlan {
  table: RetentionTableName
  retention_days: number
  cutoff_iso: string
}

interface PerTableResult {
  table: RetentionTableName
  rows: number
  action: 'delete' | 'null'
  truncated: boolean // true if MAX_BATCHES hit
  error?: string
}

export interface RetentionSweepInput {
  /**
   * Optional override for the dry-run flag. When unset, falls back to
   * the env var `RETENTION_SWEEP_DRY_RUN` (default ON).
   */
  force_dry_run?: boolean
  /** Optional clock override for deterministic tests. */
  now_iso?: string
}

function isDryRun(input: RetentionSweepInput): boolean {
  if (typeof input.force_dry_run === 'boolean') return input.force_dry_run
  const raw = process.env.RETENTION_SWEEP_DRY_RUN
  // Default to TRUE when the env var is unset — safe-by-default per
  // OQ-4 rollout. Only the explicit string "false" (case-insensitive,
  // trimmed) flips off shadow mode.
  if (typeof raw !== 'string') return true
  return raw.trim().toLowerCase() !== 'false'
}

export async function enqueueRetentionSweep(
  supabase: SupabaseClient,
  tenantId: string,
  input: RetentionSweepInput = {},
): Promise<WorkflowRunRow> {
  const day = (input.now_iso ?? new Date().toISOString()).slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'retention_sweep',
    idempotencyKey: `rs:${tenantId}:${day}`,
    input: input as unknown as Record<string, unknown>,
  })
}

export async function runRetentionSweep(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'resolve_policies',
      run: async (ctx): Promise<{ plans: PerTablePlan[] }> => {
        if (!ctx.tenantId) throw new Error('Missing tenant for retention sweep')
        const input = ctx.input as unknown as RetentionSweepInput
        const now = new Date(input.now_iso ?? new Date().toISOString())

        // Read overrides for this tenant. Any table without an override
        // uses the platform default. The longer-only rule is enforced at
        // the write boundary, not here.
        const { data: overrides, error } = await ctx.supabase
          .from('retention_policies')
          .select('table_name, retention_days')
          .eq('tenant_id', ctx.tenantId)

        if (error) {
          throw new Error(`retention_policies read failed: ${error.message}`)
        }

        const overrideMap = new Map<string, number>()
        for (const r of overrides ?? []) {
          overrideMap.set(r.table_name as string, r.retention_days as number)
        }

        const plans: PerTablePlan[] = RETENTION_TABLE_NAMES.map((table) => {
          const days = overrideMap.get(table) ?? RETENTION_DEFAULT_DAYS[table]
          const cutoffMs = now.getTime() - days * 24 * 60 * 60 * 1000
          return {
            table,
            retention_days: days,
            cutoff_iso: new Date(cutoffMs).toISOString(),
          }
        })
        return { plans }
      },
    },

    {
      name: 'sweep',
      run: async (ctx): Promise<{
        per_table: PerTableResult[]
        total_rows_swept: number
        dry_run: boolean
      }> => {
        if (!ctx.tenantId) throw new Error('Missing tenant for retention sweep')
        const { plans } = ctx.stepState.resolve_policies as {
          plans: PerTablePlan[]
        }
        const input = ctx.input as unknown as RetentionSweepInput
        const dryRun = isDryRun(input)

        const results: PerTableResult[] = []
        let total = 0

        for (const plan of plans) {
          const result = await sweepOneTable(ctx.supabase, ctx.tenantId, plan, dryRun)
          results.push(result)
          total += result.rows
        }

        return { per_table: results, total_rows_swept: total, dry_run: dryRun }
      },
    },

    {
      name: 'emit_event',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant for retention sweep')
        const sweep = ctx.stepState.sweep as {
          per_table: PerTableResult[]
          total_rows_swept: number
          dry_run: boolean
        }

        const perTablePayload: Record<
          string,
          { rows: number; action: 'delete' | 'null'; truncated?: boolean; error?: string }
        > = {}
        for (const r of sweep.per_table) {
          perTablePayload[r.table] = {
            rows: r.rows,
            action: r.action,
            ...(r.truncated ? { truncated: true } : {}),
            ...(r.error ? { error: r.error } : {}),
          }
        }

        await emitAgentEvent(ctx.supabase, {
          tenant_id: ctx.tenantId,
          event_type: 'retention_sweep_completed',
          role: 'system',
          payload: {
            dry_run: sweep.dry_run,
            total_rows_swept: sweep.total_rows_swept,
            per_table: perTablePayload,
          },
        })

        return { ok: true, total: sweep.total_rows_swept, dry_run: sweep.dry_run }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

// ---------------------------------------------------------------------------
// Per-table sweep implementation. The branch on table name is the closed
// allowlist — the same set the migration 010 CHECK constraint enforces. A
// new retention target requires changes in three places: defaults.ts,
// migration, and the switch below.
// ---------------------------------------------------------------------------

async function sweepOneTable(
  supabase: SupabaseClient,
  tenantId: string,
  plan: PerTablePlan,
  dryRun: boolean,
): Promise<PerTableResult> {
  switch (plan.table) {
    // --- Special case: column-level NULL on transcripts.raw_text ---
    case 'transcripts_raw_text':
      return sweepNullColumn(
        supabase,
        tenantId,
        'transcripts',
        'raw_text',
        plan.cutoff_iso,
        dryRun,
        'occurred_at',
      )

    // --- Standard row-delete cases ---
    case 'agent_events':
      return sweepDeleteRows(
        supabase,
        tenantId,
        'agent_events',
        plan.cutoff_iso,
        dryRun,
        'occurred_at',
      )
    case 'outcome_events':
      return sweepDeleteRows(
        supabase,
        tenantId,
        'outcome_events',
        plan.cutoff_iso,
        dryRun,
        'occurred_at',
      )
    case 'attributions':
      return sweepDeleteRows(
        supabase,
        tenantId,
        'attributions',
        plan.cutoff_iso,
        dryRun,
        'created_at',
      )
    case 'transcripts_summary':
      return sweepDeleteRows(
        supabase,
        tenantId,
        'transcripts',
        plan.cutoff_iso,
        dryRun,
        'occurred_at',
        // Tag the result with the policy key so the event payload
        // distinguishes from transcripts_raw_text.
        'transcripts_summary',
      )
    case 'ai_conversations':
      return sweepDeleteRows(
        supabase,
        tenantId,
        'ai_conversations',
        plan.cutoff_iso,
        dryRun,
        'updated_at',
      )
    case 'ai_conversation_notes':
      return sweepDeleteRows(
        supabase,
        tenantId,
        'ai_conversation_notes',
        plan.cutoff_iso,
        dryRun,
        'created_at',
      )
    case 'agent_citations':
      return sweepDeleteRows(
        supabase,
        tenantId,
        'agent_citations',
        plan.cutoff_iso,
        dryRun,
        'created_at',
      )
    case 'webhook_deliveries':
      return sweepDeleteRows(
        supabase,
        tenantId,
        'webhook_deliveries',
        plan.cutoff_iso,
        dryRun,
        'received_at',
      )
  }
}

/**
 * Row-delete sweep. Loops in batches of BATCH_SIZE. Stops when a batch
 * comes back smaller than BATCH_SIZE (drain done) or after
 * MAX_BATCHES_PER_TABLE_PER_RUN (overflow — next run picks up).
 *
 * Tenant-scoping is non-negotiable on every batch. The PostgREST DELETE
 * with `.eq('tenant_id', …).lt(timestamp_col, cutoff)` translates to
 * `DELETE FROM table WHERE tenant_id = … AND <ts> < … LIMIT 1000`.
 * Postgres doesn't support LIMIT on DELETE directly so we emulate via
 * SELECT-IDS-then-DELETE-IN, which keeps the lock window short and
 * avoids deadlock with concurrent inserts.
 */
async function sweepDeleteRows(
  supabase: SupabaseClient,
  tenantId: string,
  table: string,
  cutoffIso: string,
  dryRun: boolean,
  timestampColumn: string,
  policyKey: RetentionTableName | string = table as RetentionTableName,
): Promise<PerTableResult> {
  let totalRows = 0
  let truncated = false

  for (let batch = 0; batch < MAX_BATCHES_PER_TABLE_PER_RUN; batch++) {
    // Phase 1: pick a bounded set of expired ids for this batch.
    const { data: ids, error: selectErr } = await supabase
      .from(table)
      .select('id')
      .eq('tenant_id', tenantId)
      .lt(timestampColumn, cutoffIso)
      .limit(BATCH_SIZE)

    if (selectErr) {
      return {
        table: policyKey as RetentionTableName,
        rows: totalRows,
        action: 'delete',
        truncated: false,
        error: `select failed: ${selectErr.message}`,
      }
    }

    const idList = (ids ?? []).map((r) => (r as { id: string }).id)
    if (idList.length === 0) break

    if (dryRun) {
      // Shadow mode — count without deleting. Stop after the first
      // batch to avoid double-counting on a paginated select (we'd
      // re-select the same rows next iteration since they aren't
      // being removed). Counting one batch gives "at least N would
      // be purged"; the per_table.truncated flag tags whether the
      // real run would loop further.
      totalRows = idList.length
      truncated = idList.length === BATCH_SIZE
      break
    }

    // Phase 2: delete the bounded set. Tenant-scoped on the delete too —
    // defence-in-depth even though the ids were already tenant-scoped
    // on selection.
    const { error: deleteErr } = await supabase
      .from(table)
      .delete()
      .eq('tenant_id', tenantId)
      .in('id', idList)

    if (deleteErr) {
      return {
        table: policyKey as RetentionTableName,
        rows: totalRows,
        action: 'delete',
        truncated: false,
        error: `delete failed: ${deleteErr.message}`,
      }
    }

    totalRows += idList.length

    // If we got fewer than BATCH_SIZE rows, the table is drained for
    // this run.
    if (idList.length < BATCH_SIZE) break

    if (batch === MAX_BATCHES_PER_TABLE_PER_RUN - 1) {
      truncated = true
    }
  }

  return {
    table: policyKey as RetentionTableName,
    rows: totalRows,
    action: 'delete',
    truncated,
  }
}

/**
 * Column-NULL sweep — used by `transcripts.raw_text` only. The row
 * survives (the summary + embedding remain product-valuable for the
 * full transcripts_summary window); the raw text column is set to
 * NULL so the most-sensitive PII drops out at 90 days.
 */
async function sweepNullColumn(
  supabase: SupabaseClient,
  tenantId: string,
  table: string,
  column: string,
  cutoffIso: string,
  dryRun: boolean,
  timestampColumn: string,
): Promise<PerTableResult> {
  let totalRows = 0
  let truncated = false

  for (let batch = 0; batch < MAX_BATCHES_PER_TABLE_PER_RUN; batch++) {
    // Pick rows that still have a non-null value in the target column
    // AND are past the cutoff. Idempotent — re-running won't re-touch
    // already-nulled rows.
    const { data: ids, error: selectErr } = await supabase
      .from(table)
      .select('id')
      .eq('tenant_id', tenantId)
      .lt(timestampColumn, cutoffIso)
      .not(column, 'is', null)
      .limit(BATCH_SIZE)

    if (selectErr) {
      return {
        table: 'transcripts_raw_text',
        rows: totalRows,
        action: 'null',
        truncated: false,
        error: `select failed: ${selectErr.message}`,
      }
    }

    const idList = (ids ?? []).map((r) => (r as { id: string }).id)
    if (idList.length === 0) break

    if (dryRun) {
      totalRows = idList.length
      truncated = idList.length === BATCH_SIZE
      break
    }

    const { error: updateErr } = await supabase
      .from(table)
      .update({ [column]: null })
      .eq('tenant_id', tenantId)
      .in('id', idList)

    if (updateErr) {
      return {
        table: 'transcripts_raw_text',
        rows: totalRows,
        action: 'null',
        truncated: false,
        error: `update failed: ${updateErr.message}`,
      }
    }

    totalRows += idList.length
    if (idList.length < BATCH_SIZE) break
    if (batch === MAX_BATCHES_PER_TABLE_PER_RUN - 1) truncated = true
  }

  return {
    table: 'transcripts_raw_text',
    rows: totalRows,
    action: 'null',
    truncated,
  }
}
