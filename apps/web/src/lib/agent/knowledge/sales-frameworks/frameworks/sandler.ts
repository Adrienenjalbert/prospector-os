import type { FrameworkDoc } from '../types'

export const sandler: FrameworkDoc = {
  slug: 'sandler',
  title: 'Sandler Selling System',
  author: 'David H. Sandler',
  source: 'You Can\'t Teach a Kid to Ride a Bike at a Seminar (Sandler, 1995)',
  stages: [
    'prospecting',
    'discovery',
    'qualification',
    'proposal',
    'closing',
  ],
  objects: ['company', 'contact', 'deal'],
  best_for: [
    'complex_sale',
    'stalled_deal',
    'discovery',
    'qualification',
  ],
  conversion_levers: [
    'fewer_stalls',
    'fewer_no_decisions',
    'better_qualification',
    'faster_cycle',
  ],
  content: `## One-line mental model
A buyer-seller relationship has unspoken rules that favour the buyer by
default; Sandler's job is to replace those rules with an explicit,
mutual up-front contract so you never get stuck in the "think-it-over".

## When to reach for it
- Early-cycle calls where you don't want to get trapped demoing without
  qualification.
- Stalled deals where the prospect keeps saying "let me think about it"
  — Sandler's "negative reverse" and "no-no-close" are the cure.
- Any conversation where you sense the buyer is treating you as a free
  consultant.

## Scaffold: the Sandler Submarine (7 compartments)
Each compartment has to be closed before you open the next.

1. **Bonding & rapport** — genuine, brief. Not weather-and-weekend small
   talk; a specific, human observation about their business or role.
2. **Up-front contract** — agree *before* the call on: purpose, time,
   their agenda, your agenda, and explicit mutual outcomes ("at the end
   we'll either have a clear next step or we'll both agree this isn't a
   fit — is that ok with you?"). Eliminates "think it over" endings.
3. **Pain** — find the real reason they'd change. Use the pain funnel
   (see the \`pain-funnel\` framework) to move from intellectual
   acknowledgement to emotional / business / personal impact.
4. **Budget** — verify they can fund the solution at your price range.
   Sandler insists on this *before* you invest in a proposal.
5. **Decision** — confirm the actual decision process, not just the
   decision maker. Who else signs off? What's happened on similar
   past purchases?
6. **Fulfillment** — the demo / solution / proposal. Note how far this
   is into the process — you earn it, you don't lead with it.
7. **Post-sell** — lock down the commitment. Address buyer's remorse,
   pre-empt renegotiation, confirm onboarding path.

## Up-front contract template
> "Before we dive in, can we agree on how the next 30 minutes go? Here's
> what I'd like to cover — [X, Y, Z]. What would you like to add or
> change? And at the end, one of three things will happen: we'll agree
> this is worth a next step and I'll propose what that looks like; or
> we'll agree there's no fit and we part professionally; or we'll need
> more information and we'll schedule a specific next call. Fair?"

## Prospector OS application
- Before any discovery or demo call, the agent should suggest an
  up-front contract line in the pre-call brief (see
  \`draft_meeting_brief\`).
- For stalled deals surfaced via \`detect_stalls\`, the recommended action
  should include Sandler's "no-no-close" pattern: give the prospect
  explicit permission to say no to surface the real objection.
- Pair with the \`pain-funnel\` framework when Pain is surfaced but shallow.

## Common pitfalls
- Up-front contract as a formality instead of a real agreement. If the
  prospect mumbles "sure", you don't have a contract.
- Skipping Budget because it "feels rude". It's the single biggest
  reason deals go to "think it over" — the prospect couldn't afford it.
- Going into Fulfillment before Pain is fully qualified — you'll end up
  giving a demo that is judged on features, not problem fit.

## Attribution
Sandler, D. H. (1995). *You Can't Teach a Kid to Ride a Bike at a
Seminar*. Sandler Systems. The submarine metaphor and up-front contract
are core to the Sandler training methodology (sandler.com).
`,
}
