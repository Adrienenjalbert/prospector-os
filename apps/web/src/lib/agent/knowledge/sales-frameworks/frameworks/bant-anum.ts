import type { FrameworkDoc } from '../types'

export const bantAnum: FrameworkDoc = {
  slug: 'bant-anum',
  title: 'BANT and ANUM',
  author: 'IBM (BANT, 1960s); Ken Krogue (ANUM, 2013)',
  source: 'BANT (IBM Opportunity ID Manual); ANUM (InsideSales.com, 2013)',
  stages: ['prospecting', 'qualification'],
  objects: ['deal', 'contact', 'company'],
  best_for: ['qualification', 'smb'],
  conversion_levers: [
    'better_qualification',
    'faster_cycle',
    'better_forecast_accuracy',
  ],
  content: `## One-line mental model
Two fast, stage-1 filters for deciding whether a lead is worth a serious
conversation at all. BANT checks the four historic essentials; ANUM
re-orders them for modern buyer reality where authority matters more
than budget up front.

## When to reach for it
- Top-of-funnel / SDR-style qualification where you have minutes, not
  hours, to decide whether to escalate.
- SMB deals with short cycles where a heavy MEDDPICC scorecard would
  be overkill.
- When the rep is drowning in MQLs and needs a simple triage filter.

Don't rely on BANT/ANUM past initial qualification — for anything mid-
to late-stage, upgrade to MEDDPICC.

## Scaffold — BANT (IBM original)
- **B — Budget**: Do they have funding available, or a path to it?
- **A — Authority**: Can this person sign, or do they credibly route to
  the person who can?
- **N — Need**: Is there a real, articulated business problem?
- **T — Timeline**: Is there an urgency trigger driving a decision?

A lead passes when you can answer YES to 3 of 4 (Need + 2 others).

## Scaffold — ANUM (modern re-order)
Krogue's argument: by the time a buyer talks to sales, they've done
their own research. Authority and Need matter earlier; Budget emerges
as scope is agreed.
- **A — Authority** (lead with this; verifies you're talking to the
  right person).
- **N — Need**.
- **U — Urgency** (why now — triggers, risks, compelling events).
- **M — Money** (addressed once scope is defined, not upfront).

## Prospector OS application
- Use \`research_account\` + \`find_contacts\` to pre-check **Authority**
  automatically (seniority + is_decision_maker / is_economic_buyer
  flags). No rep should spend an hour on a call before we've done that.
- Use \`get_active_signals\` to score **Urgency**: signal_type values
  like \`leadership_change\`, \`funding_round\`, \`rfp_issued\` are urgency
  triggers the agent should cite by name.
- Use \`get_pipeline_overview\` + company \`employee_count\` /
  \`annual_revenue\` to sanity-check **Budget/Money** range against
  historical won-deal sizes.
- When ANUM fails, the priority queue should deprioritise, not blacklist
  — authority can emerge and urgency can shift.

## Common pitfalls
- Treating BANT as a gate instead of a triage filter. Good deals
  sometimes fail BANT in the first call and recover in the second.
- Asking all four BANT questions bluntly in order — feels like an
  interrogation. Weave them into conversation.
- Accepting "we're looking at a few options" as a Timeline. That's a
  non-answer; push for the actual event driving any decision.

## Attribution
BANT first appeared in IBM's Budget, Authority, Need, Timing opportunity-
identification methodology (1960s, later formalised in IBM's Global
Services playbooks). ANUM was articulated by Ken Krogue at InsideSales
(now XANT) in 2013 as a modern reorder for inbound-led sales.
`,
}
