import type { FrameworkDoc } from '../types'

export const snap: FrameworkDoc = {
  slug: 'snap',
  title: 'SNAP Selling',
  author: 'Jill Konrath',
  source: 'SNAP Selling (Portfolio, 2010)',
  stages: ['prospecting', 'discovery'],
  objects: ['contact', 'company', 'deal'],
  best_for: [
    'discovery',
    'smb',
    'commoditised_market',
  ],
  conversion_levers: [
    'faster_cycle',
    'better_qualification',
    'higher_win_rate',
  ],
  content: `## One-line mental model
Modern buyers are drowning in noise. Every interaction must pass four
tests (Simple, iNvaluable, Aligned, Priority) before they'll give you
another minute.

## When to reach for it
- Cold outreach and early-stage conversations where attention is scarce.
- Mid-market / SMB motions where a long enterprise cycle isn't realistic.
- Commoditised markets where reps are competing on clarity, not
  features.

## Scaffold — the four SNAP filters
Every email, call, meeting, and proposal gets held to these:

1. **S — Simple**: Can the buyer understand what you do and why they
   should care in one breath? If your cold email has more than three
   sentences of setup before the ask, it fails.

2. **N — iNvaluable**: Have you delivered insight they couldn't have
   gotten themselves from a Google search? Commodity information ("have
   you heard of labour shortages?") gets deleted; specific, data-backed
   insight on *their* operation earns the next meeting.

3. **A — Aligned**: Does what you're proposing map to a priority they
   *already* own? Even a great idea aimed at the wrong goal fails.

4. **P — Priority**: Is what you're pitching *urgent enough* that it
   displaces something else on their calendar? If not, they'll agree
   it's interesting and never act.

## Three decisions buyers make
Konrath models the buyer as making three sequential decisions. Each one
filters through the SNAP tests above.

1. **Allow access**: Should I talk to you at all?
2. **Initiate change**: Is there a real problem worth solving now?
3. **Select a solution**: Why you and not alternatives?

Reps lose most often at decision 1 because their outreach fails Simple
or Invaluable; at decision 2 because it fails Aligned or Priority.

## Prospector OS application
- For \`draft_outreach\` (cold email / LinkedIn), the agent should
  validate the draft against all four SNAP tests before presenting it
  to the rep. If Simple fails (too long), shorten; if Invaluable fails
  (no specific insight), pull a \`get_active_signals\` data point.
- For meeting agendas drafted via \`draft_meeting_brief\`, Priority is
  the test most often failed — the agent should ask "why does this
  meeting matter this week rather than next month?" and ensure the
  answer is in the brief.

## Common pitfalls
- Invaluable confused with "clever". Clever without specificity is just
  noise. Invaluable is "here's a data point about *your* operation you
  probably don't know".
- Aligning to what *you* think their priority should be, not what it
  actually is. Priorities come from their own words — transcripts, 10-
  Ks, press releases — not your imagination.
- Simple sacrificed for "comprehensive". A 10-bullet email is not
  simple. A single-sentence ask is.

## Attribution
Konrath, J. (2010). *SNAP Selling: Speed Up Sales and Win More Business
with Today's Frazzled Customers*. Portfolio. jillkonrath.com.
`,
}
