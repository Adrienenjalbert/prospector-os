import type { FrameworkDoc } from '../types'

export const solutionSelling: FrameworkDoc = {
  slug: 'solution-selling',
  title: 'Solution Selling',
  author: 'Michael Bosworth; updated by Keith Eades',
  source: 'The New Solution Selling (Eades, 2003)',
  stages: ['discovery', 'qualification', 'proposal'],
  objects: ['company', 'deal', 'contact'],
  best_for: ['complex_sale', 'enterprise_b2b', 'discovery'],
  conversion_levers: [
    'higher_need_acknowledged',
    'better_qualification',
    'larger_deal_size',
  ],
  content: `## One-line mental model
Buyers don't buy features — they buy a diagnosis of their pain, a vision
of what's possible if the pain is solved, and confidence that you can
deliver that vision.

## When to reach for it
- Complex B2B deals with multiple stakeholders and a long cycle.
- Markets where buyers are pain-aware but solution-unsure.
- Any time you hear yourself pitching product features in the first
  meeting — Solution Selling is the antidote.

## Scaffold — pain chain → diagnosis → vision
1. **Admitted pain** — the buyer explicitly states a business pain.
   Intellectual acknowledgement isn't enough; you want an
   admission they own.

2. **Pain chain** — trace *who else* in the org is affected and *how*.
   Pain rarely sits with one person; the chain reveals who your multi-
   threaded champions are.

3. **Diagnosis** — pinpoint the root cause in language the buyer
   recognises, using their examples. This is where "Solution Selling"
   sounds like consulting, not selling.

4. **Capability vision** — paint the post-solution state in enough detail
   that the buyer can *imagine themselves* using it. Use their own
   examples, re-sequenced to include your capabilities implicitly.

   Template: *"So imagine on a Friday afternoon, instead of calling
   three agencies for Monday cover, you'd open [solution view] and see
   X. When a cancellation comes in at 6pm, Y happens automatically.
   Your shift lead's first job Monday morning is Z instead of what it
   is today. Does that sound like where you'd want to be?"*

5. **Proof** — one 2-minute customer story (same industry, same-ish
   size) where exactly this vision became reality.

## Prospector OS application
- Use \`search_transcripts\` to find the buyer's own pain language before
  the next call, then replay it during the vision step — word-for-word
  where possible.
- \`find_contacts\` with seniority filters to map the pain chain beyond
  the primary contact; each affected stakeholder is a multi-thread
  opportunity.
- Pair with \`value-selling\` to quantify the vision's outcome — the
  vision paints the "what", value selling prices the "how much".

## Common pitfalls
- Vision that sounds like a demo. If it enumerates features, it's not
  a vision; it's a pitch.
- Skipping admitted pain — offering a vision to someone who hasn't
  owned the problem is just noise.
- Stopping at the primary contact's pain when the chain goes four
  layers deep. The champion's pain is rarely the economic buyer's pain.

## Attribution
Eades, K. (2003). *The New Solution Selling*. McGraw-Hill. Updates
Bosworth's original *Solution Selling* (1994) with the pain-chain and
capability-vision model used across enterprise B2B.
`,
}
