'use client'

import { useTransition } from 'react'
import { MessageCircle, PenSquare, CheckCircle2 } from 'lucide-react'

import { recordActionInvoked } from '@/app/actions/implicit-feedback'
import { cn } from '@/lib/utils'

type ActionKind = 'ASK' | 'DRAFT' | 'DO'

interface ParsedAction {
  kind: ActionKind
  text: string
}

export interface SuggestedActionsProps {
  /** The full assistant message text. We parse the `## Next Steps` section. */
  content: string
  /** Used to log action_invoked events for attribution + tool bandit. */
  interactionId: string | null
  /** Used to file the `action_invoked` event against the right object. */
  activeUrn?: string | null
  isStreaming?: boolean
}

const ICON: Record<ActionKind, React.ElementType> = {
  ASK: MessageCircle,
  DRAFT: PenSquare,
  DO: CheckCircle2,
}

const STYLE: Record<ActionKind, string> = {
  ASK: 'border-sky-700/60 bg-sky-950/30 text-sky-200 hover:bg-sky-900/40',
  DRAFT: 'border-violet-700/60 bg-violet-950/30 text-violet-200 hover:bg-violet-900/40',
  DO: 'border-emerald-700/60 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40',
}

/**
 * Parses the `## Next Steps` section of an assistant message into typed
 * actions. The agent prompt requires this section in a strict format
 * (see `commonBehaviourRules` in `_shared.ts`):
 *
 *   ## Next Steps
 *   - [ASK] What signals fired this week?
 *   - [DRAFT] Email to champion
 *   - [DO] Call John Smith Tuesday
 *
 * Tolerant of small formatting drift: '##' / '###' / '**Next Steps**',
 * with or without the brackets, with or without the dash.
 */
function parseNextSteps(content: string): ParsedAction[] {
  if (!content) return []

  // Find the Next Steps heading. Accept a few variants.
  const headingRegex = /(?:^|\n)\s*(?:#{2,3}|\*\*)\s*Next Steps\s*\**\s*\n/i
  const match = headingRegex.exec(content)
  if (!match) return []

  const after = content.slice(match.index + match[0].length)
  const lines = after.split('\n')

  const actions: ParsedAction[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (actions.length > 0) break
      continue
    }
    // Stop at next heading.
    if (line.startsWith('#') || line.startsWith('**')) break

    // Match: optional "- ", then [TAG], then text. Also accept "1. ", "* ".
    const itemMatch = /^(?:[-*]|\d+\.)\s*\[(ASK|DRAFT|DO)\]\s+(.+)$/i.exec(line)
    if (itemMatch) {
      const kind = itemMatch[1].toUpperCase() as ActionKind
      const text = itemMatch[2].trim()
      if (text) actions.push({ kind, text })
      continue
    }

    // Tolerant fallback: bullet without tag → treat as ASK.
    const fallback = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(line)
    if (fallback && fallback[1].length > 0) {
      actions.push({ kind: 'ASK', text: fallback[1].trim() })
    }
  }

  // Hard cap at 3 — choice paralysis kills adoption. If the model returned
  // more, we take the first three (assumed to be highest-priority).
  return actions.slice(0, 3)
}

/**
 * Multi-choice click-to-prompt buttons under every assistant message.
 *
 * - ASK fires the prompt back into the chat (sends as user message).
 * - DRAFT fires a "draft this for me" prompt back into the chat.
 * - DO is non-clickable (displayed as a checklist item) — it represents
 *   real-world action outside the chat.
 *
 * Every click logs `action_invoked` so the attribution engine and tool
 * bandit can learn what actions actually drive outcomes per tenant.
 */
export function SuggestedActions({
  content,
  interactionId,
  activeUrn,
  isStreaming,
}: SuggestedActionsProps) {
  const [, startLog] = useTransition()
  if (isStreaming) return null

  const actions = parseNextSteps(content)
  if (actions.length === 0) return null

  const onClick = (a: ParsedAction) => {
    startLog(() => {
      void recordActionInvoked(interactionId, `suggested_${a.kind.toLowerCase()}`, activeUrn ?? null)
    })

    if (a.kind === 'DO') return // Display-only

    const prompt = a.kind === 'DRAFT' ? `Draft this for me: ${a.text}` : a.text

    window.dispatchEvent(
      new CustomEvent('prospector:open-chat', {
        detail: {
          prompt,
          activeUrn: activeUrn ?? undefined,
        },
      }),
    )
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5 pl-11">
      {actions.map((a, i) => {
        const Icon = ICON[a.kind]
        const interactive = a.kind !== 'DO'
        return (
          <button
            key={`${a.kind}:${i}`}
            type="button"
            disabled={!interactive}
            onClick={() => onClick(a)}
            className={cn(
              'inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
              STYLE[a.kind],
              !interactive && 'cursor-default opacity-80',
            )}
            title={a.text}
          >
            <Icon className="size-3 shrink-0" />
            <span className="truncate">{a.text}</span>
          </button>
        )
      })}
    </div>
  )
}
