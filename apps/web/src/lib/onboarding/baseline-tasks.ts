/**
 * Static metadata for the onboarding baseline survey.
 *
 * Lives in `lib/onboarding/` (not in `app/actions/`) because Next.js
 * server-action modules ("use server") are only allowed to export async
 * functions. The constant + the response shape are imported by both the
 * server action (`app/actions/baseline-survey.ts`) and the client form
 * (`app/(dashboard)/onboarding/baseline/baseline-form.tsx`).
 */

export interface BaselineSurveyResponse {
  pre_call_brief: number
  outreach_draft: number
  account_research: number
  qbr_prep: number
  portfolio_review: number
  crm_note: number
}

/**
 * The six tasks anchor our time-saved ROI maths. Copy kept plain-English
 * so every rep knows what to answer.
 */
export const BASELINE_TASKS: {
  key: keyof BaselineSurveyResponse
  label: string
  help: string
}[] = [
  {
    key: 'pre_call_brief',
    label: 'Preparing a pre-call brief (research, key points, questions)',
    help: 'From opening the account to being ready to join the call.',
  },
  {
    key: 'outreach_draft',
    label: 'Drafting one personalised outreach email',
    help: 'Research, write, proofread, copy into HubSpot.',
  },
  {
    key: 'account_research',
    label: 'Researching a new account before first call',
    help: 'Website, news, LinkedIn, past deals, CRM history.',
  },
  {
    key: 'qbr_prep',
    label: 'Preparing one QBR or executive review',
    help: 'Slides, data pulls, narrative, stakeholder map.',
  },
  {
    key: 'portfolio_review',
    label: 'Weekly portfolio review (all your accounts, find risks)',
    help: 'Tableau pulls, note-skimming, prioritising who to touch.',
  },
  {
    key: 'crm_note',
    label: 'Writing a post-call CRM note with MEDDPICC / next steps',
    help: 'From transcript or memory to saved note in CRM.',
  },
]
