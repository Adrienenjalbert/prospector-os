'use client'

import { useTransition } from 'react'
import { MessageCircle, PenSquare, CheckCircle2 } from 'lucide-react'

import { recordActionInvoked } from '@/app/actions/implicit-feedback'
import { cn } from '@/lib/utils'
import {
  buildClickPrompt,
  parseNextSteps,
  type ActionKind,
  type ParsedAction,
} from './next-steps-parser'

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
 * Multi-choice click-to-prompt buttons under every assistant message.
 *
 * - ASK fires the prompt back into the chat (sends as user message).
 * - DRAFT fires a "draft this for me" prompt back into the chat.
 * - DO is the real-world action chip. Pre-this-change DO was a disabled
 *   button: no click handler, no telemetry, no follow-through. The
 *   audit flagged this as a BLOCKER because the agent prompt + the
 *   `writeApprovalGate` middleware both ASSUMED the [DO] chip was the
 *   approval surface for CRM mutations — but the chip never fired
 *   anything, so the loop was theatre. Now [DO] is interactive: a
 *   click logs `action_invoked` (so attribution + the tool bandit can
 *   learn from real-world action) and opens the chat with a
 *   confirmation prompt the agent can either re-execute (with an
 *   approval token) or convert into a CRM write.
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

    // The DO chip's confirmation framing is intentionally instructive
    // ("re-invoke the relevant tool with the approval handshake") so
    // the agent reading the next turn knows it's the approval surface,
    // not a fresh request. See `next-steps-parser.ts#buildClickPrompt`.
    window.dispatchEvent(
      new CustomEvent('prospector:open-chat', {
        detail: {
          prompt: buildClickPrompt(a),
          activeUrn: activeUrn ?? undefined,
        },
      }),
    )
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5 pl-11">
      {actions.map((a, i) => {
        const Icon = ICON[a.kind]
        return (
          <button
            key={`${a.kind}:${i}`}
            type="button"
            onClick={() => onClick(a)}
            className={cn(
              'inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
              STYLE[a.kind],
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
