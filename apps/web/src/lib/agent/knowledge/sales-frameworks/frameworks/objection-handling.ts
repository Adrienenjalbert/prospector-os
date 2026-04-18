import type { FrameworkDoc } from '../types'

export const objectionHandling: FrameworkDoc = {
  slug: 'objection-handling',
  title: 'Objection Handling (LAER + Feel-Felt-Found)',
  author: 'Carew International (LAER); traditional (Feel-Felt-Found)',
  source: 'LAER (Carew International); Feel-Felt-Found (classical sales)',
  stages: ['discovery', 'qualification', 'proposal', 'negotiation', 'closing'],
  objects: ['contact', 'deal'],
  best_for: ['objection_handling', 'stalled_deal', 'late_stage'],
  conversion_levers: [
    'fewer_stalls',
    'fewer_no_decisions',
    'higher_win_rate',
  ],
  content: `## One-line mental model
Objections are almost always incomplete information, not rejection.
Listen → Acknowledge → Explore → Respond, in order, before ever
addressing the surface objection.

## When to reach for it
- Any time the rep hears an objection — price, timing, competition,
  procurement, product fit.
- Stalled-deal reactivation, when a previous objection was papered over.
- Cold outreach follow-ups where the first reply is a soft "not right
  now".

## Scaffold — LAER (primary loop)
Run the full loop; never skip to Respond.

1. **L — Listen**: Silence after the objection. Let it breathe. Restate
   the objection in their exact words so they know you heard it.

2. **A — Acknowledge**: Validate the concern without agreeing it's
   insurmountable. "That's a fair concern, and I hear it a lot from
   Ops Directors on multi-site deployments."

3. **E — Explore**: One open question to surface the *real* concern
   behind the objection. Most stated objections are proxies for a
   deeper issue.
   - "When you say it's too expensive, can you help me understand
     what you're comparing it to?"
   - "What would need to be true for the timeline to work?"
   - "Is the concern the price itself, or the certainty that the value
     will show up?"

4. **R — Respond**: Now, and only now, address the *real* concern with
   evidence, a reframe, or a concrete adjustment.

## Feel-Felt-Found (supporting pattern)
Used inside LAER's Respond step when you need to introduce proof
without lecturing.

> "I understand how you **feel** — [name] at [customer] **felt** exactly
> the same way when we started the conversation. What they **found**
> was [specific, short outcome]."

Rules: only use with a real named customer; never invent. Works best
when the customer named is in the same industry/size band.

## Common objections + real-concern probes
- **"Too expensive"** → probe: "compared to what?" / "is the concern
  the number or the payback?"
- **"We already have X"** → probe: "what would make you consider
  switching?" / "what's X not doing that you wish it did?"
- **"Bad timing / Q4"** → probe: "what's the event that would make it
  good timing?" / "what would we need to prove before Q1?"
- **"Need to talk to the team"** → probe: "who specifically, and what
  do they need to see?" / "can I join that conversation?"
- **"Just send us a proposal"** → probe: "happy to — what needs to be
  in it for the team to say yes?"
- **"We're going with a competitor"** → probe: "what tipped it?" /
  "what are your concerns about that choice?"

## Prospector OS application
- When the agent's response contains *any* objection-handling language,
  it should tag \`[framework: LAER]\` and structure the response in
  the four-step order so the rep learns the pattern.
- For \`draft_outreach\` with \`outreach_type = 'stall_rescue'\`,
  default to LAER structure — listen (reference prior message),
  acknowledge (validate the delay), explore (specific question), only
  then re-propose a next step.
- \`coaching_themes\` output at the portfolio level can surface common
  objections across deals; the recommended coaching theme should cite
  this framework by name.

## Common pitfalls
- Jumping to Respond. The single most common rep mistake. The
  objection you think you heard is rarely the real one.
- Acknowledge phrased as agreement ("yes, we are expensive"). You're
  validating feelings, not conceding facts.
- Feel-Felt-Found with a made-up customer. Instant credibility loss.

## Attribution
The LAER model was developed by Carew International as part of their
sales training methodology (carew.com). Feel-Felt-Found is a classical
objection-response pattern taught in Dale Carnegie, Xerox PSS, and most
modern sales-training systems.
`,
}
