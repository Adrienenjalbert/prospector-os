import type { FrameworkDoc } from '../types'

export const spin: FrameworkDoc = {
  slug: 'spin',
  title: 'SPIN Selling',
  author: 'Neil Rackham',
  source: 'SPIN Selling (McGraw-Hill, 1988)',
  stages: ['discovery', 'problem_validation'],
  objects: ['company', 'contact', 'deal'],
  best_for: ['discovery', 'complex_sale', 'enterprise_b2b'],
  conversion_levers: [
    'better_qualification',
    'higher_need_acknowledged',
    'fewer_stalls',
  ],
  content: `## One-line mental model
Great discovery is a funnel of four question types that escalate from
benign facts to the prospect's own statement of the cost of inaction.

## When to reach for it
- Early-stage discovery calls on complex B2B deals.
- When the buyer hasn't admitted a pain yet and you suspect they have one.
- When you need the buyer to *self-quantify* the cost of the status quo —
  far more persuasive than any ROI slide you can build.

Avoid SPIN when the buyer is already in evaluation / RFP mode — at that
point you're past discovery and should switch to MEDDPICC or Value Selling.

## Scaffold
The four question types, in order. Ask 4–6 questions total, weighted heavily
toward Implication and Need-payoff — that's where the selling happens.

1. **Situation questions** — factual, low-effort. Don't overdo; you can get
   most of this from the CRM and \`research_account\` beforehand.
   - "How is this process handled today?"
   - "How many people are on the team that owns this?"

2. **Problem questions** — surface explicit dissatisfactions.
   - "Where does that process break down?"
   - "What's the biggest frustration your team has with it today?"

3. **Implication questions** — make the problem hurt. Connect it to
   downstream consequences the buyer cares about (revenue, risk, headcount,
   their own KPIs).
   - "When a shift goes unfilled, what's the knock-on impact on production
     output?"
   - "How does that delay show up in your OTIF numbers?"
   - "If this keeps happening, what does it cost you in agency fees by
     year-end?"

4. **Need-payoff questions** — let the buyer articulate the value of
   solving it, so they sell themselves.
   - "If you could fill those gaps in under 48 hours, what would that be
     worth to the operation?"
   - "How would your week look different if you didn't have to chase
     agencies on a Friday afternoon?"

## Prospector OS application
- Before a discovery call, use \`research_account\` + \`get_active_signals\`
  to prefill Situation answers so you can lead with Problem questions
  instead of wasting the first 10 minutes.
- After the call, Problem + Implication answers become structured
  \`signals\` rows with \`signal_type = 'pain_admitted'\` — feed them back
  via the webhook or an action-panel note so the priority score and
  urgency multiplier update automatically.
- Need-payoff statements are the best raw material for the next
  outreach email — quote them back to the champion verbatim in follow-ups.

## Common pitfalls
- Stacking too many Situation questions — buyer feels interrogated and
  engagement drops. Front-load CRM research, not the call.
- Skipping Implication and going straight to Need-payoff — the buyer
  agrees your solution is nice but hasn't felt the pain. Deals stall.
- Asking leading Implication questions the buyer can dismiss. Ground
  them in the buyer's own earlier answer.

## Attribution
Rackham, N. (1988). *SPIN Selling*. McGraw-Hill.
Based on 12 years of research across 35,000+ sales calls by Huthwaite.
`,
}
