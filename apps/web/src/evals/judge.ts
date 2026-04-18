import { generateText } from 'ai'
import { getModel } from '@/lib/agent/model-registry'
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

  const prompt = `You are a strict eval judge for a sales agent's answers.

Rubric: ${input.eval.rubric}

Question: "${input.eval.question}"

Agent response:
"""
${input.agent_response}
"""

Tools called: ${input.tools_called.join(', ') || 'none'}
Citation types: ${input.citation_types.join(', ') || 'none'}

Respond with STRICT JSON only, no markdown fences:
{
  "passed": boolean,
  "score": number between 0 and 1,
  "reasoning": "one sentence"
}

Fail the case if the agent invented any data, or if the response dodged the question.`

  try {
    const { text } = await generateText({
      model: getModel('anthropic/claude-haiku-4'),
      prompt,
      maxTokens: 300,
      temperature: 0,
    })

    const clean = text.replace(/^```json\s*|\s*```$/g, '').trim()
    const parsed = JSON.parse(clean) as { passed?: boolean; score?: number; reasoning?: string }

    return {
      passed: Boolean(parsed.passed),
      score: typeof parsed.score === 'number' ? parsed.score : parsed.passed ? 1 : 0,
      reasoning: parsed.reasoning ?? 'no reasoning',
    }
  } catch (err) {
    return {
      passed: false,
      score: 0,
      reasoning: `Judge call failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
