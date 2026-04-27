import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAttribution } from '../attribution'
import { startWorkflow } from '../runner'

/**
 * Regression test for A3 — holdout-cohort enforcement at attribution
 * write-time.
 *
 * The /admin/roi page subtitle promises "Control-cohort users excluded
 * from influenced-ARR". Pre-this-change the SQL did not implement that
 * promise. The fix is two-part:
 *   1. attribution.ts flags `is_control_cohort` when the joined user
 *      is in the control cohort (this test).
 *   2. /admin/roi adds `.eq('is_control_cohort', false)` to its sum
 *      query (covered by hand-verified UI; the column would have to
 *      exist for that filter to compile).
 *
 * This test exercises (1) end-to-end through the workflow runner so a
 * future refactor that drops the cohort lookup fails CI loudly.
 */

interface FakeOutcome {
  id: string
  subject_urn: string
  user_id: string
  event_type: string
  occurred_at: string
  value_amount: number
}

interface FakeAgentEvent {
  id: string
  subject_urn: string
  user_id: string
  event_type: string
  occurred_at: string
}

interface FakeAssignment {
  user_id: string
  cohort: 'control' | 'treatment'
}

interface CapturedAttribution {
  agent_event_id: string
  outcome_event_id: string
  is_control_cohort: boolean
  attribution_rule: string
  confidence: number
}

function buildSupabase(opts: {
  outcomes: FakeOutcome[]
  agentEvents: FakeAgentEvent[]
  assignments: FakeAssignment[]
  inserts: CapturedAttribution[]
}): SupabaseClient {
  return {
    from(table: string): unknown {
      if (table === 'workflow_runs') return makeWorkflowRunsHandler()
      if (table === 'attribution_config') {
        return {
          select() {
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
      }
      if (table === 'outcome_events') {
        return {
          select() {
            return {
              eq() {
                return {
                  gte() {
                    return Promise.resolve({ data: opts.outcomes, error: null })
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'agent_events') {
        return {
          select() {
            return {
              eq() {
                return {
                  in() {
                    return {
                      gte() {
                        return Promise.resolve({ data: opts.agentEvents, error: null })
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'holdout_assignments') {
        return {
          select() {
            return {
              eq() {
                return {
                  in(_col: string, ids: string[]) {
                    const data = opts.assignments.filter((a) => ids.includes(a.user_id))
                    return Promise.resolve({ data, error: null })
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'attributions') {
        return {
          insert(row: CapturedAttribution) {
            opts.inserts.push(row)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      return {}
    },
  } as unknown as SupabaseClient
}

function makeWorkflowRunsHandler() {
  const row: Record<string, unknown> = {
    id: 'attr-test-run',
    tenant_id: 'tenant-1',
    workflow_name: 'attribution',
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
      const chainable = {
        select() {
          return {
            single() {
              return Promise.resolve({ data: { ...row }, error: null })
            },
          }
        },
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

describe('runAttribution — holdout cohort flagging (A3)', () => {
  it('flags is_control_cohort=true for control-cohort users', async () => {
    const inserts: CapturedAttribution[] = []
    const now = Date.now()
    const subject = 'urn:rev:deal:abc'
    const supabase = buildSupabase({
      outcomes: [
        {
          id: 'oc-control-user',
          subject_urn: subject,
          user_id: 'user-control',
          event_type: 'deal_closed_won',
          occurred_at: new Date(now).toISOString(),
          value_amount: 50_000,
        },
      ],
      agentEvents: [
        {
          id: 'ae-control',
          subject_urn: subject,
          user_id: 'user-control',
          event_type: 'response_finished',
          occurred_at: new Date(now - 60 * 60 * 1000).toISOString(),
        },
      ],
      assignments: [{ user_id: 'user-control', cohort: 'control' }],
      inserts,
    })

    const row = await startWorkflow(supabase, {
      tenantId: 'tenant-1',
      workflowName: 'attribution',
    })
    await runAttribution(supabase, row.id)

    expect(inserts).toHaveLength(1)
    expect(inserts[0].is_control_cohort).toBe(true)
    expect(inserts[0].attribution_rule).toBe('assisted')
  })

  it('flags is_control_cohort=false for treatment-cohort users', async () => {
    const inserts: CapturedAttribution[] = []
    const now = Date.now()
    const subject = 'urn:rev:deal:xyz'
    const supabase = buildSupabase({
      outcomes: [
        {
          id: 'oc-treatment-user',
          subject_urn: subject,
          user_id: 'user-treatment',
          event_type: 'deal_closed_won',
          occurred_at: new Date(now).toISOString(),
          value_amount: 100_000,
        },
      ],
      agentEvents: [
        {
          id: 'ae-treatment',
          subject_urn: subject,
          user_id: 'user-treatment',
          event_type: 'action_invoked',
          occurred_at: new Date(now - 5 * 60 * 1000).toISOString(),
        },
      ],
      assignments: [{ user_id: 'user-treatment', cohort: 'treatment' }],
      inserts,
    })

    const row = await startWorkflow(supabase, {
      tenantId: 'tenant-1',
      workflowName: 'attribution',
    })
    await runAttribution(supabase, row.id)

    expect(inserts).toHaveLength(1)
    expect(inserts[0].is_control_cohort).toBe(false)
    expect(inserts[0].attribution_rule).toBe('direct')
  })

  it('defaults to is_control_cohort=false when no assignment exists', async () => {
    const inserts: CapturedAttribution[] = []
    const now = Date.now()
    const subject = 'urn:rev:deal:unassigned'
    const supabase = buildSupabase({
      outcomes: [
        {
          id: 'oc-no-assignment',
          subject_urn: subject,
          user_id: 'user-no-assignment',
          event_type: 'deal_closed_won',
          occurred_at: new Date(now).toISOString(),
          value_amount: 25_000,
        },
      ],
      agentEvents: [
        {
          id: 'ae-no-assignment',
          subject_urn: subject,
          user_id: 'user-no-assignment',
          event_type: 'response_finished',
          occurred_at: new Date(now - 60 * 60 * 1000).toISOString(),
        },
      ],
      assignments: [],
      inserts,
    })

    const row = await startWorkflow(supabase, {
      tenantId: 'tenant-1',
      workflowName: 'attribution',
    })
    await runAttribution(supabase, row.id)

    expect(inserts).toHaveLength(1)
    expect(inserts[0].is_control_cohort).toBe(false)
  })
})
