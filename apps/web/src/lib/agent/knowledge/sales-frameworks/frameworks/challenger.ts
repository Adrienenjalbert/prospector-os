import type { FrameworkDoc } from '../types'

export const challenger: FrameworkDoc = {
  slug: 'challenger',
  title: 'Challenger Sale',
  author: 'Matthew Dixon & Brent Adamson (CEB / Gartner)',
  source: 'The Challenger Sale (Portfolio, 2011)',
  stages: ['discovery', 'qualification', 'proposal', 'negotiation'],
  objects: ['company', 'contact', 'deal', 'portfolio'],
  best_for: [
    'complex_sale',
    'enterprise_b2b',
    'commoditised_market',
    'leadership_brief',
    'expansion',
  ],
  conversion_levers: [
    'higher_win_rate',
    'larger_deal_size',
    'better_qualification',
  ],
  content: `## One-line mental model
High performers don't just solve problems buyers already know they have —
they reframe the buyer's view of their own business, then tailor that
reframe to the specific stakeholder, and take control of the conversation
about money and change.

## When to reach for it
- Commoditised markets where buyers think every vendor sounds the same.
- Enterprise deals where you need to displace an incumbent or a
  do-nothing default.
- Any conversation where the buyer has made up their mind prematurely.

Avoid pure "Challenger reframing" when the buyer already has strong,
correct pain awareness and just wants to compare options — SPIN or
MEDDPICC will do more work.

## Scaffold
The three moves, in the order you deliver them in a meeting:

1. **Teach** — lead with a **commercial insight**: a non-obvious, data-
   backed view of the buyer's world that reframes what they should care
   about. Structure: "Most companies like yours think X; the ones winning
   are doing Y; here's why — and here's what it costs to keep doing X."

2. **Tailor** — shape the same insight for the specific stakeholder. A CFO
   hears it as cost-of-capital; an Ops Director hears it as shift-level
   disruption; a CIO hears it as integration risk.

3. **Take control** — drive the conversation on money, timeline, and
   decision process with confidence. Don't be afraid to push back ("if
   that's the budget, here's the scope that fits — and here's what we'd
   have to leave out").

## Commercial insight template
Pick one industry-specific data point from your \`research_account\` /
\`get_active_signals\` output and follow this structure:

> "Our data from [N] operations like yours shows [unexpected fact]. The
> teams that treat [X] as a scheduling problem end up paying [£X more in
> agency fees / losing [N%] of capacity]. The teams that treat it as a
> workforce-architecture problem recover [specific outcome]. Which camp
> would you say you're in today?"

## Prospector OS application
- Use \`research_account\` + \`get_active_signals\` to find the
  industry/company-specific insight before the call — never open with a
  generic insight.
- For Leadership Lens briefings, use \`coaching_themes\` + \`team_patterns\`
  to surface the insight the leader should teach *their team* about the
  portfolio.
- For account expansion, Challenger is often the right lens: the customer
  thinks they know what they bought, and expansion requires reframing.

## Common pitfalls
- "Teaching" with a generic trend deck instead of a specific insight
  grounded in this account's data. Buyers tune out within 30 seconds.
- Skipping Tailor — delivering the same insight to the Ops Director and
  the CFO verbatim. The reframe has to land in *their* economic language.
- Confusing "take control" with "be aggressive". Control is calm
  directness about facts, money, and process — not volume.

## Attribution
Dixon, M. & Adamson, B. (2011). *The Challenger Sale: Taking Control of
the Customer Conversation*. Portfolio/Penguin. Based on CEB research
covering thousands of reps across multiple industries.
`,
}
