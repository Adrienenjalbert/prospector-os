import type { AgentType } from './tools'

/**
 * A "skill" is a one-click prefilled prompt that targets a specific agent.
 * Skills replace the empty chat box: every action surface on a page exposes
 * 3-5 skills the user can trigger by clicking, with full pre-filled context.
 */
export interface Skill {
  id: string
  agent: AgentType
  label: string
  prompt: string | ((ctx: SkillContext) => string)
  description?: string
}

export interface SkillContext {
  accountName?: string
  accountId?: string
  dealName?: string
  dealId?: string
}

export function resolveSkillPrompt(skill: Skill, ctx: SkillContext): string {
  return typeof skill.prompt === 'function' ? skill.prompt(ctx) : skill.prompt
}

// ── Inbox skills ─────────────────────────────────────────────────────────

export const INBOX_SKILLS: Skill[] = [
  {
    id: 'inbox-why-hot',
    agent: 'pipeline-coach',
    label: 'Why is my top account hot?',
    // Tool names quoted in the prompt MUST match registered slugs in
    // `tool_registry`. Previously this referenced `active_signals` which
    // doesn't exist — the registered tool is `get_active_signals`. The
    // model would either skip the call or guess (and a guessed tool name
    // = no signal data fetched = no real reason returned).
    prompt: 'Explain why my top-priority account is hot right now. Use explain_score and get_active_signals.',
    description: 'Walk through the score breakdown',
  },
  {
    id: 'inbox-todays-focus',
    agent: 'pipeline-coach',
    label: 'What should I do today?',
    prompt:
      'Look at my open pipeline and active signals. What are the 3 most important actions for me to take today? Be specific: name accounts, name actions, name expected outcome.',
  },
  {
    id: 'inbox-stalls',
    agent: 'pipeline-coach',
    label: 'Show stalled deals',
    prompt: 'Run detect_stalls and tell me which deals are at risk and what to do about each one.',
  },
  {
    id: 'inbox-week-changes',
    agent: 'pipeline-coach',
    label: "What changed this week?",
    prompt:
      'Summarise what shifted in my pipeline this week — new signals, stage changes, propensity shifts. Highlight the most important.',
  },
]

// ── Accounts list skills ─────────────────────────────────────────────────

export const ACCOUNTS_SKILLS: Skill[] = [
  {
    id: 'accounts-best-targets',
    agent: 'pipeline-coach',
    label: 'Pick my 5 best targets',
    prompt:
      'From my accounts, pick the 5 with the best mix of ICP fit and active signals. For each, explain in one sentence why it stands out.',
  },
  {
    id: 'accounts-untouched',
    agent: 'pipeline-coach',
    label: 'Find under-touched accounts',
    prompt:
      'Which Tier A or B accounts have had zero activity in the last 30 days? List them with the most recent contact and a suggested next move.',
  },
  {
    id: 'accounts-coverage-gaps',
    agent: 'pipeline-coach',
    label: 'Show coverage gaps',
    prompt:
      'Which of my high-priority accounts are missing a champion, decision maker, or economic buyer? Use explain_score where helpful.',
  },
]

// ── Account detail skills ────────────────────────────────────────────────

export const ACCOUNT_DETAIL_SKILLS: Skill[] = [
  {
    id: 'account-research',
    agent: 'account-strategist',
    label: 'Research this account',
    prompt: (ctx) =>
      `Research ${ctx.accountName ?? 'this account'} in depth: firmographics, signals, contacts, open deals. End with the most relevant talking point.`,
  },
  {
    id: 'account-decision-makers',
    agent: 'account-strategist',
    label: 'Find decision-makers',
    prompt: (ctx) =>
      `Who are the decision-makers and economic buyers at ${ctx.accountName ?? 'this account'}? List them with title and seniority.`,
  },
  {
    id: 'account-draft-intro',
    agent: 'account-strategist',
    label: 'Draft an intro email',
    prompt: (ctx) =>
      `Draft a cold intro email for ${ctx.accountName ?? 'this account'}. Lead with the strongest active signal. Match the tenant's value props. Include subject line and body.`,
  },
  {
    id: 'account-explain-score',
    agent: 'pipeline-coach',
    label: 'Explain this score',
    prompt: (ctx) =>
      `Use explain_score for ${ctx.accountName ?? 'this account'} and walk through which dimensions are pulling the priority up or down.`,
  },
]

// ── Pipeline skills ──────────────────────────────────────────────────────

export const PIPELINE_SKILLS: Skill[] = [
  {
    id: 'pipeline-stalled',
    agent: 'pipeline-coach',
    label: 'Show stalled deals',
    prompt: 'Run detect_stalls. For each stalled deal, suggest a specific unstall action.',
  },
  {
    id: 'pipeline-month-risk',
    agent: 'pipeline-coach',
    label: "What's at risk this month?",
    prompt:
      'Look at my open pipeline closing this month. Which deals are highest risk and what is the next action to save each one?',
  },
  {
    id: 'pipeline-best-moves',
    agent: 'pipeline-coach',
    label: 'Best next move per deal',
    prompt:
      'For my top 5 open deals by value, use suggest_next_action and tell me the single best move for each.',
  },
]

// ── Deal detail skills ───────────────────────────────────────────────────

export const DEAL_DETAIL_SKILLS: Skill[] = [
  {
    id: 'deal-health',
    agent: 'pipeline-coach',
    label: 'Assess this deal',
    prompt: (ctx) =>
      `Use get_deal_detail for the deal "${ctx.dealName ?? 'this deal'}". Tell me whether it's on track, at risk, or stalled, and why.`,
  },
  {
    id: 'deal-next-action',
    agent: 'pipeline-coach',
    label: 'What should I do next?',
    prompt: (ctx) =>
      `Use suggest_next_action for "${ctx.dealName ?? 'this deal'}". Give me a single concrete next step with WHO, WHAT, and WHEN.`,
  },
  {
    id: 'deal-meeting-brief',
    agent: 'account-strategist',
    label: 'Build a meeting brief',
    prompt: (ctx) =>
      `Build a pre-call brief for ${ctx.accountName ?? 'this account'} relevant to the open deal "${ctx.dealName ?? ''}". Include account snapshot, recent signals, and the contacts on the deal.`,
  },
]

// ── Forecast skills ──────────────────────────────────────────────────────

export const FORECAST_SKILLS: Skill[] = [
  {
    id: 'forecast-risk',
    agent: 'leadership-lens',
    label: "Where's the risk?",
    prompt:
      'Run forecast_risk for the current month. Tell me the at-risk deal value, the worst few deals, and where they are concentrated.',
  },
  {
    id: 'forecast-divergence',
    agent: 'leadership-lens',
    label: 'Funnel bottlenecks',
    prompt:
      'Run funnel_divergence with a 5pt threshold. Which stage is hurting us the most across the team?',
  },
  {
    id: 'forecast-team-patterns',
    agent: 'leadership-lens',
    label: 'How is the team performing?',
    prompt: 'Run team_patterns over the last 90 days. Who is on/off pace and where do you suggest coaching?',
  },
]

// ── Signals skills ───────────────────────────────────────────────────────

export const SIGNALS_SKILLS: Skill[] = [
  {
    id: 'signals-most-actionable',
    agent: 'account-strategist',
    label: 'Most actionable signals',
    prompt:
      'Look at recent signals across my accounts. Which 3 are most actionable right now? For each, name the account, the signal, and a concrete first move.',
  },
  {
    id: 'signals-account-themes',
    agent: 'leadership-lens',
    label: 'Theme this week',
    prompt:
      'What themes are showing up across the signals this week (industry, intent type, geography)? Surface the top theme.',
  },
]

// ── Ontology browser skills (≤3 each) ────────────────────────────────────
// MISSION UX rule 6: every list page has suggested action chips.
// Keep at exactly 3 to honour the signal-over-noise rule.

export const OBJECTS_COMPANIES_SKILLS: Skill[] = [
  {
    id: 'objects-companies-top',
    agent: 'pipeline-coach',
    label: 'Pick my 3 best targets',
    prompt:
      'From the companies list, pick the 3 with the best mix of ICP fit and active signals. For each, explain in one sentence why.',
  },
  {
    id: 'objects-companies-untouched',
    agent: 'pipeline-coach',
    label: 'Find under-touched accounts',
    prompt:
      'Which Tier A or B companies have had zero activity in the last 30 days? List with last-touch and a suggested next move.',
  },
  {
    id: 'objects-companies-coverage',
    agent: 'pipeline-coach',
    label: 'Show coverage gaps',
    prompt:
      'Which high-priority companies are missing a champion, decision-maker, or economic buyer? Use explain_score where helpful.',
  },
]

export const OBJECTS_DEALS_SKILLS: Skill[] = [
  {
    id: 'objects-deals-stalled',
    agent: 'pipeline-coach',
    label: 'Show stalled deals',
    prompt: 'Run detect_stalls. For each, suggest a specific unstall action.',
  },
  {
    id: 'objects-deals-month-risk',
    agent: 'pipeline-coach',
    label: "What's at risk this month?",
    prompt:
      'Which open deals closing this month are highest risk? Give the next save action for each.',
  },
  {
    id: 'objects-deals-best-moves',
    agent: 'pipeline-coach',
    label: 'Best next move per top deal',
    prompt:
      'For my top 3 open deals by value, use suggest_next_action and tell me the single best move for each.',
  },
]

export const OBJECTS_CONTACTS_SKILLS: Skill[] = [
  {
    id: 'objects-contacts-multithread',
    agent: 'account-strategist',
    label: 'Where do I need to multi-thread?',
    prompt:
      'Across my open deals, which accounts have only one engaged contact? List the deal, the contact, and who I should add next.',
  },
  {
    id: 'objects-contacts-c-level',
    agent: 'account-strategist',
    label: 'Find C-level coverage',
    prompt:
      'Which of my Tier A accounts lack any C-level or VP contact? List them with the most senior contact I currently have.',
  },
  {
    id: 'objects-contacts-stale',
    agent: 'account-strategist',
    label: 'Stale champions',
    prompt:
      'List champions or executives I have not touched in 30+ days, ordered by account priority.',
  },
]

export const OBJECTS_SIGNALS_SKILLS: Skill[] = [
  {
    id: 'objects-signals-top',
    agent: 'account-strategist',
    label: 'Most actionable signals',
    prompt:
      'Look at recent signals. Which 3 are most actionable right now? Name the account, signal, and concrete first move.',
  },
  {
    id: 'objects-signals-themes',
    agent: 'leadership-lens',
    label: 'Theme this week',
    prompt:
      'What themes are showing up across signals this week (industry, intent, geography)? Surface the top theme.',
  },
  {
    id: 'objects-signals-ignored',
    agent: 'pipeline-coach',
    label: 'Find ignored hot signals',
    prompt:
      'Which high-relevance signals from the last 7 days do not show any follow-up activity? List the top 3.',
  },
]

export const OBJECTS_TRANSCRIPTS_SKILLS: Skill[] = [
  {
    id: 'objects-transcripts-objections',
    agent: 'account-strategist',
    label: 'Common objections this month',
    prompt:
      'Search transcripts from the last 30 days. What are the top 3 objections coming up across calls?',
  },
  {
    id: 'objects-transcripts-pricing',
    agent: 'account-strategist',
    label: 'Pricing concerns',
    prompt:
      'Find recent transcripts that mention pricing concerns. List the company, the concrete concern, and who raised it.',
  },
  {
    id: 'objects-transcripts-meddpicc',
    agent: 'pipeline-coach',
    label: 'MEDDPICC weaknesses',
    prompt:
      'For my top 3 open deals, search transcripts for MEDDPICC signal. Where are we weakest (Metrics, Economic buyer, Champion, etc.)?',
  },
]

// ── Settings & admin skills ──────────────────────────────────────────────
//
// Previously these routes returned `[]` from `getSkillsForPath`, so the
// "Ask AI about this page" header button silently fell back to opening
// the empty chat sidebar. That violated the UX gate "every empty state
// is an opportunity state". Settings and admin pages are exactly where
// reps need agent help (re-tuning ICP, reading their own ROI numbers).

export const SETTINGS_SKILLS: Skill[] = [
  {
    id: 'settings-tone',
    agent: 'onboarding-coach',
    label: 'Tune my outreach tone',
    prompt:
      'I want to change how the agent drafts emails for me. Walk me through my current outreach tone, comm style, and alert frequency, and propose changes if my recent thumbs-up history suggests they would help.',
  },
  {
    id: 'settings-explain-config',
    agent: 'onboarding-coach',
    label: 'What does each setting do?',
    prompt:
      'Explain in plain English what each preference on this page controls and how it changes the agent behaviour. Cover alert_frequency, comm_style, outreach_tone, focus_stage.',
  },
  {
    id: 'settings-skip-baseline',
    agent: 'onboarding-coach',
    label: 'Help me complete onboarding',
    prompt:
      'Check my onboarding state — baseline survey, CRM connection, ICP config, funnel config — and tell me which steps are still incomplete and how to finish them.',
  },
]

export const ADMIN_ROI_SKILLS: Skill[] = [
  {
    id: 'admin-roi-explain',
    agent: 'leadership-lens',
    label: 'Explain this ROI number',
    prompt:
      "Walk me through how the time-saved and influenced-ARR numbers on this page are computed. Which `agent_events` and `outcome_events` feed each metric? What's the holdout cohort lift saying right now, and is it statistically meaningful?",
  },
  {
    id: 'admin-roi-low',
    agent: 'leadership-lens',
    label: 'Why is influenced ARR low?',
    prompt:
      'Look at the influenced ARR for this quarter. If it is below target, what are the top 3 reasons (low adoption, low cited-answer rate, holdout suppressed too much, attribution confidence too low)? Cite the events table.',
  },
]

export const ADMIN_ADAPTATION_SKILLS: Skill[] = [
  {
    id: 'admin-adaptation-summary',
    agent: 'leadership-lens',
    label: 'What has the OS learned this month?',
    prompt:
      'Summarise the calibration_ledger entries for the last 30 days for this tenant. Group by change_type. For each, name the observed lift and whether it was approved or auto-applied.',
  },
  {
    id: 'admin-adaptation-pending',
    agent: 'leadership-lens',
    label: 'Show pending proposals',
    prompt:
      'List every calibration proposal in status=pending. For each, show the proposed change, the AUC lift, the sample size, and whether shouldAutoApply would have approved it.',
  },
]

export const ADMIN_CONFIG_SKILLS: Skill[] = [
  {
    id: 'admin-config-icp',
    agent: 'onboarding-coach',
    label: 'Re-derive ICP from won deals',
    prompt:
      'Run analyze_pipeline_history and analyze_account_distribution for this tenant, then propose_icp_config. Compare the proposal against the current ICP — explain the deltas and whether you recommend applying.',
  },
  {
    id: 'admin-config-funnel',
    agent: 'onboarding-coach',
    label: 'Re-derive funnel benchmarks',
    prompt:
      'Run analyze_pipeline_history then propose_funnel_config. Compare the proposed median-days against the current stall thresholds and flag any that look mis-tuned.',
  },
]

// ── Skill registry by route prefix ───────────────────────────────────────

export function getSkillsForPath(pathname: string): Skill[] {
  if (pathname === '/inbox' || pathname.startsWith('/inbox/')) return INBOX_SKILLS
  if (pathname.startsWith('/accounts/') && pathname !== '/accounts') return ACCOUNT_DETAIL_SKILLS
  if (pathname === '/accounts') return ACCOUNTS_SKILLS
  if (pathname.startsWith('/pipeline/') && pathname !== '/pipeline') return DEAL_DETAIL_SKILLS
  if (pathname === '/pipeline') return PIPELINE_SKILLS
  if (pathname.startsWith('/analytics/forecast')) return FORECAST_SKILLS
  if (pathname === '/signals' || pathname.startsWith('/signals/')) return SIGNALS_SKILLS
  // Ontology browser routes
  if (pathname === '/objects/companies' || pathname.startsWith('/objects/companies/'))
    return OBJECTS_COMPANIES_SKILLS
  if (pathname === '/objects/deals' || pathname.startsWith('/objects/deals/'))
    return OBJECTS_DEALS_SKILLS
  if (pathname === '/objects/contacts') return OBJECTS_CONTACTS_SKILLS
  if (pathname === '/objects/signals') return OBJECTS_SIGNALS_SKILLS
  if (pathname === '/objects/transcripts') return OBJECTS_TRANSCRIPTS_SKILLS
  // Settings & admin (most-specific match first)
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return SETTINGS_SKILLS
  if (pathname.startsWith('/admin/roi')) return ADMIN_ROI_SKILLS
  if (pathname.startsWith('/admin/adaptation')) return ADMIN_ADAPTATION_SKILLS
  if (pathname.startsWith('/admin/config')) return ADMIN_CONFIG_SKILLS
  if (pathname.startsWith('/admin/calibration')) return ADMIN_ADAPTATION_SKILLS
  if (pathname === '/onboarding' || pathname.startsWith('/onboarding/')) {
    return [
      {
        id: 'onboarding-coach-help',
        agent: 'onboarding-coach',
        label: 'Walk me through this step',
        prompt:
          'I am on the onboarding wizard. Explain what this step does, why it matters, and what to do next. If you have access to my tenant data, refer to it.',
      },
    ]
  }
  return []
}
