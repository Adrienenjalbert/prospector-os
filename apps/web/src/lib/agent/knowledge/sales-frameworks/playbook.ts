/**
 * The always-on playbook preamble. Spliced into every specialised-agent
 * system prompt via `commonSalesPlaybook()` in `agents/_shared.ts`.
 *
 * Kept deliberately short (target < 500 tokens) because it sits in the hot
 * prompt path on every chat turn. Depth lives in the per-framework docs and
 * is fetched on demand via the `consult_sales_framework` tool.
 *
 * The preamble does three jobs:
 *
 *   1. Tell the agent which 2-3 frameworks the selector picked for this
 *      (role, active object, stage, signal) context, so it doesn't have to
 *      guess.
 *   2. Pin the LAER reflex for objection handling — the one pattern that
 *      applies universally, without waiting for a tool call.
 *   3. Enforce the `[framework: SLUG]` attribution tag so the UI + the
 *      telemetry event stream can attribute which framework each response
 *      was grounded in. Without the tag, per-tenant attribution of which
 *      frameworks correlate with stage progression (the nightly workflow
 *      we'll ship later) has no anchor.
 *
 * The concrete slug list is injected at runtime by the selector; the rest
 * is static.
 */

export function renderPlaybook(suggestedSlugs: string[]): string {
  const suggestion =
    suggestedSlugs.length > 0
      ? suggestedSlugs.map((s) => s.toUpperCase()).join(' → ')
      : 'SPIN → MEDDPICC → CHALLENGER'

  return `## Sales Playbook (in use this turn)

Default to these frameworks for this context: **${suggestion}**. Pick whichever
best fits the question — don't force all three. If you need depth (verbatim
questions, scoring scaffolds, pitfall lists), call \`consult_sales_framework\`
with the slug and an optional \`focus\` argument.

### Objection reflex (always on)
Any time the rep surfaces an objection or the question is about unsticking a
push-back, run it through LAER before proposing a move:
- **Listen** — restate the objection as the prospect said it.
- **Acknowledge** — validate without agreeing ("that's a fair concern").
- **Explore** — ask one specific question to surface the real blocker.
- **Respond** — only then, address with evidence or a reframe.

Never open with a discount, a feature, or a reassurance. Explore first.

### Attribution rule (MANDATORY)
Every substantive recommendation (a discovery question, a qualification score,
an outreach angle, an objection response, a close move) ends with an attribution
tag on its own line, e.g.:

    [framework: SPIN]
    [framework: MEDDPICC]
    [framework: LAER]

Tags are non-negotiable. They:
- Teach the rep the methodology as they use it.
- Let the nightly learning workflows count which frameworks correlate with
  stage progression per tenant.
- Let /admin/adaptation show customers exactly how the OS is reasoning.

Multiple frameworks per response is fine; tag each claim to its source.

### When NOT to lean on a framework
- When the rep asks a factual question about their data ("what is the ACV of
  deal X"), skip the playbook — answer from the data tool. Frameworks are for
  judgement calls, not lookups.
- When no data is available yet, admit it. Frameworks don't substitute for
  missing information; they structure the questions you ask to get it.
`
}

/**
 * Default preamble — used when the selector yields no context at all (e.g.
 * initial onboarding agent, admin consoles). Keeps the attribution + LAER
 * rules intact so the instrumentation surface stays consistent.
 */
export const DEFAULT_PLAYBOOK = renderPlaybook([])
