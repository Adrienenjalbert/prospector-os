'use client'

import { MessageSquare } from 'lucide-react'

interface SuggestedPromptsProps {
  currentPage: string
  accountName?: string
  dealName?: string
  onSelectPrompt: (prompt: string) => void
}

const INBOX_PROMPTS = [
  'Who should I call first today and why?',
  'Show me my funnel health compared to the team',
  'What new signals appeared in the last 48 hours?',
  'Draft a re-engagement plan for my stalled deals',
]

const PIPELINE_PROMPTS = [
  'Which deals are most at risk right now?',
  'What can I do to accelerate my Proposal stage deals?',
  'Compare my pipeline velocity to the team benchmark',
  'What deals should I focus on to hit my target?',
]

const ACCOUNTS_PROMPTS = [
  'Which accounts have the highest expansion potential?',
  'Show me accounts I haven\'t contacted in over 30 days',
  'Which prospects should I reach out to this week?',
  'Find companies similar to my top-performing accounts',
]

const SIGNALS_PROMPTS = [
  'Summarize the most important signals from this week',
  'Which signals should I act on immediately?',
  'Are there any patterns in recent hiring signals?',
  'What signals should I be watching for?',
]

function getAccountPrompts(name: string): string[] {
  return [
    `Research ${name} in detail — recent news, hiring, signals`,
    `Draft an outreach email to the primary contact at ${name}`,
    `Find decision makers at ${name} in Operations, HR, and Procurement`,
    `What is the deal strategy for ${name}? Risks and next steps?`,
    `Compare ${name} to similar won deals — what made them successful?`,
  ]
}

function getDealPrompts(dealName: string, accountName: string): string[] {
  return [
    `Analyze the health of "${dealName}" — what are the risks?`,
    `What similar deals have we won? What made the difference?`,
    `Draft a follow-up email to re-engage on "${dealName}"`,
    `Who else should I involve in the ${accountName} deal?`,
  ]
}

function getPromptsForPage(page: string, accountName?: string, dealName?: string): string[] {
  if (accountName && page.includes('accounts/')) {
    return getAccountPrompts(accountName)
  }
  if (dealName && accountName && page.includes('pipeline/')) {
    return getDealPrompts(dealName, accountName)
  }
  if (page.includes('pipeline')) return PIPELINE_PROMPTS
  if (page.includes('accounts')) return ACCOUNTS_PROMPTS
  if (page.includes('signals')) return SIGNALS_PROMPTS
  if (page.includes('analytics')) return PIPELINE_PROMPTS
  return INBOX_PROMPTS
}

export function SuggestedPrompts({ currentPage, accountName, dealName, onSelectPrompt }: SuggestedPromptsProps) {
  const prompts = getPromptsForPage(currentPage, accountName, dealName)

  return (
    <div className="space-y-2 px-1">
      <p className="text-xs font-medium text-zinc-500">Suggested</p>
      <div className="flex flex-col gap-1.5">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onSelectPrompt(prompt)}
            className="flex items-start gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/50 px-3 py-2.5 text-left text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-800/50 hover:text-zinc-200"
          >
            <MessageSquare className="mt-0.5 size-3 shrink-0 text-zinc-600" />
            <span className="leading-relaxed">{prompt}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
