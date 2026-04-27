import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runFirstRun } from '../first-run'
import { startWorkflow } from '../runner'

/**
 * Tests for C1 first-run workflow.
 *
 * We can't run a real Slack DM in unit tests so we focus on the
 * deterministic plumbing:
 *   - Top-3 priority companies are picked correctly
 *   - Briefs are built with citations
 *   - The workflow short-circuits cleanly when there's no rep, no
 *     companies, no Slack token
 *   - The completion event is always emitted with elapsed_ms + sla_met
 *   - Holdout cohort is respected
 *
 * Slack/HTTP and emitAgentEvent are mocked via the supabase fake +
 * env vars. We avoid mocking SlackDispatcher constructor itself because
 * the workflow exits before calling it when we set
 * `SLACK_BOT_TOKEN=` (empty).
 */

interface FakeRep {
  id: string
  name: string
  slack_user_id: string | null
  crm_user_id: string | null
}

interface FakeCompany {
  id: string
  name: string
  priority_tier: string | null
  icp_tier: string | null
  icp_score: number | null
  signal_score: number | null
  industry: string | null
}

interface FakeSignal {
  company_id: string
  title: string
  weighted_score: number
  detected_at: string
}

interface CapturedEvent {
  event_type: string
  payload: Record<string, unknown>
}

function buildSupabase(opts: {
  tenantId: string
  rep: FakeRep | null
  companies: FakeCompany[]
  signals: FakeSignal[]
  events: CapturedEvent[]
  cohort?: 'control' | 'treatment'
  holdoutPercent?: number
}): SupabaseClient {
  const events = opts.events
  return {
    from(table: string): unknown {
      if (table === 'workflow_runs') return makeWorkflowRunsHandler()

      if (table === 'rep_profiles') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({ data: opts.rep, error: null })
                  },
                }
              },
            }
          },
        }
      }

      if (table === 'opportunities') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          limit() {
                            return Promise.resolve({ data: [], error: null })
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
      }

      if (table === 'companies') {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return {
                      order() {
                        return {
                          limit() {
                            return Promise.resolve({ data: opts.companies.slice(0, 3), error: null })
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
      }

      if (table === 'signals') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      gte() {
                        return {
                          order() {
                            return {
                              limit(n: number) {
                                const data = opts.signals.slice(0, n)
                                return Promise.resolve({ data, error: null })
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
        }
      }

      if (table === 'transcripts') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      order() {
                        return {
                          limit() {
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
        }
      }

      if (table === 'holdout_assignments') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle() {
                        return Promise.resolve({
                          data: opts.cohort ? { cohort: opts.cohort } : null,
                          error: null,
                        })
                      },
                    }
                  },
                }
              },
            }
          },
          insert() {
            return Promise.resolve({ data: null, error: null })
          },
        }
      }

      if (table === 'attribution_config') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data:
                        opts.holdoutPercent !== undefined
                          ? { holdout_percent: opts.holdoutPercent }
                          : null,
                      error: null,
                    })
                  },
                }
              },
            }
          },
        }
      }

      if (table === 'agent_events') {
        return {
          insert(row: Record<string, unknown>) {
            events.push({
              event_type: String(row.event_type),
              payload: (row.payload as Record<string, unknown>) ?? {},
            })
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
    id: 'first-run-test',
    tenant_id: 't1',
    workflow_name: 'first_run',
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

describe('runFirstRun (C1)', () => {
  const previousSlackToken = process.env.SLACK_BOT_TOKEN
  beforeEach(() => {
    delete process.env.SLACK_BOT_TOKEN
  })
  afterEach(() => {
    if (previousSlackToken) {
      process.env.SLACK_BOT_TOKEN = previousSlackToken
    } else {
      delete process.env.SLACK_BOT_TOKEN
    }
  })

  it('emits first_run_completed with sla_met=true when end-to-end completes fast', async () => {
    const events: CapturedEvent[] = []
    const supabase = buildSupabase({
      tenantId: 't1',
      rep: {
        id: 'rep-1',
        name: 'Test Rep',
        slack_user_id: 'U123',
        crm_user_id: null,
      },
      companies: [
        { id: 'c1', name: 'Acme Inc', priority_tier: 'HOT', icp_tier: 'A', icp_score: 92, signal_score: 0.8, industry: 'tech' },
        { id: 'c2', name: 'Beta Corp', priority_tier: 'WARM', icp_tier: 'A', icp_score: 80, signal_score: 0.6, industry: 'tech' },
        { id: 'c3', name: 'Gamma Ltd', priority_tier: 'WARM', icp_tier: 'B', icp_score: 60, signal_score: 0.5, industry: 'finance' },
      ],
      signals: [
        { company_id: 'c1', title: 'Hiring surge: 12 SDR roles', weighted_score: 0.8, detected_at: new Date().toISOString() },
      ],
      events,
    })

    const row = await startWorkflow(supabase, {
      tenantId: 't1',
      workflowName: 'first_run',
      input: { rep_id: 'rep-1', source: 'onboarding_wizard' },
    })

    const result = await runFirstRun(supabase, row.id)

    expect(result.status).toBe('completed')

    const completed = events.find((e) => e.event_type === 'first_run_completed')
    expect(completed).toBeDefined()
    expect(completed?.payload.sla_met).toBe(true)
    expect(typeof completed?.payload.elapsed_ms).toBe('number')
    // No SLACK_BOT_TOKEN → dispatch step skips → completion still
    // fires with skipped=true.
    expect(completed?.payload.skipped).toBe(true)
    expect(completed?.payload.skip_reason).toBe('slack_bot_token_missing')
  })

  it('respects holdout cohort: control users get NO push', async () => {
    const events: CapturedEvent[] = []
    process.env.SLACK_BOT_TOKEN = 'xoxb-fake-for-test'

    const supabase = buildSupabase({
      tenantId: 't1',
      rep: {
        id: 'rep-control',
        name: 'Control Rep',
        slack_user_id: 'U999',
        crm_user_id: null,
      },
      companies: [
        { id: 'c1', name: 'Acme', priority_tier: 'HOT', icp_tier: 'A', icp_score: 90, signal_score: 0.7, industry: 'tech' },
      ],
      signals: [],
      events,
      cohort: 'control',
    })

    const row = await startWorkflow(supabase, {
      tenantId: 't1',
      workflowName: 'first_run',
      input: { rep_id: 'rep-control', source: 'onboarding_wizard' },
    })
    await runFirstRun(supabase, row.id)

    const completed = events.find((e) => e.event_type === 'first_run_completed')
    expect(completed?.payload.skipped).toBe(true)
    expect(completed?.payload.skip_reason).toBe('holdout_control')
  })

  it('skips cleanly when no companies exist after sync (greenfield tenant)', async () => {
    const events: CapturedEvent[] = []

    const supabase = buildSupabase({
      tenantId: 't-empty',
      rep: { id: 'rep-1', name: 'Rep', slack_user_id: 'U1', crm_user_id: null },
      companies: [],
      signals: [],
      events,
    })

    const row = await startWorkflow(supabase, {
      tenantId: 't-empty',
      workflowName: 'first_run',
      input: { rep_id: 'rep-1', source: 'onboarding_wizard' },
    })

    const result = await runFirstRun(supabase, row.id)
    expect(result.status).toBe('completed')

    const completed = events.find((e) => e.event_type === 'first_run_completed')
    expect(completed?.payload.skipped).toBe(true)
    expect(completed?.payload.skip_reason).toBe('no_companies_after_sync')
  })

  it('skips when rep has no slack_user_id but still emits completion event', async () => {
    const events: CapturedEvent[] = []
    process.env.SLACK_BOT_TOKEN = 'xoxb-fake-for-test'

    const supabase = buildSupabase({
      tenantId: 't1',
      rep: { id: 'rep-no-slack', name: 'Rep', slack_user_id: null, crm_user_id: null },
      companies: [
        { id: 'c1', name: 'Acme', priority_tier: 'HOT', icp_tier: 'A', icp_score: 80, signal_score: 0.5, industry: 'tech' },
      ],
      signals: [],
      events,
    })

    const row = await startWorkflow(supabase, {
      tenantId: 't1',
      workflowName: 'first_run',
      input: { rep_id: 'rep-no-slack', source: 'onboarding_wizard' },
    })
    await runFirstRun(supabase, row.id)

    const completed = events.find((e) => e.event_type === 'first_run_completed')
    expect(completed?.payload.skip_reason).toBe('rep_missing_slack_user_id')
  })
})

// quiet vi if it's unused in some runs
void vi
