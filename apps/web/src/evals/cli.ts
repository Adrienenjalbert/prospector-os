#!/usr/bin/env tsx
/**
 * Eval CLI — runs the golden eval suite against the live agent stack.
 *
 * Usage:
 *   tsx apps/web/src/evals/cli.ts
 *
 * Required env:
 *   - ANTHROPIC_API_KEY  OR  AI_GATEWAY_API_KEY + AI_GATEWAY_BASE_URL
 *   - NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (optional; if
 *     unset we use a stub supabase that returns empty rows — tools execute
 *     but return no data, which still tests "did the agent call the right
 *     tool" via deterministic judge checks).
 *
 * Optional env:
 *   - EVAL_PASS_RATE_THRESHOLD   default 0.75; CI fails below this.
 *   - EVAL_CASE_LIMIT            cap cases per category for fast smoke runs.
 *   - EVAL_SUBSET                'goldens' (default) | 'smoke' (3 cases).
 *
 * Exit codes:
 *   0 — pass rate >= threshold
 *   1 — pass rate <  threshold
 *   2 — fatal error before evals could run
 */

import { streamText, type Tool } from 'ai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CitationCollector } from '@prospector/core'
import { GOLDEN_EVAL_CASES, type EvalCase } from './goldens'
import { runEvalSuite, type AgentRunResult } from './run'
import {
  createAgentTools,
  buildSystemPromptForAgent,
  dispatchAgent,
  type AgentType,
} from '@/lib/agent/tools'
import { getModel } from '@/lib/agent/model-registry'
import { recordCitationsFromToolResult } from '@/lib/agent/citations'

// ---------------------------------------------------------------------------
// Stub Supabase — every query returns no rows, no error. Tools execute and
// produce empty results. This is fine for evals that test tool *selection*
// (the deterministic judge check). For evals that need real data, point at a
// dev Supabase via env vars.
// ---------------------------------------------------------------------------

function makeStubSupabase(): SupabaseClient {
  const respond = () => Promise.resolve({ data: [], error: null })
  const respondSingle = () => Promise.resolve({ data: null, error: null })

  // Recursive proxy: any `.from(...).select(...).eq(...)...` chain resolves to
  // `{ data: [], error: null }`. Terminal awaits return the same shape.
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return undefined
      if (prop === 'maybeSingle' || prop === 'single') return respondSingle
      if (prop === 'rpc') return () => Promise.resolve({ data: [], error: null })
      if (prop === 'auth') {
        return {
          getUser: () =>
            Promise.resolve({ data: { user: null }, error: null }),
        }
      }
      return () => new Proxy({}, handler)
    },
  }

  // Make the root awaitable too so `await supabase.from(...)` works.
  const root = new Proxy({}, handler) as unknown as SupabaseClient
  return root
}

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.warn('[evals] Supabase env not set — using stub (tools return empty).')
    return makeStubSupabase()
  }
  // Lazy import so tests without supabase don't pull the dep eagerly.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ---------------------------------------------------------------------------
// Map an EvalCase to the agent surface that should answer it.
// ---------------------------------------------------------------------------

function pickAgentType(c: EvalCase): AgentType {
  const dispatch = dispatchAgent({
    role: c.role,
    // Canonical URN for the eval stub. The previous shorthand
    // (`urn:rev:company:eval-stub`) had only 4 segments and would not
    // round-trip through `parseUrn` (which requires ≥5).
    activeUrn:
      c.category === 'account' ? 'urn:rev:eval-stub-tenant:company:eval-stub' : null,
  })
  return dispatch.agentType
}

// ---------------------------------------------------------------------------
// runAgent — invokes streamText with the static tools (no DB required).
// We collect tool calls + tool results, then run the citation extractors so
// the judge can verify expected_citation_types.
// ---------------------------------------------------------------------------

const SYNTHETIC_TENANT_ID = '00000000-0000-0000-0000-00000000eva1'
const SYNTHETIC_REP_ID = '00000000-0000-0000-0000-00000000eva2'

async function runAgent(
  evalCase: EvalCase,
): Promise<AgentRunResult> {
  const agentType = pickAgentType(evalCase)
  const tools: Record<string, Tool> = createAgentTools(
    SYNTHETIC_TENANT_ID,
    SYNTHETIC_REP_ID,
    agentType,
  )

  const systemPrompt = await buildSystemPromptForAgent(
    agentType,
    SYNTHETIC_TENANT_ID,
    null,
  )

  const collector = new CitationCollector(
    SYNTHETIC_TENANT_ID,
    `eval-${evalCase.id}`,
  )

  const toolsCalled: string[] = []

  const result = await streamText({
    model: getModel('anthropic/claude-haiku-4'),
    system: systemPrompt,
    prompt: evalCase.question,
    tools,
    maxSteps: 6,
    maxTokens: 1500,
    temperature: 0,
    onStepFinish: (step) => {
      const s = step as unknown as {
        toolCalls?: Array<{ toolName: string }>
        toolResults?: Array<{ toolName: string; result: unknown }>
      }
      for (const tc of s.toolCalls ?? []) toolsCalled.push(tc.toolName)
      for (const tr of s.toolResults ?? []) {
        recordCitationsFromToolResult(
          { collector, crmType: 'hubspot' },
          tr.toolName,
          tr.result,
        )
      }
    },
  })

  // Drain the stream so onStepFinish fires.
  let text = ''
  for await (const chunk of result.textStream) text += chunk

  const citationTypes = Array.from(
    new Set(collector.getCitations().map((c) => c.source_type)),
  )

  return {
    text,
    tools_called: toolsCalled,
    citation_types: citationTypes,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Load `accepted` cases from the eval_cases DB table on top of the
 * static GOLDEN_EVAL_CASES seed set (A2.4). This is what makes
 * MISSION's "eval suite grows from real production failures" promise
 * real — every accepted case enters the next CI run.
 *
 * Best-effort: if Supabase env is unset (CI without DB) or the query
 * fails, we proceed with the static seed only and log a warning.
 */
async function loadAcceptedDbCases(): Promise<EvalCase[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return []
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js')
    const supabase = createClient(url, key, { auth: { persistSession: false } })

    const { data, error } = await supabase
      .from('eval_cases')
      .select('id, category, role, question, expected_tool_calls, expected_citation_types, expected_answer_summary')
      .eq('status', 'accepted')
      .limit(500)

    if (error) {
      console.warn('[evals] failed to load accepted cases from DB:', error.message)
      return []
    }

    type EvalCaseRow = {
      id: string
      category: string | null
      role: string | null
      question: string | null
      expected_tool_calls: string[] | null
      expected_citation_types: string[] | null
      expected_answer_summary: string | null
    }

    const validCategories: EvalCase['category'][] = ['concierge', 'account', 'portfolio']
    const validRoles: EvalCase['role'][] = ['ae', 'nae', 'csm', 'ad', 'leader']

    return (data as EvalCaseRow[] | null ?? [])
      .filter(
        (r) =>
          r.id &&
          r.question &&
          r.category &&
          (validCategories as string[]).includes(r.category) &&
          r.role &&
          (validRoles as string[]).includes(r.role),
      )
      .map((r) => ({
        id: `db-${r.id}`,
        category: r.category as EvalCase['category'],
        role: r.role as EvalCase['role'],
        question: r.question!,
        expected_tools: r.expected_tool_calls ?? [],
        expected_citation_types: r.expected_citation_types ?? [],
        rubric: r.expected_answer_summary ?? 'Response is grounded, cites sources, and ends with the Next Steps block.',
      }))
  } catch (err) {
    console.warn('[evals] DB-cases loader threw:', err)
    return []
  }
}

async function main(): Promise<void> {
  const threshold = Number(process.env.EVAL_PASS_RATE_THRESHOLD ?? '0.75')
  const subset = process.env.EVAL_SUBSET ?? 'goldens'
  const caseLimit = process.env.EVAL_CASE_LIMIT
    ? Number(process.env.EVAL_CASE_LIMIT)
    : null

  // Touch supabase env so missing-env warnings show up in CI logs early.
  void getSupabase()

  // Static seed + accepted DB cases (A2.4). Smoke runs stick to seed
  // only so they stay deterministic on local laptops without DB env.
  const dbCases = subset === 'smoke' ? [] : await loadAcceptedDbCases()
  if (dbCases.length > 0) {
    console.log(`[evals] loaded ${dbCases.length} accepted DB cases (suite is growing!)`)
  }
  let cases: EvalCase[] = [...GOLDEN_EVAL_CASES, ...dbCases]
  if (subset === 'smoke') {
    cases = GOLDEN_EVAL_CASES.slice(0, 3)
  }
  if (caseLimit) {
    const buckets: Record<string, EvalCase[]> = {}
    for (const c of cases) {
      buckets[c.category] = buckets[c.category] ?? []
      if (buckets[c.category].length < caseLimit) buckets[c.category].push(c)
    }
    cases = Object.values(buckets).flat()
  }

  console.log(`[evals] running ${cases.length} cases (threshold ${threshold})`)

  const summary = await runEvalSuite(cases, runAgent)

  console.log('\n[evals] summary')
  console.log(`  total:     ${summary.total}`)
  console.log(`  passed:    ${summary.passed}`)
  console.log(`  pass_rate: ${summary.pass_rate.toFixed(3)}`)
  console.log('  by_category:')
  for (const [cat, b] of Object.entries(summary.by_category)) {
    console.log(`    ${cat}: ${b.passed}/${b.total}`)
  }

  // Print every failure so CI logs are debuggable without re-running.
  const failures = summary.results.filter((r) => !r.judgeResult.passed)
  if (failures.length > 0) {
    console.log(`\n[evals] failures (${failures.length}):`)
    for (const f of failures) {
      console.log(
        `  - ${f.case.id} [${f.case.category}/${f.case.role}]  ${f.judgeResult.reasoning}`,
      )
    }
  }

  if (summary.pass_rate < threshold) {
    console.error(
      `\n[evals] FAIL: pass_rate ${summary.pass_rate.toFixed(3)} < threshold ${threshold}`,
    )
    process.exit(1)
  }

  console.log(`\n[evals] PASS`)
  process.exit(0)
}

main().catch((err) => {
  console.error('[evals] fatal:', err)
  process.exit(2)
})
