'use client'

import { useState, useTransition } from 'react'
import { Loader2, PenSquare, Sparkles, Target, FileText, History, Search } from 'lucide-react'

import { recordActionInvoked } from '@/app/actions/implicit-feedback'
import {
  nativeDraftOutreach,
  nativeDiagnoseDeal,
  type DraftOutreachResult,
  type DiagnoseDealResult,
} from '@/app/actions/native-actions'
import { ActionResultCard } from './action-result-card'

type ObjectType = 'company' | 'deal' | 'contact'

interface ActionSpec {
  id: string
  label: string
  prompt: (label: string) => string
  icon: React.ElementType
  appliesTo: ObjectType[]
  /**
   * Sprint 5 (Mission–Reality Gap roadmap) — actions flagged `native`
   * render an inline `<ActionResultCard />` instead of opening the
   * chat sidebar. Each native action has a matching server action
   * in `apps/web/src/app/actions/native-actions.ts`.
   */
  native?: boolean
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
    native: true,
  },
  {
    id: 'diagnose_deal',
    label: 'Diagnose this deal',
    prompt: (l) => `Diagnose the ${l} deal. Where is it stuck? What should I do next?`,
    icon: Target,
    appliesTo: ['deal'],
    native: true,
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
 * into outcomes". Sprint 5 split the actions into two flavours:
 *   - `native: true` — runs a server action inline and renders an
 *     `<ActionResultCard />` underneath the buttons. The rep stays on
 *     the page; one click drafts; the second click pushes to CRM.
 *   - default — opens the chat sidebar with a starter prompt (the
 *     pre-Sprint-5 behaviour, preserved for the actions not yet
 *     converted).
 *
 * Every click is logged as `action_invoked` so attribution + the tool
 * bandit can learn which actions drive outcomes per tenant.
 */
type ActiveResult =
  | { kind: 'draft_outreach'; result: DraftOutreachResult }
  | { kind: 'diagnose_deal'; result: DiagnoseDealResult }

export function ActionPanel({ subjectUrn, subjectLabel, objectType }: ActionPanelProps) {
  const [, start] = useTransition()
  const [pendingNative, setPendingNative] = useState<string | null>(null)
  const [activeResult, setActiveResult] = useState<ActiveResult | null>(null)
  const [nativeError, setNativeError] = useState<string | null>(null)

  // MISSION cap: ≤ 3 actions per surface. Pre-this-change a company
  // page surfaced 4 applicable actions and a deal page surfaced 4 —
  // choice paralysis is the single biggest UX killer the audit flagged.
  // The first 3 are kept (declared in highest-impact order in `ACTIONS`).
  const applicable = ACTIONS.filter((a) => a.appliesTo.includes(objectType)).slice(0, 3)

  const dispatchToChat = (action: ActionSpec, syntheticInteractionId: string) => {
    window.dispatchEvent(
      new CustomEvent('prospector:open-chat', {
        detail: {
          prompt: action.prompt(subjectLabel),
          activeUrn: subjectUrn,
          precedingActionUrn: syntheticInteractionId,
        },
      }),
    )
  }

  const onAction = async (action: ActionSpec) => {
    // Synthesise a stable client-side interaction id (urn:rev:action:...).
    // Format: urn:rev:action:{actionId}:{day}:{rand} — the day scopes
    // dedup to "one click per action per day" for ROI accounting.
    const day = new Date().toISOString().slice(0, 10)
    const rand = Math.random().toString(36).slice(2, 8)
    const syntheticInteractionId = `urn:rev:action:${action.id}:${day}:${rand}`

    start(() => {
      void recordActionInvoked(syntheticInteractionId, action.id, subjectUrn)
    })

    if (!action.native) {
      dispatchToChat(action, syntheticInteractionId)
      return
    }

    // Native flow — run the server action, render the structured
    // result inline. The card stays open until the rep dismisses it
    // (X) or runs another native action.
    setNativeError(null)
    setActiveResult(null)
    setPendingNative(action.id)

    try {
      if (action.id === 'draft_outreach') {
        const result = await nativeDraftOutreach(subjectUrn, subjectLabel)
        if (!result.ok || !result.draft) {
          setNativeError(result.error ?? 'Generation failed')
        } else {
          setActiveResult({ kind: 'draft_outreach', result })
        }
      } else if (action.id === 'diagnose_deal') {
        const result = await nativeDiagnoseDeal(subjectUrn, subjectLabel)
        if (!result.ok || !result.diagnosis) {
          setNativeError(result.error ?? 'Generation failed')
        } else {
          setActiveResult({ kind: 'diagnose_deal', result })
        }
      }
    } catch (err) {
      setNativeError(err instanceof Error ? err.message : 'Unexpected error')
    } finally {
      setPendingNative(null)
    }
  }

  const onEditInChat = () => {
    if (!activeResult) return
    const action = ACTIONS.find((a) => a.id === activeResult.kind)
    if (!action) return
    const day = new Date().toISOString().slice(0, 10)
    const rand = Math.random().toString(36).slice(2, 8)
    const syntheticInteractionId = `urn:rev:action:${action.id}_chat:${day}:${rand}`
    dispatchToChat(action, syntheticInteractionId)
  }

  return (
    <aside className="sticky top-4 h-fit rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-zinc-100">Actions</h3>
        <p className="text-xs text-zinc-500">
          Native actions render the result here. Others open the chat sidebar.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {applicable.map((a) => {
          const Icon = a.icon
          const isPending = pendingNative === a.id
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onAction(a)}
              disabled={pendingNative !== null}
              className="flex items-center gap-2 rounded-md border border-zinc-700/60 bg-zinc-950/40 px-3 py-2 text-left text-sm text-zinc-100 hover:border-zinc-600 hover:bg-zinc-800/60 disabled:opacity-60"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin text-violet-300" />
              ) : (
                <Icon className="size-4 text-violet-300" />
              )}
              {a.label}
            </button>
          )
        })}
      </div>

      {nativeError && (
        <p className="mt-3 rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
          {nativeError}
        </p>
      )}

      {activeResult?.kind === 'draft_outreach' && activeResult.result.draft && (
        <ActionResultCard
          kind="draft_outreach"
          subjectUrn={subjectUrn}
          interactionId={activeResult.result.interactionId}
          draft={activeResult.result.draft}
          citations={activeResult.result.citations}
          onEditInChat={onEditInChat}
          onDismiss={() => setActiveResult(null)}
        />
      )}

      {activeResult?.kind === 'diagnose_deal' && activeResult.result.diagnosis && (
        <ActionResultCard
          kind="diagnose_deal"
          subjectUrn={subjectUrn}
          interactionId={activeResult.result.interactionId}
          diagnosis={activeResult.result.diagnosis}
          citations={activeResult.result.citations}
          onEditInChat={onEditInChat}
          onDismiss={() => setActiveResult(null)}
        />
      )}

      <p className="mt-3 font-mono text-[10px] leading-relaxed text-zinc-600 break-all">
        {subjectUrn}
      </p>
    </aside>
  )
}
