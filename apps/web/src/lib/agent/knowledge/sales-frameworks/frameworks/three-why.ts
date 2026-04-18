import type { FrameworkDoc } from '../types'

export const threeWhy: FrameworkDoc = {
  slug: 'three-why',
  title: 'Three Whys (Why Anything, Why You, Why Now)',
  author: 'Mark Roberge (HubSpot), popularised by multiple authors',
  source: 'The Sales Acceleration Formula (Roberge, 2015) and related work',
  stages: ['prospecting', 'discovery', 'qualification'],
  objects: ['company', 'deal', 'contact'],
  best_for: [
    'qualification',
    'complex_sale',
    'discovery',
  ],
  conversion_levers: [
    'better_qualification',
    'fewer_no_decisions',
    'faster_cycle',
  ],
  content: `## One-line mental model
Every deal that closes answers three questions in order; any deal that
can't answer all three is unqualified, no matter how interested the
buyer sounds.

## When to reach for it
- At the end of any qualification call — a 60-second mental gut-check.
- As the framing for an internal deal review or forecast call.
- When asked "should this deal be in our forecast?" — if you can't
  answer all three Whys clearly, no.

## Scaffold — the three questions
Answer each in one sentence. If any answer has "um", downgrade the deal.

1. **Why anything?** — Why should this buyer change *at all*? What is
   the compelling event, the pain they've admitted, the quantified
   cost of inaction?

2. **Why you?** — Why should they change *to your solution* over the
   alternatives (including building in-house, staying put, or a
   competitor)? What's the specific required capability you deliver
   better?

3. **Why now?** — What event, deadline, or window makes *this quarter*
   the right time, rather than next quarter or next year?

## Use in coaching
In a 1:1, a manager can diagnose any deal in 3 minutes by walking the
rep through the three Whys. Patterns:
- Deals missing "Why anything" are actually in discovery, not
  qualification — rep is fooling themselves about pipeline stage.
- Deals missing "Why you" will lose to a competitor or to inertia.
- Deals missing "Why now" slip the quarter, every time.

## Prospector OS application
- For the \`deal_strategy\` / \`get_deal_detail\` tool output, the agent
  should close with a Three-Why summary of the deal as part of the
  health read. Missing any Why = at-risk flag in addition to stall
  status.
- The Leadership Lens \`forecast_risk\` tool should treat deals that
  lack a stated compelling event (Why now) as forecast-risk regardless
  of their stage or champion strength.

## Common pitfalls
- Accepting "the competition is more expensive" as "Why you". Price is
  a trade-off, not a required capability.
- Accepting "they're really interested" as "Why now". Interest isn't an
  event; a contract expiry or regulatory deadline is.
- Confusing "Why anything" with product fit. Fit means they *could* buy;
  Why anything means they *will* change.

## Attribution
Widely attributed to Mark Roberge's early HubSpot sales methodology and
summarised in *The Sales Acceleration Formula* (Roberge, 2015). The
three-part framing also appears in Bosworth's and Napoli's work and has
become a standard gut-check across modern sales-training programs.
`,
}
