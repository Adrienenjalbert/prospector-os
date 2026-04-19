import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  enqueueRetentionSweep,
  runRetentionSweep,
} from '../retention-sweep'
import {
  RETENTION_DEFAULT_DAYS,
  RETENTION_TABLE_NAMES,
} from '@prospector/core'

/**
 * Phase 3 T1.3 — retention sweep workflow tests.
 *
 * Strategy: build a fake Supabase that records every call and returns
 * deterministic data. The workflow is a pure orchestration of:
 *   - read `retention_policies` for overrides
 *   - read `workflow_runs` for run state
 *   - per-table SELECT to find expired ids
 *   - per-table DELETE (or UPDATE for transcripts.raw_text)
 *   - emit a single `retention_sweep_completed` event
 *
 * These tests verify orchestration + invariants — tenant scoping on
 * every batch, dry-run flag plumbing, override-overrides-default,
 * special case for column-NULL on transcripts.raw_text, idempotency
 * key shape. Real Postgres semantics are exercised by integration
 * tests against a Supabase fixture (out of scope for unit tests here).
 */

interface FakeSupabaseRecord {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  filters: Array<{ kind: string; column?: string; value?: unknown }>
  body?: unknown
}

interface FakeSupabaseFixture {
  /** Map (table -> rows) for SELECT queries to return. */
  selectRows?: Record<string, Array<Record<string, unknown>>>
  /** workflow_runs row keyed by id. */
  workflowRun?: Record<string, unknown>
}

function makeFakeSupabase(fixture: FakeSupabaseFixture = {}): {
  supabase: SupabaseClient
  records: FakeSupabaseRecord[]
} {
  const records: FakeSupabaseRecord[] = []
  const selectRows = fixture.selectRows ?? {}
  const workflowRun = fixture.workflowRun ?? null

  function makeQuery(table: string, op: FakeSupabaseRecord['op']) {
    const rec: FakeSupabaseRecord = { table, op, filters: [] }
    records.push(rec)

    // Permissive type: PostgREST's chainable builder mixes
    // `(col, val) => builder` with `(onResolve) => Promise` shapes.
    // Fixture covers both; using `any` here is intentional — this
    // file's type-soundness is enforced by the consumer (the
    // workflow), not by the fake.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select(_cols: unknown) {
        return builder
      },
      eq(column: unknown, value: unknown) {
        rec.filters.push({ kind: 'eq', column: String(column), value })
        return builder
      },
      lt(column: unknown, value: unknown) {
        rec.filters.push({ kind: 'lt', column: String(column), value })
        return builder
      },
      not(column: unknown, _op: unknown, value: unknown) {
        rec.filters.push({ kind: 'not', column: String(column), value })
        return builder
      },
      in(column: unknown, values: unknown) {
        rec.filters.push({ kind: 'in', column: String(column), value: values })
        return builder
      },
      limit(_n: unknown) {
        return builder
      },
      order(_col: unknown, _opts: unknown) {
        return builder
      },
      maybeSingle() {
        if (table === 'workflow_runs') {
          return Promise.resolve({ data: workflowRun, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      single() {
        if (table === 'workflow_runs') {
          // For the runner's `.insert(...).select('*').single()` path
          // we synthesise an inserted row from the captured insert
          // body (so `enqueueX` returns successfully). For the
          // dedupe-lookup path (no insert yet) fall back to the
          // pre-seeded fixture.
          const lastInsert = [...records].reverse().find(
            (r) => r.table === 'workflow_runs' && r.op === 'insert',
          )
          if (lastInsert?.body) {
            const body = lastInsert.body as Record<string, unknown>
            return Promise.resolve({
              data: { id: 'synth-run-id', ...body },
              error: null,
            })
          }
          return Promise.resolve({ data: workflowRun, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      then(onResolve: (v: unknown) => unknown) {
        const rows = selectRows[table] ?? []
        return Promise.resolve({ data: rows, error: null }).then(onResolve)
      },
    }
    return builder
  }

  const supabase = {
    from(table: string) {
      const root: Record<string, (...a: unknown[]) => unknown> = {
        select(_cols: unknown) {
          const q = makeQuery(table, 'select')
          ;(q as unknown as { select: (c: unknown) => unknown }).select(_cols)
          return q
        },
        update(body: unknown) {
          const q = makeQuery(table, 'update')
          ;(q as unknown as { __body: unknown }).__body = body
          // Capture body in the latest record
          const last = records[records.length - 1]
          last.body = body
          return q
        },
        delete() {
          return makeQuery(table, 'delete')
        },
        insert(body: unknown) {
          const q = makeQuery(table, 'insert')
          const last = records[records.length - 1]
          last.body = body
          return q
        },
        upsert(body: unknown, _opts?: unknown) {
          const q = makeQuery(table, 'upsert')
          const last = records[records.length - 1]
          last.body = body
          return q
        },
      }
      return root
    },
  } as unknown as SupabaseClient

  return { supabase, records }
}

describe('enqueueRetentionSweep', () => {
  it('uses an idempotency key keyed by (tenant, day)', async () => {
    const { supabase, records } = makeFakeSupabase()
    const fixedNow = '2026-04-19T10:00:00.000Z'
    await enqueueRetentionSweep(supabase, 'tenant-1', { now_iso: fixedNow })

    const inserts = records.filter(
      (r) => r.table === 'workflow_runs' && r.op === 'insert',
    )
    // The runner upserts workflow_runs via .insert() after a dedupe
    // .select(). At minimum one insert with the rs:tenant:date key.
    const insertedKey = inserts
      .map((r) => (r.body as { idempotency_key?: string } | undefined)?.idempotency_key)
      .find(Boolean)
    expect(insertedKey).toBe('rs:tenant-1:2026-04-19')
  })
})

describe('runRetentionSweep — dry-run mode (default)', () => {
  const originalFlag = process.env.RETENTION_SWEEP_DRY_RUN

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.RETENTION_SWEEP_DRY_RUN
    else process.env.RETENTION_SWEEP_DRY_RUN = originalFlag
  })

  beforeEach(() => {
    delete process.env.RETENTION_SWEEP_DRY_RUN
  })

  it('reads policies, plans per table, and emits a dry_run=true event', async () => {
    const runId = 'run-1'
    const { supabase, records } = makeFakeSupabase({
      workflowRun: {
        id: runId,
        tenant_id: 'tenant-1',
        workflow_name: 'retention_sweep',
        status: 'pending',
        step_state: {},
        input: { now_iso: '2026-04-19T10:00:00.000Z' },
        attempts: 0,
        started_at: null,
      },
      selectRows: {
        retention_policies: [], // no overrides — defaults apply
        // Empty result for every table SELECT — nothing to purge.
      },
    })

    await runRetentionSweep(supabase, runId)

    // The agent_events insert is the dispatch event.
    const eventInsert = records.find(
      (r) => r.table === 'agent_events' && r.op === 'insert',
    )
    expect(eventInsert).toBeDefined()
    const payload = (eventInsert?.body as { event_type?: string; payload?: Record<string, unknown> })
      ?.payload as Record<string, unknown> | undefined
    expect(eventInsert?.body).toMatchObject({
      event_type: 'retention_sweep_completed',
    })
    expect(payload?.dry_run).toBe(true)
    expect(payload?.total_rows_swept).toBe(0)
  })

  it('plans one entry per allowlisted table', async () => {
    const runId = 'run-1'
    const { supabase, records } = makeFakeSupabase({
      workflowRun: {
        id: runId,
        tenant_id: 'tenant-1',
        workflow_name: 'retention_sweep',
        status: 'pending',
        step_state: {},
        input: { now_iso: '2026-04-19T10:00:00.000Z' },
        attempts: 0,
        started_at: null,
      },
      selectRows: {
        retention_policies: [],
      },
    })

    await runRetentionSweep(supabase, runId)

    const event = records.find(
      (r) => r.table === 'agent_events' && r.op === 'insert',
    )
    const payload = (event?.body as { payload?: Record<string, unknown> })?.payload
    const perTable = (payload as { per_table?: Record<string, unknown> } | undefined)?.per_table
    expect(perTable).toBeDefined()
    // Every allowlisted table appears in per_table.
    for (const t of RETENTION_TABLE_NAMES) {
      expect(perTable, `missing ${t}`).toHaveProperty(t)
    }
  })

  it('honours force_dry_run input flag (overrides env)', async () => {
    process.env.RETENTION_SWEEP_DRY_RUN = 'false'
    const runId = 'run-1'
    const { supabase, records } = makeFakeSupabase({
      workflowRun: {
        id: runId,
        tenant_id: 'tenant-1',
        workflow_name: 'retention_sweep',
        status: 'pending',
        step_state: {},
        input: {
          now_iso: '2026-04-19T10:00:00.000Z',
          force_dry_run: true,
        },
        attempts: 0,
        started_at: null,
      },
      selectRows: {
        retention_policies: [],
      },
    })

    await runRetentionSweep(supabase, runId)

    const event = records.find(
      (r) => r.table === 'agent_events' && r.op === 'insert',
    )
    const payload = (event?.body as { payload?: Record<string, unknown> })?.payload
    expect((payload as { dry_run?: boolean })?.dry_run).toBe(true)
  })

  it('uses default windows when no overrides exist', async () => {
    const runId = 'run-1'
    const { supabase, records } = makeFakeSupabase({
      workflowRun: {
        id: runId,
        tenant_id: 'tenant-1',
        workflow_name: 'retention_sweep',
        status: 'pending',
        step_state: {},
        input: { now_iso: '2026-04-19T10:00:00.000Z' },
        attempts: 0,
        started_at: null,
      },
      selectRows: {
        retention_policies: [],
      },
    })

    await runRetentionSweep(supabase, runId)

    // Compute expected cutoff dates from the test now + per-table
    // defaults. The workflow doesn't expose them in the event payload
    // (they'd flood the row); instead we verify by checking the SELECT
    // on each target table used the correct `lt(timestamp, cutoff)`.
    const now = new Date('2026-04-19T10:00:00.000Z').getTime()

    // agent_events default: 730 days
    const agentEventsSelect = records.find(
      (r) =>
        r.table === 'agent_events' &&
        r.op === 'select' &&
        r.filters.some((f) => f.kind === 'lt' && f.column === 'occurred_at'),
    )
    expect(agentEventsSelect, 'agent_events SELECT not found').toBeDefined()
    const cutoff = agentEventsSelect?.filters.find((f) => f.kind === 'lt')
      ?.value as string | undefined
    expect(cutoff).toBeDefined()
    const expectedCutoff = new Date(
      now - RETENTION_DEFAULT_DAYS.agent_events * 24 * 60 * 60 * 1000,
    ).toISOString()
    expect(cutoff).toBe(expectedCutoff)
  })

  it('every table SELECT is tenant-scoped', async () => {
    const runId = 'run-1'
    const { supabase, records } = makeFakeSupabase({
      workflowRun: {
        id: runId,
        tenant_id: 'tenant-zzz',
        workflow_name: 'retention_sweep',
        status: 'pending',
        step_state: {},
        input: { now_iso: '2026-04-19T10:00:00.000Z' },
        attempts: 0,
        started_at: null,
      },
      selectRows: {
        retention_policies: [],
      },
    })

    await runRetentionSweep(supabase, runId)

    // Every SELECT against a retention-target table must include
    // `.eq('tenant_id', 'tenant-zzz')`. Skip control reads
    // (`workflow_runs`, `retention_policies`).
    const targetTables = new Set([
      'agent_events',
      'outcome_events',
      'attributions',
      'transcripts',
      'ai_conversations',
      'ai_conversation_notes',
      'agent_citations',
      'webhook_deliveries',
    ])
    const targetSelects = records.filter(
      (r) => targetTables.has(r.table) && r.op === 'select',
    )
    expect(targetSelects.length).toBeGreaterThan(0)
    for (const r of targetSelects) {
      const tenantFilter = r.filters.find(
        (f) => f.kind === 'eq' && f.column === 'tenant_id',
      )
      expect(
        tenantFilter,
        `${r.table} SELECT missing tenant_id filter`,
      ).toBeDefined()
      expect(tenantFilter?.value).toBe('tenant-zzz')
    }
  })

  it('special-cases transcripts.raw_text — uses NULL update path with not-null filter', async () => {
    const runId = 'run-1'
    const { supabase, records } = makeFakeSupabase({
      workflowRun: {
        id: runId,
        tenant_id: 'tenant-1',
        workflow_name: 'retention_sweep',
        status: 'pending',
        step_state: {},
        input: { now_iso: '2026-04-19T10:00:00.000Z' },
        attempts: 0,
        started_at: null,
      },
      selectRows: {
        retention_policies: [],
      },
    })

    await runRetentionSweep(supabase, runId)

    // The raw_text sweep does SELECT id WHERE raw_text IS NOT NULL.
    const rawTextSelect = records.find(
      (r) =>
        r.table === 'transcripts' &&
        r.op === 'select' &&
        r.filters.some((f) => f.kind === 'not' && f.column === 'raw_text'),
    )
    expect(
      rawTextSelect,
      'transcripts raw_text NOT NULL SELECT not found',
    ).toBeDefined()

    // Confirm the per_table event payload tags the raw_text result
    // with action='null' (not 'delete').
    const event = records.find(
      (r) => r.table === 'agent_events' && r.op === 'insert',
    )
    const perTable = (
      (event?.body as { payload?: { per_table?: Record<string, { action?: string }> } })?.payload
    )?.per_table
    expect(perTable?.transcripts_raw_text?.action).toBe('null')
    // While transcripts_summary uses delete.
    expect(perTable?.transcripts_summary?.action).toBe('delete')
  })

  it('honours per-tenant overrides over defaults', async () => {
    const runId = 'run-1'
    // Tenant has a longer override on agent_events.
    const overrideDays = 1000
    const { supabase, records } = makeFakeSupabase({
      workflowRun: {
        id: runId,
        tenant_id: 'tenant-1',
        workflow_name: 'retention_sweep',
        status: 'pending',
        step_state: {},
        input: { now_iso: '2026-04-19T10:00:00.000Z' },
        attempts: 0,
        started_at: null,
      },
      selectRows: {
        retention_policies: [
          { table_name: 'agent_events', retention_days: overrideDays },
        ],
      },
    })

    await runRetentionSweep(supabase, runId)

    const now = new Date('2026-04-19T10:00:00.000Z').getTime()
    const agentEventsSelect = records.find(
      (r) =>
        r.table === 'agent_events' &&
        r.op === 'select' &&
        r.filters.some((f) => f.kind === 'lt' && f.column === 'occurred_at'),
    )
    const cutoff = agentEventsSelect?.filters.find((f) => f.kind === 'lt')
      ?.value as string
    const expected = new Date(
      now - overrideDays * 24 * 60 * 60 * 1000,
    ).toISOString()
    expect(cutoff).toBe(expected)
  })
})
