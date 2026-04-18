/**
 * Seed golden eval set for the agent. Split into three categories that match
 * the three context strategies the router picks:
 *   - concierge  (open-question, no active object)
 *   - account    (company_deep, user on /objects/companies/:id)
 *   - portfolio  (CSM/AE reviewing their book)
 *
 * Each case specifies:
 *   - question     : the user utterance
 *   - expected_tools: tool slugs we expect the agent to call (any-of match)
 *   - expected_citation_types: citation source_types that MUST appear
 *   - rubric       : one-line scoring instruction for the LLM judge
 *
 * This is the SEED set. The nightly evalGrowthWorkflow (Phase 7) auto-promotes
 * real production failures into this same shape, so the suite grows from
 * real usage and stays relevant.
 */

export interface EvalCase {
  id: string
  category: 'concierge' | 'account' | 'portfolio'
  role: 'ae' | 'nae' | 'csm' | 'ad' | 'leader'
  question: string
  expected_tools: string[]
  expected_citation_types: string[]
  rubric: string
}

export const GOLDEN_EVAL_CASES: EvalCase[] = [
  // -- Concierge (30)
  ...concierge([
    ['What is the fulfillment rate for Acme Logistics this quarter?', ['research_account'], ['company']],
    ['Which of my accounts had a deal closed in the last 30 days?', ['get_pipeline_overview'], ['opportunity']],
    ['Who owns the Echo Foods account?', ['research_account'], ['company']],
    ['Show me deals over £500K in the Proposal stage.', ['get_pipeline_overview'], ['opportunity']],
    ['How many signals have we detected this week?', ['get_active_signals'], ['signal']],
    ['What stalled deals should I look at today?', ['detect_stalls'], ['opportunity']],
    ['Which accounts match our ICP tier A?', ['research_account'], ['company']],
    ['Do we have notes on John Smith from Delta Distribution?', ['find_contacts'], ['contact']],
    ['What funnel stages am I losing the most deals at?', ['get_funnel_benchmarks'], ['funnel_benchmark']],
    ['Which industries are generating the most signals?', ['get_active_signals'], ['signal']],
    ['How does my conversion rate compare to the company benchmark?', ['get_funnel_benchmarks'], ['funnel_benchmark']],
    ['Show me opportunities I\'ve ignored for more than 14 days.', ['detect_stalls'], ['opportunity']],
    ['What does Acme Logistics do?', ['research_account'], ['company']],
    ['Search transcripts for discussions about pricing.', ['search_transcripts'], ['transcript']],
    ['Who are the champions at Foxtrot Group?', ['find_contacts'], ['contact']],
    ['What signal types are most common in the last 7 days?', ['get_active_signals'], ['signal']],
    ['List my top 5 accounts by expected revenue.', ['get_pipeline_overview'], ['company']],
    ['Which deals have a close date in the next 2 weeks?', ['get_pipeline_overview'], ['opportunity']],
    ['What were the most common objections last month?', ['search_transcripts'], ['transcript']],
    ['How many open deals do I have?', ['get_pipeline_overview'], ['opportunity']],
    ['Are there any deals blocked on legal right now?', ['detect_stalls'], ['opportunity']],
    ['Show me contacts I haven\'t engaged in 30 days.', ['find_contacts'], ['contact']],
    ['What\'s the average days-in-stage for Proposal?', ['get_funnel_benchmarks'], ['funnel_benchmark']],
    ['Give me a 1-minute summary of Golf Industries.', ['research_account'], ['company']],
    ['Which signals correlate with won deals?', ['get_active_signals'], ['signal']],
    ['How many meetings did I have this week from CRM?', ['get_pipeline_overview'], ['opportunity']],
    ['What deals were affected by leadership changes recently?', ['get_active_signals'], ['signal']],
    ['Draft a short LinkedIn message to Sarah at Echo Foods.', ['draft_outreach'], ['contact']],
    ['List my territory size and coverage.', ['get_pipeline_overview'], ['company']],
    ['Which accounts have 3+ stakeholders engaged?', ['find_contacts'], ['contact']],
  ]),

  // -- Account (20) — user anchored on a specific company
  ...account([
    ['Why is this account rated high priority?', ['research_account'], ['company']],
    ['Who are the key stakeholders here?', ['find_contacts'], ['contact']],
    ['What signals have been detected on this account recently?', ['get_active_signals'], ['signal']],
    ['What\'s our deal history with this account?', ['research_account'], ['opportunity']],
    ['Summarise the last call with this customer.', ['search_transcripts'], ['transcript']],
    ['Pressure-test my narrative for this account.', ['research_account'], ['company']],
    ['What objections have come up on this account?', ['search_transcripts'], ['transcript']],
    ['Find similar won deals to this one.', ['get_pipeline_overview'], ['opportunity']],
    ['Draft an outreach email to the champion.', ['draft_outreach'], ['contact']],
    ['What discovery questions should I ask next meeting?', ['research_account', 'get_active_signals'], ['signal']],
    ['Why hasn\'t this deal moved in 20 days?', ['get_deal_detail'], ['opportunity']],
    ['Give me the one-liner for this company.', ['research_account'], ['company']],
    ['Who should I multi-thread to next?', ['find_contacts'], ['contact']],
    ['What\'s the current MEDDPICC state?', ['search_transcripts'], ['transcript']],
    ['Draft a meeting brief for this company.', ['draft_meeting_brief'], ['company']],
    ['Are there any competitor mentions on this account?', ['get_active_signals'], ['signal']],
    ['What\'s the churn risk for this account?', ['research_account'], ['company']],
    ['List the open opportunities on this account.', ['get_pipeline_overview'], ['opportunity']],
    ['What value props should I emphasise?', ['research_account'], ['company']],
    ['What\'s the next best action I should take?', ['suggest_next_action'], ['opportunity']],
  ]),

  // -- Sales-frameworks (5) — proves the consult_sales_framework tool +
  // playbook are wired in. Each case asserts on tool-call presence + a
  // framework-typed citation; the rubric checks the response includes the
  // verbatim attribution tag, so we can detect "agent paraphrased away
  // from the framework" regressions.
  ...framework([
    [
      'Help me prep discovery questions for a cold meeting with a multi-site distribution operation.',
      ['consult_sales_framework'],
      ['framework'],
      'account',
      'ae',
      'Did the answer return SPIN-shaped questions explicitly labelled Situation / Problem / Implication / Need-payoff and end with [framework: SPIN] (or equivalent attribution tag)? Generic discovery questions without the SPIN structure or the tag fail.',
    ],
    [
      'Score this deal against MEDDPICC and tell me what is the weakest letter.',
      ['consult_sales_framework', 'get_deal_detail'],
      ['framework'],
      'account',
      'ae',
      'Did the answer name all eight MEDDPICC letters (Metrics, Economic buyer, Decision criteria, Decision process, Paper process, Identify pain, Champion, Competition), call out which letter is weakest as the next focus, and tag with [framework: MEDDPICC]? Skipping any letter or omitting the tag fails.',
    ],
    [
      'The buyer just told me "your price is too high" — how do I respond?',
      ['consult_sales_framework'],
      ['framework'],
      'account',
      'ae',
      'Did the answer walk through the LAER loop in order (Listen, Acknowledge, Explore, Respond), include a specific exploration question before any response, avoid offering a discount as the first move, and tag with [framework: LAER] (or [framework: OBJECTION-HANDLING])? Going straight to a price defence or a discount fails.',
    ],
    [
      'My deal at proposal stage has been stuck for 30 days with no clear blocker — what should I do?',
      ['consult_sales_framework', 'get_deal_detail'],
      ['framework'],
      'account',
      'ae',
      'Did the answer apply the JOLT moves (judge the indecision flavour, offer a specific recommendation, limit / narrow scope, take risk off the table via a pilot or guarantee — explicitly NOT a discount), and tag with [framework: JOLT]? Recommending more information or another follow-up email fails.',
    ],
    [
      'Give me the strategic narrative I should teach my team this quarter — pick the highest-leverage coaching theme.',
      ['consult_sales_framework', 'coaching_themes'],
      ['framework'],
      'portfolio',
      'leader',
      'Did the answer surface a single Challenger commercial insight, tailor it to a specific stakeholder type, propose a take-control move, and tag with [framework: CHALLENGER]? A laundry list of themes or a generic teaching point without a non-obvious reframe fails.',
    ],
  ]),

  // -- Portfolio (20) — CSM / AD scoping their book
  ...portfolio([
    ['What themes are showing up across my accounts this week?', ['search_transcripts'], ['transcript']],
    ['Which of my accounts are at highest churn risk?', ['get_pipeline_overview'], ['company']],
    ['Summarise the top 3 issues across my portfolio.', ['search_transcripts'], ['transcript']],
    ['Which customers mentioned pricing concerns recently?', ['search_transcripts'], ['transcript']],
    ['Draft a weekly digest for my leadership.', ['coaching_themes', 'funnel_divergence'], ['company']],
    ['Which accounts haven\'t been touched in 14+ days?', ['get_pipeline_overview'], ['company']],
    ['Show me the deals my team is struggling with.', ['forecast_risk'], ['opportunity']],
    ['What objections are trending this week?', ['coaching_themes'], ['transcript']],
    ['Which reps are outperforming on conversion?', ['team_patterns'], ['opportunity']],
    ['Where are we losing the most deals?', ['funnel_divergence'], ['funnel_benchmark']],
    ['Which signals were acted on vs ignored?', ['get_active_signals'], ['signal']],
    ['Top 5 at-risk accounts in my book?', ['forecast_risk'], ['opportunity']],
    ['Accounts with fulfillment issues reported in transcripts?', ['search_transcripts'], ['transcript']],
    ['Summarise wins from the last 30 days.', ['forecast_risk'], ['opportunity']],
    ['Rank my accounts by expected revenue.', ['get_pipeline_overview'], ['company']],
    ['Which accounts have escalation risk right now?', ['forecast_risk'], ['company']],
    ['How many deals are stalled in my team?', ['detect_stalls'], ['opportunity']],
    ['Coaching themes for the reps I manage this week?', ['coaching_themes'], ['opportunity']],
    ['Recap the forecast divergence vs last week.', ['forecast_risk', 'funnel_divergence'], ['funnel_benchmark']],
    ['Which accounts grew pipeline this week?', ['get_pipeline_overview'], ['company']],
  ]),
]

function concierge(items: [string, string[], string[]][]): EvalCase[] {
  return items.map(([question, expected_tools, expected_citation_types], i) => ({
    id: `concierge-${i + 1}`,
    category: 'concierge' as const,
    role: 'ae' as const,
    question,
    expected_tools,
    expected_citation_types,
    rubric:
      'Did the answer cite ≥1 source matching expected_citation_types and call at least one expected tool? Invented claims are an automatic fail.',
  }))
}

function account(items: [string, string[], string[]][]): EvalCase[] {
  return items.map(([question, expected_tools, expected_citation_types], i) => ({
    id: `account-${i + 1}`,
    category: 'account' as const,
    role: 'ae' as const,
    question,
    expected_tools,
    expected_citation_types,
    rubric:
      'Did the answer use the active company context and cite sources tied to that company?',
  }))
}

function portfolio(items: [string, string[], string[]][]): EvalCase[] {
  return items.map(([question, expected_tools, expected_citation_types], i) => ({
    id: `portfolio-${i + 1}`,
    category: 'portfolio' as const,
    role: 'csm' as const,
    question,
    expected_tools,
    expected_citation_types,
    rubric:
      'Did the answer synthesise across multiple accounts and cite ≥2 distinct sources?',
  }))
}

/**
 * Sales-framework golden cases. Different shape from the others because each
 * case ships its own rubric — the value of these cases is precisely that
 * they verify framework-specific structure (SPIN labels, MEDDPICC letters,
 * LAER ordering, etc.), not generic citation behaviour. Categories reuse
 * existing buckets to avoid forking the EvalCase union.
 */
function framework(
  items: [
    question: string,
    expected_tools: string[],
    expected_citation_types: string[],
    category: EvalCase['category'],
    role: EvalCase['role'],
    rubric: string,
  ][],
): EvalCase[] {
  return items.map(
    ([question, expected_tools, expected_citation_types, category, role, rubric], i) => ({
      id: `framework-${i + 1}`,
      category,
      role,
      question,
      expected_tools,
      expected_citation_types,
      rubric,
    }),
  )
}
