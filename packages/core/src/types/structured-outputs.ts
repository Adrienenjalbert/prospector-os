/**
 * Shared Zod schemas for AI structured outputs (B4.1).
 *
 * Every LLM call that produces JSON should use one of these schemas
 * with `generateObject({ schema })` rather than `generateText` +
 * `JSON.parse(text.match(/\{...\}/))`. The fragile-regex pattern was
 * the source of multiple silent parse-failure bugs in production.
 *
 * Why a single shared file:
 *
 *   - One place to evolve schemas as the LLM contract changes.
 *   - Shared between callers and tests so a schema change forces a
 *     rebuild everywhere.
 *   - Keeps the agent + workflow code free of schema noise.
 *
 * Conventions:
 *
 *   - Every field has a `.describe(...)` that the model reads. Treat
 *     these as prompt fragments — they are the most authoritative
 *     way to steer model output.
 *   - Optional fields are `.nullable().optional()` so the model can
 *     output `null` or omit; both round-trip cleanly.
 *   - Number ranges use `.min().max()` so the SDK rejects out-of-band
 *     values instead of silently coercing.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Eval judge — verdict on a single eval case
// ---------------------------------------------------------------------------

export const JudgeVerdictSchema = z.object({
  passed: z
    .boolean()
    .describe('True only when ALL deterministic checks pass AND the rubric is met.'),
  score: z
    .number()
    .min(0)
    .max(1)
    .describe('Quality score 0..1 — finer-grained than passed; 0.5+ usually correlates with pass.'),
  reasoning: z
    .string()
    .max(800)
    .describe('Concise reasoning, citing which check passed/failed. ≤ 3 sentences.'),
})

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>

// ---------------------------------------------------------------------------
// Churn escalation — drafted Slack message + supporting context
// ---------------------------------------------------------------------------

export const ChurnLetterSchema = z.object({
  subject: z
    .string()
    .max(120)
    .describe('Short subject line for the Slack post / email. ≤ 12 words.'),
  body_markdown: z
    .string()
    .describe(
      'Full draft body in Slack-friendly markdown. Must include at least 3 inline urn:rev:... citations and reference numeric facts only where supported.',
    ),
  cited_urns: z
    .array(z.string().regex(/^urn:rev:/))
    .min(1)
    .describe('Every URN cited inline in body_markdown. The validator cross-checks.'),
  recommended_next_step: z
    .string()
    .max(240)
    .describe('Single concrete next step the rep should take after sending.'),
})

export type ChurnLetter = z.infer<typeof ChurnLetterSchema>

// ---------------------------------------------------------------------------
// Research signals — output from any "deep research" / web-search tool
// ---------------------------------------------------------------------------

export const ResearchSignalSchema = z.object({
  type: z
    .string()
    .describe(
      'One of the tenant-configured signal types (e.g. hiring_surge, funding, leadership_change, expansion, competitor_mention, negative_news).',
    ),
  title: z.string().max(160).describe('Short headline for the signal.'),
  description: z
    .string()
    .max(800)
    .describe('2–3 sentence description with specifics.'),
  relevance: z
    .number()
    .min(0)
    .max(1)
    .describe('How relevant to the rep’s ICP, 0..1.'),
  urgency: z
    .enum(['immediate', 'this_week', 'this_month'])
    .describe('How time-sensitive.'),
  recommended_action: z
    .string()
    .max(300)
    .nullable()
    .optional()
    .describe('Specific action for the sales rep, or null.'),
  source_url: z
    .string()
    .url()
    .nullable()
    .optional()
    .describe(
      'Citable URL for the underlying claim. Required for grounded web-search outputs (D7.1); null for tool-less generations.',
    ),
})

export const ResearchSignalsSchema = z
  .array(ResearchSignalSchema)
  .max(20)
  .describe('Empty array when no relevant signals found.')

export type ResearchSignal = z.infer<typeof ResearchSignalSchema>

// ---------------------------------------------------------------------------
// Prompt-diff (C6.1 / Sprint 6) — structured prompt-optimiser output
// ---------------------------------------------------------------------------

export const PromptDiffSchema = z.object({
  rationale_summary: z
    .string()
    .max(500)
    .describe(
      'Why a change is needed. References specific failure patterns observed in the eval cases.',
    ),
  proposed_prompt_body: z
    .string()
    .describe('The full proposed system-prompt body. Will be diffed against current.'),
  changes: z
    .array(
      z.object({
        kind: z.enum(['added', 'removed', 'modified']),
        section: z.string().describe('Section header within the prompt body.'),
        rationale: z.string().max(400),
      }),
    )
    .describe('Per-change explanations the operator reviews on /admin/calibration.'),
  expected_lift: z
    .number()
    .min(-1)
    .max(1)
    .describe(
      'Expected change in eval pass-rate if applied. Conservative — used as a gate, not a guarantee.',
    ),
})

export type PromptDiff = z.infer<typeof PromptDiffSchema>

// ---------------------------------------------------------------------------
// Cluster summary (C6.2) — per-failure-cluster engineering report
// ---------------------------------------------------------------------------

export const ClusterSummarySchema = z.object({
  theme: z.string().max(120).describe('Single-line cluster theme.'),
  sample_count: z.number().min(1),
  user_impact: z
    .enum(['low', 'medium', 'high'])
    .describe('How disruptive this is to reps in production.'),
  proposed_fix: z
    .string()
    .max(800)
    .describe('Concrete engineering / config fix the on-call should attempt.'),
  evidence_urns: z
    .array(z.string())
    .max(5)
    .describe('Up to 5 sample interaction URNs that exemplify the cluster.'),
})

export type ClusterSummary = z.infer<typeof ClusterSummarySchema>
