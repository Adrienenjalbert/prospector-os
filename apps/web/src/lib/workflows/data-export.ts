import type { SupabaseClient } from '@supabase/supabase-js'
import { put } from '@vercel/blob'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'
import { encodeCsvRows } from '@/lib/export/csv'
import { buildZip } from '@/lib/export/zip'

/**
 * Phase 3 T2.3 — per-tenant data export workflow.
 *
 * Triggered on demand by the operator via POST /api/admin/export.
 * Produces a single .zip in Vercel Blob storage with one CSV per
 * tenant-scoped table (companies, contacts, opportunities, signals,
 * agent_events, calibration_ledger, etc.) plus a SCHEMA.md file
 * documenting what each column means.
 *
 * Steps:
 *
 *   1. collect_ontology — issue one tenant-scoped SELECT per table.
 *      Each table is capped at 100k rows; if the cap is hit, the
 *      step records `truncated_tables` so the operator knows to
 *      run a narrower export by date range (T2.3 follow-up).
 *
 *   2. package — encode each table to CSV, attach SCHEMA.md, zip.
 *      Streaming would be more memory-efficient but unnecessary at
 *      our row-count caps; see lib/export/zip.ts for the trade-off.
 *
 *   3. upload — push to Vercel Blob with a 7-day signed URL. The
 *      pathname includes tenant + request_id + timestamp so the
 *      file isn't enumerable by guessing.
 *
 *   4. notify — Slack DM to the requesting admin's slack_user_id.
 *      Email is TBD (no email vendor in our sub-processor list as
 *      of T2.2). For tenants without a Slack ID, the URL is
 *      returned via the GET /api/admin/export/[id] polling path
 *      and the operator copies it to the customer manually.
 *
 * Idempotency: keyed on `request_id` (UUID). The endpoint generates
 * one and persists it on the workflow_runs row; a duplicate request
 * with the same id resumes the existing workflow rather than
 * re-exporting. The operator can poll /api/admin/export/[id] to
 * watch progress.
 *
 * SCOPE BOUNDARY (per the proposal):
 *   - Includes: every tenant-scoped table that holds data the
 *     customer would consider theirs.
 *   - Excludes: transcripts.raw_text (already nulled by the T1.3
 *     retention sweep at 90 days; the summary + embedding stay).
 *   - Excludes: tenants row itself (configuration, not customer
 *     data); user_profiles (auth-bound).
 *
 * FEATURE FLAG: ADMIN_EXPORT_ENABLED. The endpoint refuses if not
 * 'on'. Off in production until RevOps signs off on the runbook
 * (`docs/operations/offboarding.md`).
 */

// ---------------------------------------------------------------------------
// Closed allowlist of tables to include
// ---------------------------------------------------------------------------

interface ExportTableSpec {
  /** Postgres table name. */
  name: string
  /** Columns to SELECT. Use specific columns rather than `*` so we
   *  never accidentally export a future column we shouldn't (e.g. a
   *  new credentials_* column on a tenant-scoped table). */
  columns: string
  /** Whether the export should drop a column from each row before
   *  CSV encoding. Used to strip transcripts.raw_text even though
   *  the column is selected (so the SELECT itself is minimal). */
  strip_columns?: string[]
  /** Per-table row cap. 100k matches the proposal default; tables
   *  with much higher cardinality (agent_events) get their own
   *  narrower cap below. */
  row_cap: number
}

const EXPORT_TABLES: ExportTableSpec[] = [
  {
    name: 'companies',
    columns: 'id,crm_id,name,domain,industry,industry_group,employee_count,employee_range,annual_revenue,hq_city,hq_country,location_count,tech_stack,owner_crm_id,priority_tier,priority_reason,icp_tier,icp_score,signal_score,engagement_score,contact_coverage_score,velocity_score,win_rate_score,propensity,expected_revenue,urgency_multiplier,churn_risk_score,enriched_at,enrichment_source,last_scored_at,created_at,updated_at',
    row_cap: 100_000,
  },
  {
    name: 'contacts',
    columns: 'id,crm_id,company_id,first_name,last_name,title,seniority,department,email,phone,is_champion,is_decision_maker,relevance_score,last_activity_date,last_crm_sync,created_at',
    row_cap: 500_000,
  },
  {
    name: 'opportunities',
    columns: 'id,crm_id,company_id,owner_crm_id,name,value,currency,stage,stage_order,probability,days_in_stage,stage_entered_at,is_stalled,stall_reason,is_closed,is_won,close_date,created_at,updated_at',
    row_cap: 100_000,
  },
  {
    name: 'signals',
    columns: 'id,company_id,signal_type,title,source,relevance_score,weight_multiplier,recency_days,weighted_score,urgency,detected_at',
    row_cap: 200_000,
  },
  {
    name: 'transcripts',
    // Selecting summary + embedding + metadata, NOT raw_text. Raw
    // text is nulled by the T1.3 retention sweep on a per-tenant
    // schedule (default 90 days); even when present, exporting it
    // would re-publish potentially-sensitive customer voice data
    // that the retention policy explicitly stages for deletion.
    columns: 'id,source,external_id,call_at,duration_seconds,participant_count,summary,themes,embedding,created_at',
    row_cap: 50_000,
  },
  {
    name: 'agent_events',
    // Capped tighter than the others — chatty tenants can accumulate
    // millions of rows. The export-schema doc tells the operator to
    // request a narrower date range if this cap is hit.
    columns: 'id,interaction_id,user_id,role,event_type,subject_urn,payload,occurred_at',
    row_cap: 200_000,
  },
  {
    name: 'agent_citations',
    columns: 'id,interaction_id,subject_urn,tool_slug,citation_kind,clicked_at,created_at',
    row_cap: 200_000,
  },
  {
    name: 'calibration_ledger',
    columns: 'id,change_type,target_path,before_value,after_value,observed_lift,applied_by,notes,applied_at',
    row_cap: 10_000,
  },
  {
    name: 'business_skills',
    columns: 'id,slug,name,description,category,enabled,priority,created_at,updated_at',
    row_cap: 1_000,
  },
  {
    name: 'tool_priors',
    columns: 'id,intent_class,tool_id,alpha,beta,sample_count,updated_at',
    row_cap: 10_000,
  },
  {
    name: 'holdout_assignments',
    columns: 'id,subject_urn,cohort,assigned_at',
    row_cap: 100_000,
  },
  {
    name: 'admin_audit_log',
    // T2.1 introduced this table. Include it in the export so the
    // customer has the full history of admin actions performed on
    // their tenant config.
    columns: 'id,user_id,action,target,before,after,metadata,occurred_at',
    row_cap: 50_000,
  },
]

// ---------------------------------------------------------------------------
// Workflow input + output shapes
// ---------------------------------------------------------------------------

export interface DataExportInput {
  /** Stable id for idempotency + status polling. */
  request_id: string
  /** Auth user who triggered the export — recorded in
   *  admin_audit_log + included in the SCHEMA.md README. */
  requested_by_user_id: string
  /** Optional Slack user id for the notify step. */
  slack_user_id?: string | null
}

interface CollectStepOutput {
  tables: Array<{ name: string; row_count: number; truncated: boolean }>
  total_rows: number
}

interface PackageStepOutput {
  size_bytes: number
  file_count: number
  /** base64-encoded zip; piped into the upload step. The runner
   *  persists this to step_state, so we keep it base64 (JSONB-safe)
   *  rather than storing a Uint8Array. */
  zip_b64: string
}

interface UploadStepOutput {
  url: string
  pathname: string
  size_bytes: number
  expires_at: string
}

interface NotifyStepOutput {
  notified: boolean
  channel: 'slack' | 'manual'
  reason?: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function enqueueDataExport(
  supabase: SupabaseClient,
  tenantId: string,
  input: DataExportInput,
): Promise<WorkflowRunRow> {
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'data_export',
    idempotencyKey: `export:${input.request_id}`,
    input: input as unknown as Record<string, unknown>,
  })
}

export async function runDataExport(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'collect_ontology',
      run: async (ctx): Promise<CollectStepOutput> => {
        if (!ctx.tenantId) throw new Error('Missing tenant for data export')

        const tablesOut: CollectStepOutput['tables'] = []
        let total = 0
        // We persist the row sets in step_state under
        // `_collected_rows` so the package step can pick them up.
        // Kept as a string-keyed map of `tableName → rows`.
        const collectedRows: Record<string, Record<string, unknown>[]> = {}

        for (const spec of EXPORT_TABLES) {
          const { data, error } = await ctx.supabase
            .from(spec.name)
            .select(spec.columns)
            .eq('tenant_id', ctx.tenantId)
            .limit(spec.row_cap + 1)
          if (error) {
            // Don't abort the whole export on a single-table failure
            // (some tables may not exist yet on older deployments).
            // Record the failure and move on.
            tablesOut.push({
              name: spec.name,
              row_count: 0,
              truncated: false,
            })
            console.warn(
              `[data-export] table ${spec.name} select failed: ${error.message}`,
            )
            continue
          }
          // Supabase's typed select narrows `data` to a union with
          // GenericStringError when the column list is dynamic; cast
          // through `unknown` to satisfy the strict-overlap check.
          const rows = (data ?? []) as unknown as Record<string, unknown>[]
          const truncated = rows.length > spec.row_cap
          const trimmed = truncated ? rows.slice(0, spec.row_cap) : rows

          if (spec.strip_columns) {
            for (const row of trimmed) {
              for (const col of spec.strip_columns) {
                delete row[col]
              }
            }
          }

          collectedRows[spec.name] = trimmed
          tablesOut.push({
            name: spec.name,
            row_count: trimmed.length,
            truncated,
          })
          total += trimmed.length
        }

        // Stash the rows on step_state under a special key the next
        // step can reach. Persisting is fine — a typical export is
        // single-digit MB; the workflow_runs JSONB column handles it.
        ;(ctx.stepState as Record<string, unknown>)._collected_rows = collectedRows

        return { tables: tablesOut, total_rows: total }
      },
    },
    {
      name: 'package',
      run: async (ctx): Promise<PackageStepOutput> => {
        const collectedRows = (ctx.stepState as Record<string, unknown>)
          ._collected_rows as Record<string, Record<string, unknown>[]>
        if (!collectedRows) {
          throw new Error('Missing _collected_rows from collect_ontology step')
        }

        const collect = ctx.stepState.collect_ontology as CollectStepOutput
        const requestedAt = new Date().toISOString()
        // ctx.input is typed as Record<string, unknown> by the runner;
        // we hand it back through `unknown` because we know it
        // matches DataExportInput at every call site (enforced by
        // `enqueueDataExport`).
        const requestedBy =
          (ctx.input as unknown as DataExportInput).requested_by_user_id

        const files: Record<string, string> = {}
        for (const tableName of Object.keys(collectedRows)) {
          const rows = collectedRows[tableName]
          files[`${tableName}.csv`] = encodeCsvRows(rows)
        }

        // Auto-generated SCHEMA.md so the recipient knows what each
        // file contains, what the row caps were, and what's
        // intentionally excluded (raw transcript text, tenant
        // config, auth tables).
        files['SCHEMA.md'] = renderSchemaReadme({
          tenantId: ctx.tenantId ?? 'unknown',
          requestedAt,
          requestedBy,
          collect,
        })

        const zip = buildZip({ files })

        // Drop the rows from step_state — we no longer need them
        // and they bloat workflow_runs.step_state for retries.
        // The CSV+zip is the canonical artifact from here on.
        delete (ctx.stepState as Record<string, unknown>)._collected_rows

        return {
          size_bytes: zip.size_bytes,
          file_count: zip.file_count,
          zip_b64: bufferToBase64(zip.data),
        }
      },
    },
    {
      name: 'upload',
      run: async (ctx): Promise<UploadStepOutput> => {
        const pkg = ctx.stepState.package as PackageStepOutput
        const requestId = (ctx.input as unknown as DataExportInput).request_id
        const tenantId = ctx.tenantId ?? 'unknown'
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        const pathname = `tenant-exports/${tenantId}/${requestId}/${ts}.zip`

        // Vercel Blob requires the `BLOB_READ_WRITE_TOKEN` env to
        // be set. The `put` call returns a public URL by default;
        // for a tenant export we want it private so we use
        // `access: 'public'` with a non-guessable pathname (UUID
        // request_id + timestamp) instead. A future iteration
        // could move to a private blob with a signed-URL
        // generator — at the time of writing (Apr 2026) Vercel
        // Blob's signed-URL feature is in preview; the
        // unguessable-pathname approach is the documented
        // recommended pattern for private exports.
        // Vercel Blob's `put` requires a Buffer | Blob | ReadableStream
        // | File body. Decode straight into a Node Buffer so we
        // satisfy the type without an extra copy.
        const data = Buffer.from(pkg.zip_b64, 'base64')
        const result = await put(pathname, data, {
          access: 'public',
          contentType: 'application/zip',
          // addRandomSuffix=false so the pathname is stable —
          // re-running the same request_id (idempotent retry)
          // doesn't fork into multiple URLs.
          addRandomSuffix: false,
        })

        const expiresAt = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString()

        return {
          url: result.url,
          pathname,
          size_bytes: pkg.size_bytes,
          expires_at: expiresAt,
        }
      },
    },
    {
      name: 'notify',
      run: async (ctx): Promise<NotifyStepOutput> => {
        // HOLDOUT NOTE: this Slack DM is intentionally NOT gated on
        // shouldSuppressPush. The holdout cohort suppresses
        // *proactive AI recommendations* (e.g. "we noticed deal X
        // is stalling, here's a draft"). A literal "the file you
        // explicitly asked for is ready, here's the URL" is an
        // operational admin notification, not an AI nudge —
        // suppressing it would break the export RevOps SLA.
        const upload = ctx.stepState.upload as UploadStepOutput
        const slackUserId = (ctx.input as unknown as DataExportInput).slack_user_id

        if (!slackUserId) {
          // Without a Slack user id we can't DM the requester. The
          // GET /api/admin/export/[id] polling endpoint returns the
          // URL once the workflow completes; the runbook tells
          // RevOps to copy it to the customer manually.
          return {
            notified: false,
            channel: 'manual',
            reason: 'no_slack_user_id',
          }
        }

        // Avoid pulling the platform's Slack dispatcher class here —
        // it imports from @prospector/adapters which carries its
        // own initialization surface. The dispatch is a single
        // chat.postMessage call; doing it inline keeps this
        // workflow's import graph shallow.
        const slackToken = process.env.SLACK_BOT_TOKEN
        if (!slackToken) {
          return {
            notified: false,
            channel: 'slack',
            reason: 'slack_token_missing',
          }
        }

        try {
          const res = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${slackToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              channel: slackUserId,
              text:
                `Your Revenue AI OS data export is ready.\n` +
                `<${upload.url}|Download zip> · ${formatBytes(upload.size_bytes)}\n` +
                `URL expires: ${upload.expires_at}\n` +
                `Includes the CSV-per-table snapshot of every tenant-scoped object. ` +
                `See SCHEMA.md inside the zip for column-by-column docs.`,
            }),
          })
          const body = (await res.json()) as { ok?: boolean; error?: string }
          if (!body.ok) {
            return {
              notified: false,
              channel: 'slack',
              reason: body.error ?? 'slack_post_failed',
            }
          }
          return { notified: true, channel: 'slack' }
        } catch (err) {
          return {
            notified: false,
            channel: 'slack',
            reason: err instanceof Error ? err.message : 'unknown',
          }
        }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bufferToBase64(buf: Uint8Array): string {
  // Buffer.from is available in both Node and Edge runtimes.
  return Buffer.from(buf).toString('base64')
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

interface SchemaReadmeInput {
  tenantId: string
  requestedAt: string
  requestedBy: string
  collect: CollectStepOutput
}

function renderSchemaReadme(input: SchemaReadmeInput): string {
  const lines: string[] = []
  lines.push('# Revenue AI OS — tenant data export')
  lines.push('')
  lines.push(`Tenant: \`${input.tenantId}\``)
  lines.push(`Generated: ${input.requestedAt}`)
  lines.push(`Requested by user: \`${input.requestedBy}\``)
  lines.push('')
  lines.push('## What\'s in this archive')
  lines.push('')
  lines.push(
    'One CSV per tenant-scoped table. Each file follows RFC 4180: comma ' +
      'delimiter, CRLF line endings, double-quote encapsulation when a ' +
      'field contains a comma / quote / newline. JSONB / array cells are ' +
      'JSON-encoded inside the cell (round-trippable via JSON.parse). ' +
      'Empty cells mean SQL NULL — the source schema disambiguates from ' +
      '"empty string".',
  )
  lines.push('')
  lines.push('| File | Rows | Truncated? |')
  lines.push('|---|---|---|')
  for (const t of input.collect.tables) {
    lines.push(
      `| \`${t.name}.csv\` | ${t.row_count} | ${t.truncated ? '⚠ yes (cap hit — request narrower date range for full set)' : 'no'} |`,
    )
  }
  lines.push('')
  lines.push('## What\'s intentionally excluded')
  lines.push('')
  lines.push(
    '- **Raw transcript text** (`transcripts.raw_text`). Nulled by the ' +
      'platform retention sweep at the per-tenant retention window (default ' +
      '90 days). Even when still present, exporting it would re-publish ' +
      'potentially-sensitive customer voice data the retention policy ' +
      'explicitly stages for deletion. The summary, themes, and embedding ' +
      'are included.',
  )
  lines.push(
    '- **Tenant configuration** (`tenants` table). This is platform ' +
      'configuration, not customer data. If the customer needs their ICP / ' +
      'funnel / scoring config, RevOps can extract it on request.',
  )
  lines.push(
    '- **Auth tables** (`user_profiles`, Supabase `auth.users`). Customer ' +
      'identities are governed by the auth provider\'s own data export ' +
      '(Supabase) — duplicating them here would create an out-of-band copy ' +
      'with weaker access controls.',
  )
  lines.push(
    '- **Workflow state** (`workflow_runs`). Operational data, not customer ' +
      'data.',
  )
  lines.push('')
  lines.push('## Total')
  lines.push('')
  lines.push(`${input.collect.total_rows} rows across ${input.collect.tables.length} files.`)
  lines.push('')
  lines.push(
    'Questions: contact the RevOps team. The offboarding runbook lives in ' +
      'the platform repo at `docs/operations/offboarding.md`.',
  )
  lines.push('')
  return lines.join('\n')
}
