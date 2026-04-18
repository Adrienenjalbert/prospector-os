import type { FrameworkDoc } from '../types'

export const meddpicc: FrameworkDoc = {
  slug: 'meddpicc',
  title: 'MEDDPICC',
  author: 'Dick Dunkel & Jack Napoli (PTC, popularised by Force Management)',
  source: 'MEDDPICC (PTC / Force Management, 1996-present)',
  stages: ['qualification', 'proposal', 'negotiation'],
  objects: ['deal', 'contact', 'company'],
  best_for: [
    'qualification',
    'complex_sale',
    'enterprise_b2b',
    'late_stage',
    'leadership_brief',
  ],
  conversion_levers: [
    'better_forecast_accuracy',
    'higher_win_rate',
    'fewer_no_decisions',
    'faster_cycle',
  ],
  content: `## One-line mental model
A deal is only as strong as its weakest qualification letter — so score
each letter, name the weakest, and make fixing that the next step.

## When to reach for it
- Qualifying any enterprise deal over a few weeks in cycle.
- Running a deal review or forecast call — MEDDPICC is the shared grammar.
- When you suspect you're being "sold to by the buyer" (they keep pushing
  for a proposal without letting you meet the economic buyer) — MEDDPICC
  forces you to name the gap.

## Scaffold
Score each dimension 0–2 (0 = unknown, 1 = partial, 2 = confirmed). Total
is out of 16. Under 10 at late stage = red flag.

- **M — Metrics**: The quantified business outcome. Not "more efficient" —
  "cut agency spend by £400k/year". If you can't write a number with a £
  or % sign, you don't have Metrics.
- **E — Economic buyer**: The person who can say yes without checking
  with anyone. Not the champion, not the sponsor. Have you met them, and
  did they confirm the pain and the budget authority *in their own words*?
- **D — Decision criteria**: The explicit list of factors they'll evaluate
  on (technical, commercial, integration, risk). Ask: "If we came back
  next week, what would the shortlist decision come down to?"
- **D — Decision process**: The sequence of steps and approvals between
  now and signature. Procurement? Legal? Security review? Board sign-off?
- **P — Paper process**: The contract-specific path — who redlines, who
  signs, what MSA already exists, payment terms. Deals die here far more
  often than reps realise.
- **I — Identify pain**: The concrete ongoing loss the solution stops.
  Tied back to Metrics.
- **C — Champion**: A person with (a) power + (b) influence + (c) a
  personal win if the deal closes. Test them by asking them to do
  something small (share a policy doc, arrange an intro) — real champions
  deliver.
- **C — Competition**: Every alternative — including "do nothing" and
  "build it ourselves". If they say "we're only talking to you", that's
  rarely true; probe harder.

## Prospector OS application
- When a rep asks "how is my deal with X", call \`get_deal_detail\` +
  \`find_contacts\` + \`search_transcripts\` and cross-reference each
  letter. Produce a scorecard: for each letter name the evidence (or
  "unknown") and tag the weakest letter as the next focus.
- Use contact-coverage flags in the schema (\`is_champion\`,
  \`is_economic_buyer\`, \`is_decision_maker\`) to pre-populate E and C.
- When \`days_in_stage\` exceeds the benchmark at Proposal / Negotiation,
  the MEDDPICC gap is almost always *D (decision process)* or *P (paper)*
  — ask the rep which.

## Common pitfalls
- Scoring the deal against MEDDPICC in isolation. The value is in the
  delta between calls — did the weakest letter improve since last week?
- Confusing champion with sponsor. A VP who likes you but won't spend
  political capital is not a champion.
- Accepting Metrics the rep made up. Metrics must come from the buyer's
  mouth (and ideally appear in a transcript).

## Attribution
MEDDIC was created by Dick Dunkel and Jack Napoli at PTC in the mid-1990s
and grew into MEDDPICC as Force Management added **P**aper process and
**C**ompetition. Canonical reading: *The MEDDIC Sales Academy*
(meddic.academy) and Force Management's *Command of the Message*.
`,
}
