import type { FrameworkDoc } from '../types'

export const neatSelling: FrameworkDoc = {
  slug: 'neat-selling',
  title: 'NEAT Selling',
  author: 'The Harris Consulting Group & Sales Hacker',
  source: 'NEAT Selling (Harris Consulting, 2014)',
  stages: ['qualification'],
  objects: ['deal', 'contact', 'company'],
  best_for: ['qualification', 'smb', 'complex_sale'],
  conversion_levers: [
    'better_qualification',
    'faster_cycle',
    'better_forecast_accuracy',
  ],
  content: `## One-line mental model
BANT asks "can they buy?"; NEAT asks "should we sell to them?" — by
centering core needs, economic impact, access to authority, and a
genuine compelling event.

## When to reach for it
- Modern inbound qualification where BANT feels interrogation-shaped.
- B2B SaaS deals with consumption/value-based pricing where "Budget"
  isn't a clean yes/no.
- Any call where you want qualification to feel like genuine diagnosis.

## Scaffold
- **N — Need (core)**: Not the surface-level need, the *core* need the
  buyer hasn't yet fully articulated. Use SPIN-style implication
  questions to dig past the stated need to the real one.
- **E — Economic impact**: The quantified cost of the core need being
  unaddressed, and the upside of solving it. Same grammar as
  Value Selling's "gap".
- **A — Access to authority**: Not just "do you have authority?" but
  "can our champion get us a direct conversation with the person who
  signs?" — a higher bar that catches more deals before they stall.
- **T — Timeline (compelling event)**: A specific, date-anchored event
  that forces a decision — contract expiry, board commitment, new hire
  start date, regulatory deadline. "Q4 sometime" is not a compelling
  event.

## Prospector OS application
- \`get_active_signals\` with \`signal_type\` values like
  \`contract_renewal\`, \`leadership_change\`, \`funding_round\` are the
  strongest compelling-event candidates. Surface them in the pre-call
  brief and ask the buyer which is actually driving urgency.
- \`find_contacts\` + contact-coverage flags power the Access test — if
  the champion is 2+ levels below the economic buyer and we've never
  met the EB, Access is weak.
- Pair NEAT with MEDDPICC for late-stage: NEAT qualifies early, MEDDPICC
  forensics the deal later.

## Common pitfalls
- Accepting a "timeline" without a compelling event attached. "End of
  Q2" isn't a compelling event; "contract with [incumbent] auto-renews
  May 31 unless we move first" is.
- Treating Access as a trivia question. If the buyer can't describe
  *how* you'd get 30 minutes with the economic buyer, Access is F.
- Using NEAT as a gate rather than a conversation frame — like any
  acronym, it loses power when it becomes a checklist.

## Attribution
Developed by Richard Harris and the Harris Consulting Group, popularised
via Sales Hacker (2014). See theharrisconsultinggroup.com.
`,
}
