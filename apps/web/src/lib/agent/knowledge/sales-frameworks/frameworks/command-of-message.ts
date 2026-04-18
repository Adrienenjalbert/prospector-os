import type { FrameworkDoc } from '../types'

export const commandOfMessage: FrameworkDoc = {
  slug: 'command-of-message',
  title: 'Command of the Message',
  author: 'John Kaplan & John McMahon (Force Management)',
  source: 'Command of the Message (Force Management, ongoing)',
  stages: ['discovery', 'qualification', 'proposal'],
  objects: ['deal', 'contact', 'company', 'portfolio'],
  best_for: [
    'complex_sale',
    'enterprise_b2b',
    'leadership_brief',
    'commoditised_market',
  ],
  conversion_levers: [
    'larger_deal_size',
    'higher_win_rate',
    'better_qualification',
  ],
  content: `## One-line mental model
A repeatable value framework — who you sell to, what business problems
you solve, what required capabilities it takes to solve them, what
metrics prove it, and how you're different — that every rep can deliver
identically under pressure.

## When to reach for it
- You're hearing reps pitch your company five different ways in
  transcripts. Command of the Message makes the story repeatable.
- Leadership-level briefings where the CEO / CRO wants the team's
  selling narrative to stand up to board-level scrutiny.
- Deals in procurement where the champion needs a clean version of the
  story to defend internally.

## Scaffold — the value framework elements
For your company and each persona you sell to, maintain these five
elements. The agent should draw on them for outreach and briefs.

1. **Audience**: Who exactly? Role + company profile. Not "enterprises"
   — "Heads of Workforce Planning at 1,000-10,000 employee distribution
   operations running multi-site shift work".

2. **Business issues**: The 2-3 highest-order business problems this
   audience loses sleep over. CEO-level language. *Not* features.

3. **Implications**: What happens if the business issue isn't resolved?
   Revenue lost, risk taken, careers affected.

4. **Required capabilities**: What *any* solution (not just yours) would
   need to deliver to solve the business issue. The rep pitches
   capabilities; the sponsor buys the same capabilities from whoever
   delivers them best.

5. **Proven metrics + positive business outcomes**: Specific, named-
   customer outcomes. "At [customer], we went from X to Y in Z months."

## Message test
If you can't do the following in 60 seconds without a deck, you don't
have command yet:
- Name the persona.
- State one business issue.
- Name two required capabilities.
- Quote one proven metric from a customer outcome.

## Prospector OS application
- The tenant's \`value_propositions\` field in \`business_profiles\`
  should map 1:1 to required capabilities. The agent drafts outreach
  and briefs against these, never freelancing capabilities.
- For \`draft_meeting_brief\` and \`draft_outreach\`, the agent should
  lead with the business issue + implication (from Challenger-style
  teaching), then pivot to required capabilities (Command-of-Message
  grammar).
- Leadership-lens reviews cite Command of the Message elements by name
  when surfacing coaching themes — e.g. "5 reps are missing the
  implication step on [business issue]".

## Common pitfalls
- Required capabilities that are thinly disguised features ("our AI-
  powered scheduling") — that's still features. Capabilities are
  what *any* solution would have to do.
- No named-customer metrics. Generic "customers have seen up to 40%
  improvement" is hearsay; "[Customer X] moved their agency spend from
  £2.1M to £1.3M in 9 months, signed by [name, title]" is proof.
- Letting reps rewrite the framework per deal. The point is repeatability.

## Attribution
Force Management's Command of the Message methodology, developed by
John Kaplan, John McMahon and team. See forcemanagement.com.
`,
}
