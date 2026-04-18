'use client'

import { useTransition } from 'react'
import { PenSquare, Sparkles, Target, FileText, History, Search } from 'lucide-react'

import { recordActionInvoked } from '@/app/actions/implicit-feedback'

type ObjectType = 'company' | 'deal' | 'contact'

interface ActionSpec {
  id: string
  label: string
  prompt: (label: string) => string
  icon: React.ElementType
  appliesTo: ObjectType[]
}

const ACTIONS: ActionSpec[] = [
  {
    id: 'generate_brief',
    label: 'Generate pre-call brief',
    prompt: (l) => `Generate a pre-call brief for my next meeting with ${l}.`,
    icon: FileText,
    appliesTo: ['company', 'deal'],
  },
  {
    id: 'draft_outreach',
    label: 'Draft outreach email',
    prompt: (l) => `Draft a personalised outreach email to ${l} based on recent signals.`,
    icon: PenSquare,
    appliesTo: ['company', 'contact'],
  },
  {
    id: 'diagnose_deal',
    label: 'Diagnose this deal',
    prompt: (l) => `Diagnose the ${l} deal. Where is it stuck? What should I do next?`,
    icon: Target,
    appliesTo: ['deal'],
  },
  {
    id: 'similar_wins',
    label: 'Find similar won deals',
    prompt: (l) => `Find won deals similar to ${l} and summarise why they closed.`,
    icon: History,
    appliesTo: ['company', 'deal'],
  },
  {
    id: 'theme_summary',
    label: 'Summarise recent activity',
    prompt: (l) => `Summarise everything that has happened on ${l} in the last 30 days.`,
    icon: Sparkles,
    appliesTo: ['company', 'deal', 'contact'],
  },
  {
    id: 'pressure_test',
    label: 'Pressure-test my narrative',
    prompt: (l) => `Pressure-test my QBR narrative for ${l}. Play the sceptical buyer and tell me what I'm missing.`,
    icon: Search,
    appliesTo: ['company'],
  },
]

export interface ActionPanelProps {
  subjectUrn: string
  subjectLabel: string
  objectType: ObjectType
}

/**
 * The Action Panel sits on every ontology detail page and turns "objects
 * into outcomes": each button fires an agent run with this object loaded as
 * `activeUrn` and an opinionated starter prompt. Every click is logged as
 * `action_invoked` so attribution (Phase 8) and the tool bandit (Phase 7c)
 * can learn which actions drive outcomes per tenant.
 */
export function ActionPanel({ subjectUrn, subjectLabel, objectType }: ActionPanelProps) {
  const [, start] = useTransition()
  // MISSION cap: ≤ 3 actions per surface. Pre-this-change a company
  // page surfaced 4 applicable actions and a deal page surfaced 4 —
  // choice paralysis is the single biggest UX killer the audit flagged.
  // The first 3 are kept (declared in highest-impact order in `ACTIONS`).
  const applicable = ACTIONS.filter((a) => a.appliesTo.includes(objectType)).slice(0, 3)

  const onAction = (action: ActionSpec) => {
    start(() => {
      void recordActionInvoked(null, action.id, subjectUrn)
    })

    window.dispatchEvent(
      new CustomEvent('prospector:open-chat', {
        detail: {
          prompt: action.prompt(subjectLabel),
          activeUrn: subjectUrn,
        },
      }),
    )
  }

  return (
    <aside className="sticky top-4 h-fit rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-zinc-100">Actions</h3>
        <p className="text-xs text-zinc-500">
          Each action runs the agent with this object pre-loaded.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {applicable.map((a) => {
          const Icon = a.icon
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onAction(a)}
              className="flex items-center gap-2 rounded-md border border-zinc-700/60 bg-zinc-950/40 px-3 py-2 text-left text-sm text-zinc-100 hover:border-zinc-600 hover:bg-zinc-800/60"
            >
              <Icon className="size-4 text-violet-300" />
              {a.label}
            </button>
          )
        })}
      </div>
      <p className="mt-3 font-mono text-[10px] leading-relaxed text-zinc-600 break-all">
        {subjectUrn}
      </p>
    </aside>
  )
}
