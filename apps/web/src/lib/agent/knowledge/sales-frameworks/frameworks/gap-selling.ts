import type { FrameworkDoc } from '../types'

export const gapSelling: FrameworkDoc = {
  slug: 'gap-selling',
  title: 'Gap Selling',
  author: 'Keenan (Jim Keenan)',
  source: 'Gap Selling (A Sales Growth Co., 2018)',
  stages: ['discovery', 'qualification', 'proposal'],
  objects: ['company', 'deal', 'contact'],
  best_for: ['discovery', 'complex_sale', 'commoditised_market'],
  conversion_levers: [
    'higher_need_acknowledged',
    'better_qualification',
    'larger_deal_size',
  ],
  content: `## One-line mental model
You don't sell a product; you sell the change from the current state to
the future state — and the bigger the gap between those two, the more the
buyer will pay to close it.

## When to reach for it
- Discovery where you need to make the cost of inaction explicit.
- Commoditised markets — gap selling differentiates on business impact,
  not features.
- Deals stuck in "happy ears" (rep thinks it's advancing; buyer sees no
  reason to change).

## Scaffold — Current → Future → Gap
Map these three on every account, ideally on a single page.

1. **Current state**
   - Literal: what is happening today? Process, tools, numbers.
   - Physical: what is it costing them? £, time, shrink, missed shifts.
   - Emotional: how does this feel to the buyer personally? Frustration,
     fear, career risk, reputation.

2. **Future state**
   - Literal: what would the new process look like?
   - Physical: what would the new numbers be?
   - Emotional: how would the buyer feel? What career/status/team win
     do they get?

3. **Gap**
   - The delta, in absolute terms — £X/year, N hours/week, P%
     improvement.
   - Tied to a root cause: *why* does the gap exist today? Without a
     root cause, you'll sell a solution that doesn't fit.

Rule of thumb: no root cause → no deal.

## Prospector OS application
- For every priority account, the account-strategist agent should
  maintain a lightweight "Current vs Future" mental model derived from
  \`research_account\` + \`search_transcripts\`. Surface the gap in the
  pre-call brief.
- When \`detect_stalls\` flags a deal, 80% of the time it's because the
  gap wasn't quantified. The unstall move is to re-run Current/Future
  with the champion, not to send another follow-up email.
- For expansion, the gap conversation shifts: Current = what they do
  with your product today; Future = what they could do with the next
  tier. Same structure.

## Common pitfalls
- Framing current state only in literal terms. The emotional dimension
  is where urgency lives — if the buyer doesn't feel the gap, they won't
  act.
- Describing the future state in your product's language instead of the
  buyer's. If they can't tell their boss what changes, nothing changes.
- Skipping root cause. "We need better scheduling" isn't a root cause;
  "our shift-lead is spending 12 hours/week chasing fillers because our
  incumbent agency can't source above a 70% fill rate" is.

## Attribution
Keenan (2018). *Gap Selling: Getting the Customer to Yes*. A Sales
Growth Company.
`,
}
