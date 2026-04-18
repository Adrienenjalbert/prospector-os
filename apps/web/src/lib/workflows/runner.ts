import type { SupabaseClient } from '@supabase/supabase-js'
import type { ZodSchema } from 'zod'

/**
 * Thin durable-workflow runner. Each workflow is a sequence of named steps.
 * Step results are persisted to `workflow_runs.step_state` so a retry picks
 * up where the previous attempt left off. This is a narrow subset of what
 * Vercel Workflow DevKit provides, written to the same API shape so we can
 * swap to DevKit later without changing workflow authors' code.
 *
 * Design contract:
 *   - Steps must be pure enough to retry safely (use idempotency keys on
 *     external writes).
 *   - Errors in a step abort the run; the `workflow_runs` row records the
 *     error and status='error'. Subsequent runs with the same idempotency_key
 *     will resume from the last successful step.
 *   - Steps that need to wait (e.g. "fire 15 min before meeting") set a
 *     `scheduled_for` timestamp and return early; a cron picks up runs whose
 *     `scheduled_for` has passed.
 */

export type WorkflowStatus =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'error'
  | 'cancelled'

export interface WorkflowRunRow {
  id: string
  tenant_id: string | null
  workflow_name: string
  subject_urn: string | null
  idempotency_key: string | null
  status: WorkflowStatus
  current_step: string | null
  step_state: Record<string, unknown>
  input: Record<string, unknown> | null
  output: Record<string, unknown> | null
  error: string | null
  attempts: number
  scheduled_for: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface StartWorkflowInput {
  tenantId: string | null
  workflowName: string
  subjectUrn?: string | null
  idempotencyKey?: string | null
  input?: Record<string, unknown>
  scheduledFor?: Date | string | null
}

/**
 * Creates a workflow run record. If an idempotency key collides we return the
 * existing row so callers can safely retry the enqueue. The caller is then
 * responsible for invoking the workflow's step function (or deferring to a
 * cron / queue processor).
 *
 * SECURITY — the dedupe lookup MUST scope by `tenant_id`. The DB unique
 * index is `(tenant_id, workflow_name, idempotency_key)` (see
 * `packages/db/migrations/002_event_sourcing_and_foundation.sql`), so the
 * same idempotency key can legitimately exist in two tenants. Without
 * tenant scoping the lookup can return *another tenant's* run row,
 * causing the caller to operate on the wrong workflow_runs.id and
 * corrupt cross-tenant state. Scoping here is mandatory; only admin
 * workflows with an explicit null tenant scope to NULL.
 */
export async function startWorkflow(
  supabase: SupabaseClient,
  input: StartWorkflowInput,
): Promise<WorkflowRunRow> {
  const { tenantId, workflowName, subjectUrn, idempotencyKey, scheduledFor } = input

  if (idempotencyKey) {
    let q = supabase
      .from('workflow_runs')
      .select('*')
      .eq('workflow_name', workflowName)
      .eq('idempotency_key', idempotencyKey)

    q = tenantId == null ? q.is('tenant_id', null) : q.eq('tenant_id', tenantId)

    const { data: existing } = await q.maybeSingle()
    if (existing) return existing as WorkflowRunRow
  }

  const scheduled =
    scheduledFor instanceof Date
      ? scheduledFor.toISOString()
      : (scheduledFor ?? null)

  const { data, error } = await supabase
    .from('workflow_runs')
    .insert({
      tenant_id: tenantId,
      workflow_name: workflowName,
      subject_urn: subjectUrn ?? null,
      idempotency_key: idempotencyKey ?? null,
      input: input.input ?? {},
      status: scheduled ? 'scheduled' : 'pending',
      scheduled_for: scheduled,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`Failed to start workflow: ${error?.message}`)
  }
  return data as WorkflowRunRow
}

export interface StepContext {
  runId: string
  tenantId: string | null
  supabase: SupabaseClient
  input: Record<string, unknown>
  stepState: Record<string, unknown>
}

export interface Step<Name extends string = string, Result = unknown> {
  name: Name
  run: (ctx: StepContext) => Promise<Result>
  /**
   * Optional Zod schema validated against the step's result on write.
   * Throws StepShapeError on mismatch so retries surface the shape bug
   * rather than corrupting step_state. Opt-in — existing steps keep
   * working without one.
   */
  schema?: ZodSchema<Result>
}

export interface RunWorkflowOptions {
  supabase: SupabaseClient
  runId: string
  steps: Step[]
}

/**
 * Executes a workflow run by walking through the step list in order.
 * Already-completed steps (recorded in step_state) are skipped, so resuming
 * a failed run picks up at the first incomplete step.
 *
 * Step outputs accumulate in `step_state[stepName]`. A step that needs to
 * wait returns a `{ wait_until: ISOString }` sentinel; the runner persists
 * and returns, leaving status='scheduled' for a later cron to pick up.
 */
export async function runWorkflow(opts: RunWorkflowOptions): Promise<WorkflowRunRow> {
  const { supabase, runId, steps } = opts

  const { data: row, error } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('id', runId)
    .single()

  if (error || !row) throw new Error(`Run ${runId} not found`)
  const current = row as WorkflowRunRow

  if (current.status === 'completed' || current.status === 'cancelled') {
    return current
  }

  await supabase
    .from('workflow_runs')
    .update({
      status: 'running',
      started_at: current.started_at ?? new Date().toISOString(),
      attempts: (current.attempts ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)

  const stepState = { ...(current.step_state ?? {}) }

  for (const step of steps) {
    if (stepState[step.name] !== undefined) continue // resumed

    try {
      const rawResult = await step.run({
        runId,
        tenantId: current.tenant_id,
        supabase,
        input: current.input ?? {},
        stepState,
      })

      // Sentinel (skip schema validation): step asked to wait.
      if (
        rawResult &&
        typeof rawResult === 'object' &&
        'wait_until' in rawResult &&
        typeof (rawResult as { wait_until: unknown }).wait_until === 'string'
      ) {
        await supabase
          .from('workflow_runs')
          .update({
            status: 'scheduled',
            current_step: step.name,
            step_state: stepState,
            scheduled_for: (rawResult as { wait_until: string }).wait_until,
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId)

        const { data: waitingRow } = await supabase
          .from('workflow_runs')
          .select('*')
          .eq('id', runId)
          .single()
        return waitingRow as WorkflowRunRow
      }

      // Validate against the step's schema if it declares one (Phase 6).
      // Throws StepShapeError on mismatch; caught by the try/catch below
      // and classified FATAL so the runner doesn't retry a shape bug.
      const result = validateAgainstSchema(step.name, step.schema, rawResult)

      stepState[step.name] = result ?? null

      await supabase
        .from('workflow_runs')
        .update({
          current_step: step.name,
          step_state: stepState,
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const classification = classifyError(err)

      // FATAL classifications get a distinctive error prefix and a
      // workflow_fatal outcome event so the notification cron can page
      // on-call. Transient / unknown errors land as plain 'error' so the
      // cron picks them up on the next drain.
      await supabase
        .from('workflow_runs')
        .update({
          status: 'error',
          error: classification === 'fatal' ? `FATAL at ${step.name}: ${message}` : message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId)

      if (classification === 'fatal') {
        await emitFatalAlert(supabase, current, step.name, message)
      }
      throw err
    }
  }

  const { data: doneRow } = await supabase
    .from('workflow_runs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      step_state: stepState,
      output: stepState,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .select('*')
    .single()

  return doneRow as WorkflowRunRow
}

/**
 * Cron helper: picks up scheduled workflows whose `scheduled_for` has passed.
 * Each run is dispatched via the supplied dispatcher function.
 */
export async function drainScheduledWorkflows(
  supabase: SupabaseClient,
  dispatcher: (row: WorkflowRunRow) => Promise<void>,
  limit = 20,
): Promise<number> {
  const { data } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(limit)

  const rows = (data ?? []) as WorkflowRunRow[]
  for (const row of rows) {
    try {
      await dispatcher(row)
    } catch (err) {
      console.warn(`[workflow-runner] dispatch failed for ${row.id}:`, err)
    }
  }
  return rows.length
}

/**
 * Convenience wrapper: start + run in one call. Useful when you know the
 * workflow completes quickly and doesn't need scheduling.
 */
export async function startAndRun(
  supabase: SupabaseClient,
  input: StartWorkflowInput,
  steps: Step[],
): Promise<WorkflowRunRow> {
  const row = await startWorkflow(supabase, input)
  return runWorkflow({ supabase, runId: row.id, steps })
}

// ---------------------------------------------------------------------------
// DAG runner (Phase 1 — parallel layers + trigger rules)
//
// Additive: existing step-array workflows keep using runWorkflow. New
// workflows opt into runWorkflowDag when they have parallel-able fetches or
// want graceful degradation via trigger rules.
//
// The DAG is a topological ordering of nodes. Nodes with no unmet deps run
// concurrently. A node's trigger_rule decides whether it runs based on the
// settlement of its dependencies. Node outputs are persisted to
// `workflow_runs.step_state[node.id]` identically to the step runner — so
// resume on failure works the same way.
// ---------------------------------------------------------------------------

export type TriggerRule =
  | 'all_success'
  | 'one_success'
  | 'none_failed_min_one_success'
  | 'all_done'

export interface DagNode<Result = unknown> {
  id: string
  dependsOn?: string[]
  triggerRule?: TriggerRule
  /**
   * Predicate evaluated before the node runs. Receives the current
   * `step_state` so you can branch on `state.upstream.output.x == 'y'`.
   * When the predicate returns false the node is recorded as `skipped`.
   */
  when?: (state: Record<string, unknown>) => boolean
  run: (ctx: StepContext) => Promise<Result>
  /**
   * Optional Zod schema validated against the node's result on write.
   * Catches shape-drift bugs between nodes. Opt-in.
   */
  schema?: ZodSchema<Result>
  /**
   * Optional per-node timeout in ms. 0 / undefined = no runner-level
   * timeout (the underlying handler may still have its own).
   */
  timeout?: number
}

/**
 * Thrown when a step or node result doesn't match its declared Zod schema.
 * Classified as FATAL so the runner doesn't retry a shape bug — the code
 * is broken, not the network.
 */
export class StepShapeError extends Error {
  public readonly stepName: string
  public readonly zodIssues: unknown
  constructor(stepName: string, zodIssues: unknown, summary: string) {
    // Prefix with "shape_error" so the classifier treats it as FATAL
    // ("authentication failed"-style grep match below wouldn't hit; we
    // intentionally use a distinct token the classifier recognises).
    super(`shape_error at ${stepName}: ${summary}`)
    this.name = 'StepShapeError'
    this.stepName = stepName
    this.zodIssues = zodIssues
  }
}

function validateAgainstSchema<T>(
  name: string,
  schema: ZodSchema<T> | undefined,
  value: unknown,
): T {
  if (!schema) return value as T
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const summary = parsed.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
  throw new StepShapeError(name, parsed.error.issues, summary)
}

interface NodeSettlement {
  status: 'completed' | 'failed' | 'skipped'
  error?: string
}

export interface RunWorkflowDagOptions {
  supabase: SupabaseClient
  runId: string
  nodes: DagNode[]
}

/**
 * Execute a DAG of nodes. Nodes in the same topological layer run
 * concurrently. trigger_rule determines whether a downstream node runs
 * given the settlement of its dependencies.
 *
 * Persistence model: identical to `runWorkflow` — completed node results
 * land in `workflow_runs.step_state` under the node id. A resumed run
 * skips any node that already has a recorded settlement.
 *
 * Error semantics: a node that throws settles as `failed`. Downstream
 * nodes evaluate their trigger_rule against upstream settlements and
 * may still run (e.g. `none_failed_min_one_success`), skip, or fail the
 * whole run if any required dependency rejected.
 *
 * Fatal-classified errors (see Phase 2) abort the whole run regardless
 * of trigger rules — you never retry an auth failure.
 */
export async function runWorkflowDag(
  opts: RunWorkflowDagOptions,
): Promise<WorkflowRunRow> {
  const { supabase, runId, nodes } = opts

  validateDag(nodes)

  const { data: row, error } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('id', runId)
    .single()

  if (error || !row) throw new Error(`Run ${runId} not found`)
  const current = row as WorkflowRunRow

  if (current.status === 'completed' || current.status === 'cancelled') {
    return current
  }

  await supabase
    .from('workflow_runs')
    .update({
      status: 'running',
      started_at: current.started_at ?? new Date().toISOString(),
      attempts: (current.attempts ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)

  const stepState: Record<string, unknown> = { ...(current.step_state ?? {}) }
  const settlements: Record<string, NodeSettlement> = {}

  // Hydrate settlements from persisted state so resumed runs don't re-run
  // already-completed nodes.
  for (const node of nodes) {
    if (stepState[node.id] !== undefined) {
      const prior = stepState[node.id] as { __skipped?: boolean } | null | undefined
      settlements[node.id] = {
        status: prior && typeof prior === 'object' && prior.__skipped ? 'skipped' : 'completed',
      }
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const remaining = new Set(nodes.filter((n) => !settlements[n.id]).map((n) => n.id))

  while (remaining.size > 0) {
    const readyLayer: DagNode[] = []
    for (const id of remaining) {
      const node = nodeMap.get(id)!
      const deps = node.dependsOn ?? []
      const allSettled = deps.every((d) => settlements[d] !== undefined)
      if (allSettled) readyLayer.push(node)
    }

    if (readyLayer.length === 0) {
      // No node is ready but some still remain — DAG is stuck (shouldn't
      // happen after validateDag but guard anyway).
      const stuck = Array.from(remaining).join(', ')
      throw new Error(`DAG stuck — no ready nodes, remaining: ${stuck}`)
    }

    // Decide per-node: run, skip (trigger rule or when-predicate), or fail.
    const plan = readyLayer.map((node) => {
      const decision = decideNode(node, settlements)
      return { node, decision }
    })

    const toRun = plan.filter((p) => p.decision === 'run')
    const toSkip = plan.filter((p) => p.decision === 'skip')
    const toFail = plan.filter((p) => p.decision === 'fail')

    // Skips land first so downstream nodes can see the settlement.
    for (const { node } of toSkip) {
      settlements[node.id] = { status: 'skipped' }
      stepState[node.id] = { __skipped: true }
      remaining.delete(node.id)
    }

    // A fail at this layer aborts the run — the upstream chain couldn't
    // satisfy this node's trigger rule, so we can't honour the workflow.
    if (toFail.length > 0) {
      const reasons = toFail
        .map(({ node }) => `${node.id}: trigger_rule ${node.triggerRule ?? 'all_success'} unmet`)
        .join('; ')
      const message = `DAG aborted — ${reasons}`
      await supabase
        .from('workflow_runs')
        .update({
          status: 'error',
          error: message,
          step_state: stepState,
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId)
      throw new Error(message)
    }

    if (toRun.length === 0) continue

    // Run this layer concurrently via Promise.allSettled so one failure
    // doesn't abort its siblings. Each node's settlement informs downstream
    // trigger rules.
    const results = await Promise.allSettled(
      toRun.map(async ({ node }) => {
        // when-predicate with access to the current state.
        if (node.when && !node.when(stepState)) {
          return { nodeId: node.id, skipped: true as const }
        }

        const runCtx: StepContext = {
          runId,
          tenantId: current.tenant_id,
          supabase,
          input: current.input ?? {},
          stepState,
        }

        const rawValue = node.timeout
          ? await withTimeout(node.run(runCtx), node.timeout, node.id)
          : await node.run(runCtx)

        // Schema validation for DAG nodes (Phase 6). Wait_until sentinels
        // skip the check; everything else is validated when a schema is
        // declared.
        const isWait =
          rawValue &&
          typeof rawValue === 'object' &&
          'wait_until' in rawValue &&
          typeof (rawValue as { wait_until: unknown }).wait_until === 'string'

        const value = isWait ? rawValue : validateAgainstSchema(node.id, node.schema, rawValue)

        return { nodeId: node.id, value }
      }),
    )

    let waitResult: { nodeId: string; wait_until: string } | null = null

    for (let i = 0; i < results.length; i++) {
      const outcome = results[i]
      const nodeId = toRun[i].node.id

      if (outcome.status === 'rejected') {
        const err = outcome.reason
        const message = err instanceof Error ? err.message : String(err)

        // Fatal errors abort immediately — this is Phase 2's guarantee.
        // For non-fatal rejections we settle the node as `failed` and let
        // downstream trigger rules decide how the rest of the DAG behaves.
        const classification = classifyError(err)
        if (classification === 'fatal') {
          await supabase
            .from('workflow_runs')
            .update({
              status: 'error',
              error: `FATAL at ${nodeId}: ${message}`,
              step_state: stepState,
              updated_at: new Date().toISOString(),
            })
            .eq('id', runId)
          await emitFatalAlert(supabase, current, nodeId, message)
          throw err
        }

        settlements[nodeId] = { status: 'failed', error: message }
        stepState[nodeId] = { __error: message }
        remaining.delete(nodeId)
        continue
      }

      const ok = outcome.value
      if ('skipped' in ok && ok.skipped) {
        settlements[nodeId] = { status: 'skipped' }
        stepState[nodeId] = { __skipped: true }
        remaining.delete(nodeId)
        continue
      }

      const value = (ok as { value: unknown }).value

      if (
        value &&
        typeof value === 'object' &&
        'wait_until' in value &&
        typeof (value as { wait_until: unknown }).wait_until === 'string'
      ) {
        waitResult = {
          nodeId,
          wait_until: (value as { wait_until: string }).wait_until,
        }
        continue
      }

      settlements[nodeId] = { status: 'completed' }
      stepState[nodeId] = value ?? null
      remaining.delete(nodeId)
    }

    // Persist progress after each layer for cheap resume.
    await supabase
      .from('workflow_runs')
      .update({
        step_state: stepState,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId)

    // If any node in this layer asked to wait, park the whole run. We
    // resume on the next cron drain and re-enter the same layer.
    if (waitResult) {
      await supabase
        .from('workflow_runs')
        .update({
          status: 'scheduled',
          current_step: waitResult.nodeId,
          scheduled_for: waitResult.wait_until,
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId)

      const { data: waitingRow } = await supabase
        .from('workflow_runs')
        .select('*')
        .eq('id', runId)
        .single()
      return waitingRow as WorkflowRunRow
    }
  }

  const { data: doneRow } = await supabase
    .from('workflow_runs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      step_state: stepState,
      output: stepState,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .select('*')
    .single()

  return doneRow as WorkflowRunRow
}

function decideNode(
  node: DagNode,
  settlements: Record<string, NodeSettlement>,
): 'run' | 'skip' | 'fail' {
  const deps = node.dependsOn ?? []
  if (deps.length === 0) return 'run'

  const depSettlements = deps.map((d) => settlements[d])
  const succeeded = depSettlements.filter((s) => s.status === 'completed').length
  const failed = depSettlements.filter((s) => s.status === 'failed').length
  const skipped = depSettlements.filter((s) => s.status === 'skipped').length

  const rule = node.triggerRule ?? 'all_success'

  switch (rule) {
    case 'all_success':
      if (failed === 0 && skipped === 0 && succeeded === deps.length) return 'run'
      // If any dep failed or was skipped, downstream skip-rather-than-fail
      // — matches Archon's "fail-closed" semantics for conditions.
      return 'skip'
    case 'one_success':
      return succeeded > 0 ? 'run' : 'fail'
    case 'none_failed_min_one_success':
      if (failed > 0) return 'skip'
      return succeeded > 0 ? 'run' : 'skip'
    case 'all_done':
      // All terminal states count — this is how you build "cleanup" nodes.
      return 'run'
  }
}

function validateDag(nodes: DagNode[]): void {
  const ids = new Set<string>()
  for (const n of nodes) {
    if (ids.has(n.id)) throw new Error(`Duplicate node id: ${n.id}`)
    ids.add(n.id)
  }
  for (const n of nodes) {
    for (const d of n.dependsOn ?? []) {
      if (!ids.has(d)) throw new Error(`Node ${n.id} depends on unknown node ${d}`)
    }
  }
  // Cycle detection via DFS.
  const visited = new Set<string>()
  const stack = new Set<string>()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const walk = (id: string): void => {
    if (stack.has(id)) throw new Error(`Cycle detected at node ${id}`)
    if (visited.has(id)) return
    stack.add(id)
    for (const d of byId.get(id)!.dependsOn ?? []) walk(d)
    stack.delete(id)
    visited.add(id)
  }
  for (const n of nodes) walk(n.id)
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  nodeId: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Node ${nodeId} timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Error classification (Phase 2)
//
// Used by both runWorkflow and runWorkflowDag. Patterns mirror Archon's
// classifier so behaviour is consistent with the dev-time harness.
// ---------------------------------------------------------------------------

export type ErrorClass = 'fatal' | 'transient' | 'unknown'

const FATAL_PATTERNS = [
  /\bunauthori[sz]ed\b/i,
  /\bforbidden\b/i,
  /\b401\b/,
  /\b403\b/,
  /\binvalid[_\s-]?token\b/i,
  /\bauthentication\s+failed\b/i,
  /\bauth\s+error\b/i,
  /\bpermission\s+denied\b/i,
  /\bcredit\s+balance\b/i,
  /\brls\s+violation\b/i,
  /\brow[-\s]level\s+security\b/i,
]

const TRANSIENT_PATTERNS = [
  /\b429\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /\btoo\s+many\s+requests\b/i,
  /\brate[-\s]?limit(ed)?\b/i,
  /\btimeout\b/i,
  /\betimedout\b/i,
  /\beconnreset\b/i,
  /\beconnrefused\b/i,
  /\bsocket\s+hang\s+up\b/i,
  /\bnetwork\s+error\b/i,
]

export function classifyError(err: unknown): ErrorClass {
  // Explicit type check for shape errors — these are code bugs, not
  // network / auth issues, and must never retry.
  if (err instanceof StepShapeError) return 'fatal'
  const message = err instanceof Error ? err.message : String(err ?? '')
  // FATAL wins over TRANSIENT when both match — mirrors Archon.
  if (FATAL_PATTERNS.some((re) => re.test(message))) return 'fatal'
  if (TRANSIENT_PATTERNS.some((re) => re.test(message))) return 'transient'
  return 'unknown'
}

async function emitFatalAlert(
  supabase: SupabaseClient,
  run: WorkflowRunRow,
  nodeId: string,
  message: string,
): Promise<void> {
  // Always log — Vercel captures this and on-call sees it even if Slack
  // delivery later fails. Format is greppable.
  console.error(
    `[workflow_fatal] workflow=${run.workflow_name} run_id=${run.id} tenant_id=${
      run.tenant_id ?? 'null'
    } node=${nodeId} error=${message}`,
  )

  // Event-source the alert when we have the required scoping columns.
  // outcome_events has tenant_id + subject_urn as NOT NULL, so admin-scope
  // workflows (tenant_id null) log only and skip the event.
  if (run.tenant_id && run.subject_urn) {
    try {
      await supabase.from('outcome_events').insert({
        tenant_id: run.tenant_id,
        subject_urn: run.subject_urn,
        event_type: 'workflow_fatal',
        source: 'workflow_runner',
        payload: {
          workflow: run.workflow_name,
          run_id: run.id,
          node_id: nodeId,
          error: message,
        },
      })
    } catch (err) {
      // Never throw from the alerter — we're already handling a fatal.
      console.warn('[runner] emitFatalAlert outcome_event failed:', err)
    }
  }

  // Best-effort direct Slack dispatch for ops channel. SLACK_OPS_CHANNEL is
  // a Slack channel id (e.g. "C0123ABC") where ops-grade alerts land. Keep
  // this off by default so test/preview envs don't spam.
  const slackToken = process.env.SLACK_BOT_TOKEN
  const opsChannel = process.env.SLACK_OPS_CHANNEL
  if (slackToken && opsChannel) {
    try {
      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${slackToken}`,
        },
        body: JSON.stringify({
          channel: opsChannel,
          text: `:rotating_light: FATAL workflow error`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  `*:rotating_light: FATAL* in \`${run.workflow_name}\`\n` +
                  `• run: \`${run.id}\`\n` +
                  `• tenant: \`${run.tenant_id ?? 'null'}\`\n` +
                  `• node: \`${nodeId}\`\n` +
                  `• error: \`${message.slice(0, 500)}\``,
              },
            },
          ],
        }),
      })
    } catch (err) {
      console.warn('[runner] emitFatalAlert Slack dispatch failed:', err)
    }
  }
}

/**
 * Starts a DAG workflow and runs it immediately.
 */
export async function startAndRunDag(
  supabase: SupabaseClient,
  input: StartWorkflowInput,
  nodes: DagNode[],
): Promise<WorkflowRunRow> {
  const row = await startWorkflow(supabase, input)
  return runWorkflowDag({ supabase, runId: row.id, nodes })
}

// ---------------------------------------------------------------------------
// loopUntil — quality-gate loops for high-stakes outputs (Phase 5)
//
// Use when a single AI step produces output that has to pass a deterministic
// quality bar (no invented numbers, cites >= 3 sources, tone check, eval
// judge score >= threshold). The helper re-invokes the step up to
// maxIterations times, feeding each failure's reasons back as context so
// the next attempt can correct.
//
// Applies to: churn escalation letters, forecast narratives, Tier-A
// pre-call briefs, any customer-facing output where hallucination cost
// outweighs compute cost.
// ---------------------------------------------------------------------------

export interface LoopValidatorResult {
  passed: boolean
  reasons: string[]
  /** Optional score for observability (e.g. judge score 0..1). */
  score?: number
}

export interface LoopUntilOptions<TResult> {
  /**
   * The step to iterate. Receives an iteration object with the previous
   * attempt's failure reasons so the next attempt can correct.
   */
  step: (attempt: {
    iteration: number
    previousResult: TResult | null
    previousReasons: string[]
    ctx: StepContext
  }) => Promise<TResult>
  /**
   * Pure function that inspects the step's output and decides whether it
   * passes the quality bar. Return `passed: true` when done.
   */
  validator: (
    result: TResult,
    ctx: StepContext,
  ) => Promise<LoopValidatorResult> | LoopValidatorResult
  /** Hard upper bound. Returns passed:false when exceeded. */
  maxIterations: number
  /**
   * When true, each iteration gets a fresh context marker (no memory of
   * prior iterations). Matches Archon's `fresh_context: true`.
   */
  freshContext?: boolean
  /** Identifier used for logging. Defaults to "loop". */
  id?: string
}

export interface LoopUntilOutcome<TResult> {
  passed: boolean
  iterations: number
  lastResult: TResult | null
  lastReasons: string[]
  lastScore?: number
}

/**
 * Execute a step in a loop until the validator passes or maxIterations
 * is exceeded. Intended for use inside a Step's `run:` or a DagNode's
 * `run:`.
 */
export async function loopUntil<TResult>(
  opts: LoopUntilOptions<TResult>,
  ctx: StepContext,
): Promise<LoopUntilOutcome<TResult>> {
  let lastResult: TResult | null = null
  let lastReasons: string[] = []
  let lastScore: number | undefined

  for (let i = 0; i < opts.maxIterations; i++) {
    const attemptCtx: StepContext = opts.freshContext
      ? { ...ctx, stepState: { ...ctx.stepState, __loop_fresh: true } }
      : ctx

    const result = await opts.step({
      iteration: i,
      previousResult: lastResult,
      previousReasons: lastReasons,
      ctx: attemptCtx,
    })
    lastResult = result

    const verdict = await opts.validator(result, attemptCtx)
    lastReasons = verdict.reasons
    lastScore = verdict.score

    if (verdict.passed) {
      return {
        passed: true,
        iterations: i + 1,
        lastResult: result,
        lastReasons: [],
        lastScore,
      }
    }
  }

  return {
    passed: false,
    iterations: opts.maxIterations,
    lastResult,
    lastReasons,
    lastScore,
  }
}
