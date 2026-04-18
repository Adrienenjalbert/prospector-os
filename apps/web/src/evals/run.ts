import { createClient } from '@supabase/supabase-js'
import { GOLDEN_EVAL_CASES, type EvalCase } from './goldens'
import { judge, type JudgeResult } from './judge'

/**
 * Minimal eval runner. Given a `runAgent` callback (which the caller wires
 * to their preferred entry point — the agent route in prod, a direct
 * `streamText` call in tests), run every golden, apply the judge, and emit
 * a summary. CI uses the pass-rate threshold to decide merge vs block.
 */

export interface AgentRunResult {
  text: string
  tools_called: string[]
  citation_types: string[]
}

export interface EvalRunOutput {
  case: EvalCase
  run: AgentRunResult
  judgeResult: JudgeResult
}

export interface EvalSummary {
  total: number
  passed: number
  pass_rate: number
  by_category: Record<string, { total: number; passed: number }>
  results: EvalRunOutput[]
}

export async function runEvalSuite(
  cases: EvalCase[] = GOLDEN_EVAL_CASES,
  runAgent: (evalCase: EvalCase) => Promise<AgentRunResult>,
  options: { persistRunId?: string } = {},
): Promise<EvalSummary> {
  const byCategory: Record<string, { total: number; passed: number }> = {
    concierge: { total: 0, passed: 0 },
    account: { total: 0, passed: 0 },
    portfolio: { total: 0, passed: 0 },
  }

  const results: EvalRunOutput[] = []

  for (const evalCase of cases) {
    const run = await runAgent(evalCase)
    const judgeResult = await judge({
      eval: evalCase,
      agent_response: run.text,
      tools_called: run.tools_called,
      citation_types: run.citation_types,
    })

    results.push({ case: evalCase, run, judgeResult })

    const bucket = byCategory[evalCase.category] ?? { total: 0, passed: 0 }
    bucket.total += 1
    if (judgeResult.passed) bucket.passed += 1
    byCategory[evalCase.category] = bucket
  }

  const passed = results.filter((r) => r.judgeResult.passed).length
  const summary: EvalSummary = {
    total: results.length,
    passed,
    pass_rate: results.length === 0 ? 0 : passed / results.length,
    by_category: byCategory,
    results,
  }

  if (options.persistRunId) {
    await persistRun(options.persistRunId, summary)
  }

  return summary
}

async function persistRun(runId: string, summary: EvalSummary): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const rows = summary.results.map((r) => ({
    tenant_id: null,
    eval_case_id: r.case.id,
    prompt_version: runId,
    model_id: 'anthropic/claude-sonnet-4',
    passed: r.judgeResult.passed,
    score: r.judgeResult.score,
    response_summary: r.run.text.slice(0, 500),
    citation_count: r.run.citation_types.length,
    tool_calls_made: r.run.tools_called,
    judge_reasoning: r.judgeResult.reasoning,
  }))

  // Insert individually so eval_case_id can be a slug string in dev; schema
  // expects UUID in prod so we skip silently if the FK blocks it.
  await supabase
    .from('eval_runs')
    .insert(rows)
    .then(() => undefined, (err) => {
      console.warn('[evals] persist skipped:', err?.message ?? err)
    })
}
