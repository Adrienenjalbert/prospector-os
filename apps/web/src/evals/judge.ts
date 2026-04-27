import { generateObject } from 'ai'
import { getModel } from '@/lib/agent/model-registry'
import { JudgeVerdictSchema } from '@prospector/core'
import type { EvalCase } from './goldens'

export interface JudgeInput {
  eval: EvalCase
  agent_response: string
  tools_called: string[]
  citation_types: string[]
}

export interface JudgeResult {
  passed: boolean
  score: number
  reasoning: string
}

/**
 * LLM-as-judge. Uses Haiku (cheap) by default; the expected-tool / expected-
 * citation checks are already deterministic, so the judge mostly exists to
 * score correctness + hallucination.
 *
 * Returns score ∈ [0,1]. Pass threshold is 0.7 unless the eval case says
 * otherwise. Deterministic checks are applied BEFORE the judge — a case
 * that fails the tool/citation presence check cannot pass.
 */
export async function judge(input: JudgeInput): Promise<JudgeResult> {
  const toolHit = input.eval.expected_tools.length === 0
    || input.eval.expected_tools.some((t) => input.tools_called.includes(t))
  const citationHit = input.eval.expected_citation_types.length === 0
    || input.eval.expected_citation_types.some((t) => input.citation_types.includes(t))

  if (!toolHit) {
    return {
      passed: false,
      score: 0,
      reasoning: `Missing expected tool call. Expected any of: ${input.eval.expected_tools.join(', ')}. Called: ${input.tools_called.join(', ') || 'none'}.`,
    }
  }

  if (!citationHit) {
    return {
      passed: false,
      score: 0,
      reasoning: `Missing expected citation types. Expected any of: ${input.eval.expected_citation_types.join(', ')}. Got: ${input.citation_types.join(', ') || 'none'}.`,
    }
  }

  // B4.1: structured-output judge. Replaces fragile
  // `generateText + JSON.parse(text.replace(/^```json/, ''))` with a
  // typed Zod schema. Eliminates the silent-parse-failure mode that
  // used to score random results when the model wrapped output in
  // markdown fences (or omitted a trailing brace).
  const prompt = `You are a strict eval judge for a sales agent's answers.

Rubric: ${input.eval.rubric}

Question: "${input.eval.question}"

Agent response:
"""
${input.agent_response}
"""

Tools called: ${input.tools_called.join(', ') || 'none'}
Citation types: ${input.citation_types.join(', ') || 'none'}

Fail the case if the agent invented any data, or if the response dodged the question.`

  try {
    const { object } = await generateObject({
      model: getModel('anthropic/claude-haiku-4'),
      schema: JudgeVerdictSchema,
      prompt,
      maxTokens: 300,
      temperature: 0,
    })

    return {
      passed: object.passed,
      score: object.score,
      reasoning: object.reasoning,
    }
  } catch (err) {
    return {
      passed: false,
      score: 0,
      reasoning: `Judge call failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
