import type { FrameworkDoc } from '../types'

export const valueSelling: FrameworkDoc = {
  slug: 'value-selling',
  title: 'Value Selling / Value-Based Selling',
  author: 'Mike Bosworth, Tim Riesterer, Visualize (popularised)',
  source: 'Customer-Centric Selling (Bosworth/Holland, 2004) + Value Framework (Visualize)',
  stages: ['qualification', 'proposal', 'negotiation'],
  objects: ['deal', 'company', 'portfolio'],
  best_for: [
    'complex_sale',
    'enterprise_b2b',
    'late_stage',
    'leadership_brief',
  ],
  conversion_levers: [
    'larger_deal_size',
    'higher_win_rate',
    'faster_cycle',
  ],
  content: `## One-line mental model
Price objections are almost always value objections in disguise — so
build and quantify the business case in the buyer's own language before
you ever put a number in a proposal.

## When to reach for it
- Any deal where the buyer says "send me a quote" too early.
- Late-stage deals where procurement has entered and the champion has
  no ammunition to defend the price.
- Renewals and expansions where you need to justify uplift.

## Scaffold — the five-step value case
Build these in order; each output feeds the next.

1. **Outcome**: What specific business outcome does the buyer care
   about? Framed in their metric (OTIF %, agency spend, production
   output, shrink, etc.).
2. **Baseline**: Today's number. "What's your agency spend this year?"
   "How many open shifts went unfilled last month?"
3. **Gap**: Target vs baseline, in their units. "If agency spend stays
   flat at £1.8M and you said target is £1.2M, the gap is £600k/year."
4. **Mechanism**: How *our solution* moves baseline toward target, in
   plain cause-and-effect language tied to 2–3 product capabilities.
   Not all capabilities — just the ones that close the gap.
5. **Quantified impact**: Expected movement × confidence × timeline.
   "Pilots have hit 40-60% of the gap within 90 days. Conservatively,
   that's £240-360k/year ongoing from month 4."

## Price defence template
When procurement pushes back on price, do not discount. Instead:

> "Let's re-anchor. The reason we sized this at £Y was because the
> quantified impact we agreed with [champion] was £X/year. Our price is
> Y/X of that — a [N]-month payback. If the impact assumption has
> changed, let's revisit that. If the impact is still right, the price
> is proportionate."

## Prospector OS application
- Use \`research_account\` output (industry, employee_count,
  annual_revenue) and tenant \`value_propositions\` to draft the
  Outcome + Mechanism.
- \`search_transcripts\` for the champion's own words describing the
  baseline — quote them verbatim in the business case.
- For expansion plays on existing customers, the mechanism should cite
  *realised* impact from the current deployment (close the loop via
  outcome events), not projections.

## Common pitfalls
- Making up baseline numbers the buyer hasn't confirmed. A fictional
  baseline produces a fictional ROI, which procurement will destroy.
- Over-claiming mechanism — listing 8 capabilities when 2 close the
  gap. Focus wins.
- Putting the ROI slide in the proposal deck instead of landing it
  verbally first. If the buyer can't explain the number back to you,
  it isn't real.

## Attribution
The value-case methodology has roots in Bosworth & Holland's
*Customer-Centric Selling* (McGraw-Hill, 2004) and has been refined by
Visualize (visualizeinc.com), Corporate Visions (Riesterer et al.), and
ValueSelling Associates. Corporate Visions research: *The Three Value
Conversations* (Riesterer, Peterson, Riley, Geraghty, 2015).
`,
}
