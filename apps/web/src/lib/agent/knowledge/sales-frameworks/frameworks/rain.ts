import type { FrameworkDoc } from '../types'

export const rain: FrameworkDoc = {
  slug: 'rain',
  title: 'RAIN Selling',
  author: 'Mike Schultz & John Doerr (RAIN Group)',
  source: 'Rainmaking Conversations (Wiley, 2011)',
  stages: ['prospecting', 'discovery', 'qualification'],
  objects: ['company', 'contact', 'deal'],
  best_for: [
    'discovery',
    'complex_sale',
    'churn_risk',
    'expansion',
  ],
  conversion_levers: [
    'better_qualification',
    'higher_need_acknowledged',
    'higher_win_rate',
  ],
  content: `## One-line mental model
A good discovery conversation has five elements in one flow — build
Rapport, surface Aspirations, expose Afflictions, quantify Impact, paint
the New reality.

## When to reach for it
- First meaningful conversation with a new contact — RAIN balances
  rapport with substance.
- CSM / AD conversations where you're broadening from transactional to
  strategic.
- Expansion discovery where you can't interrogate an existing customer
  as if they're a cold prospect.

## Scaffold
- **R — Rapport**: Genuine, brief, specific to them. Not weather small
  talk; a pointed observation ("I saw you just promoted [X] into the
  regional ops role — congrats; how's the handover going?").

- **A — Aspirations**: What they *want* to achieve in the next 12-18
  months. Push past the generic ("grow") to the specific ("double
  volume without adding full-time heads in two regions").

- **I — Afflictions** (pain): What's blocking or eroding the
  aspirations. Sandler Pain Funnel fits perfectly here.

- **I — Impact**: The consequence of the afflictions not being
  resolved — quantified where possible (ties to Value Selling).

- **N — New reality**: Vision of the post-solution world, painted in
  their own language (Solution Selling's capability vision).

## Balance rule
Aspirations and Afflictions together: most reps over-index on
afflictions (pain) and under-index on aspirations (gain). A 60/40 mix
of aspiration-questions to affliction-questions out-performs pure pain-
hunting in RAIN Group's research.

## Prospector OS application
- For Account-Strategist agents, \`draft_meeting_brief\` should generate
  prompt questions in each of the five RAIN zones, pre-filled with
  relevant data from \`research_account\` and \`search_transcripts\`.
- For CSM expansion conversations, lead with Aspirations (not
  Afflictions) — existing customers resent being re-diagnosed as if
  they're broken.
- Rapport points can be auto-surfaced from
  \`relationship_notes\` — don't let the agent make them up; always
  ground in stored notes.

## Common pitfalls
- All afflictions, no aspirations — the conversation feels
  interrogative and the buyer disengages.
- Rapport that's generic ("how was your weekend?"). Specific beats
  friendly every time.
- New reality that sounds like a product pitch. It should describe a
  workday, not a feature list.

## Attribution
Schultz, M. & Doerr, J. (2011). *Rainmaking Conversations*. Wiley. The
RAIN Group (rainsalestraining.com) has continued to develop the model
with *Insight Selling* and related research.
`,
}
