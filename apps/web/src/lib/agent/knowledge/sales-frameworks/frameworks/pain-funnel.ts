import type { FrameworkDoc } from '../types'

export const painFunnel: FrameworkDoc = {
  slug: 'pain-funnel',
  title: 'Sandler Pain Funnel',
  author: 'David H. Sandler / Sandler Training',
  source: 'Sandler Selling System (sandler.com)',
  stages: ['discovery', 'qualification'],
  objects: ['contact', 'deal', 'company'],
  best_for: ['discovery', 'stalled_deal', 'churn_risk'],
  conversion_levers: [
    'higher_need_acknowledged',
    'fewer_stalls',
    'faster_cycle',
  ],
  content: `## One-line mental model
A fixed eight-question sequence that walks the buyer from surface
dissatisfaction to the personal, emotional, quantified cost of the
status quo — without you ever pushing.

## When to reach for it
- Discovery calls where the buyer is pain-aware but hasn't owned the
  cost yet.
- Stalled deals where the original pain has gone cold; re-running the
  funnel is the fastest re-activation move.
- Churn-risk accounts where an incumbent rep needs to re-quantify the
  pain that originally drove adoption.

## Scaffold — the 8 questions (in order)
Ask one at a time. Don't rush. Let silence do work.

1. "Tell me more about that."
2. "Can you be more specific? Give me an example."
3. "How long has this been a problem?"
4. "What have you tried to do to solve it?"
5. "How well has that worked?"
6. "What has it cost you? [Can be in £, time, opportunity.]"
7. "How do you feel about that?" *(surfaces the emotional layer —
   critical and often skipped.)*
8. "Have you given up trying to solve it?"

The funnel works because questions 1-5 are factual (buyer's comfort
zone), 6-7 escalate to cost and feeling, and 8 gives the buyer explicit
permission to admit defeat — which almost no-one will, and the denial
itself creates commitment.

## Prospector OS application
- Pair with the \`sandler\` framework for its full submarine context.
- When a rep asks the agent "how do I re-open this stalled deal", the
  recommended move should be "re-run Sandler's pain funnel on the last
  pain the champion admitted" — reference the specific past transcript
  (\`search_transcripts\`).
- For churn risk signals, the CSM agent (when built) should draft a
  talking-track using the pain funnel to re-diagnose *why* the customer
  originally bought.

## Common pitfalls
- Paraphrasing instead of asking the question. The questions are
  deliberately minimal so the buyer fills the space.
- Skipping question 7 because it feels too personal. That question
  moves the pain from "business case" to "this is my problem now".
- Bailing out before question 8. If you quit at 7 you leave the buyer
  hopeful someone else might solve it — and that someone else isn't
  you.

## Attribution
Core tool of the Sandler Selling System (sandler.com). The funnel has
been taught in Sandler training programmes globally since the 1970s.
`,
}
