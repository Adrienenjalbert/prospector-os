import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runContextSliceCalibration } from '../context-slice-calibration'
import { startWorkflow } from '../runner'

/**
 * Regression test for A1.2 — the silent-drift bug that broke the slice
 * bandit for months.
 *
 * The writer (apps/web/src/app/actions/implicit-feedback.ts) emits
 * `agent_events` with `payload.value: 'positive' | 'negative'`. Earlier
 * versions of `context-slice-calibration` read `payload.feedback`, so
 * the verdict map was always empty and the bandit never updated. This
 * test pins down the canonical key and the legacy-key fallback.
 */

interface FakeRow {
  interaction_id: string | null
  payload: Record<string, unknown> | null
}

interface CapturedUpsert {
  alpha: number
  beta: number
  sample_count: number
  intent_class: string
  role: string
  slice_slug: string
}

function buildSupabase(opts: {
  consumed: FakeRow[]
  feedback: FakeRow[]
  captures: CapturedUpsert[]
}): SupabaseClient {
  const upserts = opts.captures
  return {
    from(table: string): unknown {
      if (table === 'workflow_runs') {
        return makeWorkflowRunsHandler()
      }
      if (table === 'agent_events') {
        return {
          select() {
            return {
              eq(_col: string, _val: string) {
                return {
                  eq(_col2: string, value: string) {
                    return {
                      gte() {
                        if (value === 'context_slice_consumed') {
                          return Promise.resolve({ data: opts.consumed, error: null })
                        }
                        if (value === 'feedback_given') {
                          return Promise.resolve({ data: opts.feedback, error: null })
                        }
                        return Promise.resolve({ data: [], error: null })
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'context_slice_priors') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          eq() {
                            return {
                              maybeSingle() {
                                return Promise.resolve({ data: null, error: null })
                              },
                            }
                          },
                        }
                      },
                    }
                  },
                }
              },
            }
          },
          upsert(row: CapturedUpsert) {
            upserts.push(row)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      return {}
    },
  } as unknown as SupabaseClient
}

/**
 * Minimal in-memory workflow_runs handler so the runner can:
 *   - select the row, find status='pending'
 *   - update status='running' / 'completed'
 * This lets us exercise the real `runWorkflow` plumbing without a DB.
 */
function makeWorkflowRunsHandler() {
  const row: Record<string, unknown> = {
    id: 'csc-test-run',
    tenant_id: 'tenant-1',
    workflow_name: 'context_slice_calibration',
    status: 'pending',
    step_state: {},
    input: {},
    attempts: 0,
  }
  return {
    insert(toInsert: Record<string, unknown>) {
      Object.assign(row, toInsert)
      return {
        select() {
          return {
            single() {
              return Promise.resolve({ data: { ...row }, error: null })
            },
          }
        },
      }
    },
    select() {
      return {
        eq() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    maybeSingle() {
                      return Promise.resolve({ data: null, error: null })
                    },
                  }
                },
              }
            },
            single() {
              return Promise.resolve({ data: { ...row }, error: null })
            },
          }
        },
      }
    },
    update(patch: Record<string, unknown>) {
      Object.assign(row, patch)
      // The runner uses two shapes:
      //   .update(...).eq('id', runId)               (terminal await)
      //   .update(...).eq('id', runId).select('*').single()
      // Build a chainable that satisfies both.
      const chainable = {
        select() {
          return {
            single() {
              return Promise.resolve({ data: { ...row }, error: null })
            },
          }
        },
        // Make `.eq(...)` thenable AND further-chainable.
        then(
          onFulfilled: (v: { data: null; error: null }) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) {
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected)
        },
      }
      return {
        eq() {
          return chainable
        },
      }
    },
  }
}

describe('runContextSliceCalibration — payload key contract (A1.2)', () => {
  it('reads payload.value (canonical) and increments alpha for positive feedback', async () => {
    const captures: CapturedUpsert[] = []
    const supabase = buildSupabase({
      consumed: [
        {
          interaction_id: 'i1',
          payload: { slug: 'priority-accounts', intent_class: 'lookup', query_type: 'ae' },
        },
      ],
      feedback: [
        {
          interaction_id: 'i1',
          payload: { value: 'positive' }, // canonical key — what writer emits today
        },
      ],
      captures,
    })

    const row = await startWorkflow(supabase, {
      tenantId: 'tenant-1',
      workflowName: 'context_slice_calibration',
    })

    await runContextSliceCalibration(supabase, row.id)

    expect(captures).toHaveLength(1)
    expect(captures[0]).toMatchObject({
      slice_slug: 'priority-accounts',
      intent_class: 'lookup',
      role: 'ae',
      // alpha defaults to 1, +1 increment from positive verdict = 2.
      alpha: 2,
      beta: 1,
      sample_count: 1,
    })
  })

  it('also accepts payload.feedback (legacy) so historical events still flow', async () => {
    const captures: CapturedUpsert[] = []
    const supabase = buildSupabase({
      consumed: [
        {
          interaction_id: 'i2',
          payload: { slug: 'stalled-deals', intent_class: 'risk_analysis', query_type: 'ae' },
        },
      ],
      feedback: [
        {
          interaction_id: 'i2',
          payload: { feedback: 'negative' }, // legacy key
        },
      ],
      captures,
    })

    const row = await startWorkflow(supabase, {
      tenantId: 'tenant-1',
      workflowName: 'context_slice_calibration',
    })

    await runContextSliceCalibration(supabase, row.id)

    expect(captures).toHaveLength(1)
    expect(captures[0]).toMatchObject({
      slice_slug: 'stalled-deals',
      // Negative verdict bumps beta, not alpha.
      alpha: 1,
      beta: 2,
    })
  })

  it('does NOT update priors when no verdict is present (the original bug)', async () => {
    const captures: CapturedUpsert[] = []
    const supabase = buildSupabase({
      consumed: [
        {
          interaction_id: 'i3',
          payload: { slug: 'priority-accounts', intent_class: 'lookup', query_type: 'ae' },
        },
      ],
      // Feedback row exists but with NEITHER `value` NOR `feedback` —
      // simulates a malformed historical row. Should be a clean no-op.
      feedback: [{ interaction_id: 'i3', payload: { other: 'noise' } }],
      captures,
    })

    const row = await startWorkflow(supabase, {
      tenantId: 'tenant-1',
      workflowName: 'context_slice_calibration',
    })

    await runContextSliceCalibration(supabase, row.id)

    expect(captures).toHaveLength(0)
  })
})
