import type { FrameworkDoc } from '../types'

export const jolt: FrameworkDoc = {
  slug: 'jolt',
  title: 'JOLT (Overcoming the Indecision Trap)',
  author: 'Matthew Dixon & Ted McKenna',
  source: 'The JOLT Effect (Portfolio, 2022)',
  stages: ['proposal', 'negotiation', 'closing'],
  objects: ['deal', 'contact'],
  best_for: [
    'stalled_deal',
    'indecision',
    'late_stage',
  ],
  conversion_levers: [
    'fewer_no_decisions',
    'fewer_stalls',
    'higher_win_rate',
    'faster_cycle',
  ],
  content: `## One-line mental model
Late-stage deals don't lose to competitors — they lose to the buyer's
fear of making a wrong decision. Four moves (Judge, Offer, Limit, Take
risk off the table) convert "no decision" into "yes".

## When to reach for it
- Any late-stage deal that's been in Proposal / Negotiation longer than
  the benchmark median and isn't competitively contested.
- "Let me think about it" / "let's revisit next quarter" signals —
  classic indecision markers.
- When a champion is enthusiastic but the rest of the committee keeps
  asking for "one more thing".

Not for early-stage; use SPIN / Sandler / Pain Funnel instead.

## Scaffold — the 4 JOLT moves
Research on 2.5M sales calls: 40-60% of lost deals went to "no
decision", not a competitor. JOLT targets that loss.

1. **J — Judge the indecision**: Diagnose *which* flavour you're facing.
   - Valuation problem: "not sure it's worth it".
   - Lack of information: "I don't know enough to decide".
   - Outcome uncertainty: "I'm not sure it'll work for us".
   Different flavours need different moves; don't blanket-treat them.

2. **O — Offer your recommendation**: Buyers in indecision *want* to be
   told what to do by someone they trust. Stop offering options; make
   a specific, confident recommendation based on what you know about
   them. "Based on what you've told me about [X], [option B] is the
   right call. Here's why."

3. **L — Limit the exploration**: High performers *narrow* the decision
   scope when buyers are overwhelmed — the opposite of the instinct to
   add more information. Remove tiers, remove options, remove add-ons.
   "Let's take the Enterprise tier off the table for now. The Pro tier
   gets you to [their Metric] within 90 days. We can revisit Enterprise
   post-launch."

4. **T — Take risk off the table**: Give them a credible way to reverse
   the decision if they're wrong. Pilots, 90-day out-clauses, phased
   rollouts, ROI guarantees tied to their own metric. Not a discount —
   discounts signal the price was inflated to begin with.

## Prospector OS application
- \`detect_stalls\` output for deals at Proposal / Negotiation should
  trigger the agent to suggest the JOLT sequence as next action.
- The agent can't judge the indecision flavour from data alone — the
  next step is almost always "ask the champion one specific question
  to surface which kind of indecision is driving the delay".
- \`draft_outreach\` with \`outreach_type = 'stall_rescue'\` should default
  to JOLT structure: acknowledge the delay, offer a recommendation,
  narrow the scope, propose a risk-off mechanism (pilot or phased).

## Common pitfalls
- Treating indecision as an objection. Objections are about the
  product; indecision is about the buyer's self-doubt. Totally
  different response.
- Over-offering options in the name of "choice". Every added option
  makes indecision worse.
- Taking risk off the table with a discount. Price cuts reinforce the
  buyer's suspicion that the deal wasn't worth it at full price.

## Attribution
Dixon, M. & McKenna, T. (2022). *The JOLT Effect: How High Performers
Overcome Customer Indecision*. Portfolio/Penguin. Based on analysis of
2.5M recorded sales calls by Tethr.
`,
}
