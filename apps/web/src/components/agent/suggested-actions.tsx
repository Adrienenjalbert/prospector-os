'use client'

import { useState, useTransition } from 'react'
import { MessageCircle, PenSquare, CheckCircle2, Loader2 } from 'lucide-react'

import { recordActionInvoked } from '@/app/actions/implicit-feedback'
import { createSupabaseBrowser } from '@/lib/supabase/client'
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
/**
 * Per-chip state for the [DO] approval call. Keyed by the action's
 * pending_id (when present) so two chips with different pending ids
 * track independently.
 */
type ApprovalState =
  | { kind: 'idle' }
  | { kind: 'approving' }
  | { kind: 'approved'; externalRecordId: string | null }
  | { kind: 'failed'; error: string }

export function SuggestedActions({
  content,
  interactionId,
  activeUrn,
  isStreaming,
}: SuggestedActionsProps) {
  const [, startLog] = useTransition()
  const [approvals, setApprovals] = useState<Record<string, ApprovalState>>({})
  if (isStreaming) return null

  const actions = parseNextSteps(content)
  if (actions.length === 0) return null

  async function approveStaged(pendingId: string) {
    setApprovals((prev) => ({ ...prev, [pendingId]: { kind: 'approving' } }))
    try {
      const supabase = createSupabaseBrowser()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        setApprovals((prev) => ({
          ...prev,
          [pendingId]: { kind: 'failed', error: 'Sign in expired. Reload and try again.' },
        }))
        return
      }
      const res = await fetch('/api/agent/approve', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pending_id: pendingId }),
      })
      const body = (await res.json()) as {
        status?: string
        error?: string
        external_record_id?: string | null
      }
      if (!res.ok || body.status !== 'executed') {
        setApprovals((prev) => ({
          ...prev,
          [pendingId]: {
            kind: 'failed',
            error: body.error ?? `Approval failed (${res.status})`,
          },
        }))
        return
      }
      setApprovals((prev) => ({
        ...prev,
        [pendingId]: {
          kind: 'approved',
          externalRecordId: body.external_record_id ?? null,
        },
      }))
    } catch (err) {
      setApprovals((prev) => ({
        ...prev,
        [pendingId]: {
          kind: 'failed',
          error: err instanceof Error ? err.message : 'Approval threw',
        },
      }))
    }
  }

  const onClick = (a: ParsedAction) => {
    startLog(() => {
      void recordActionInvoked(
        interactionId,
        `suggested_${a.kind.toLowerCase()}`,
        activeUrn ?? null,
      )
    })

    // Phase 3 T3.1 — when [DO] carries a pending_id, the chip POSTs
    // to /api/agent/approve directly. The endpoint executes the
    // staged write synchronously and returns the new CRM record id.
    // Falls back to the prompt-based behaviour for [DO] chips
    // without a pending_id (e.g. older agent surfaces, non-CRM
    // actions, fresh proposals where staging itself failed).
    if (a.kind === 'DO' && a.pendingId) {
      void approveStaged(a.pendingId)
      return
    }

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
        const approval = a.pendingId ? approvals[a.pendingId] : undefined
        const isApproving = approval?.kind === 'approving'
        const isApproved = approval?.kind === 'approved'
        const failed = approval?.kind === 'failed' ? approval : null
        return (
          <button
            key={`${a.kind}:${i}`}
            type="button"
            onClick={() => !isApproving && !isApproved && onClick(a)}
            disabled={isApproving || isApproved}
            className={cn(
              'inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
              isApproved
                ? 'border-emerald-700/60 bg-emerald-900/40 text-emerald-100'
                : failed
                  ? 'border-rose-700/60 bg-rose-950/30 text-rose-200'
                  : STYLE[a.kind],
              (isApproving || isApproved) && 'cursor-default',
            )}
            title={failed ? failed.error : a.text}
          >
            {isApproving ? (
              <Loader2 className="size-3 shrink-0 animate-spin" />
            ) : isApproved ? (
              <CheckCircle2 className="size-3 shrink-0" />
            ) : (
              <Icon className="size-3 shrink-0" />
            )}
            <span className="truncate">
              {isApproved ? `Done — ${a.text}` : isApproving ? 'Approving…' : a.text}
            </span>
          </button>
        )
      })}
    </div>
  )
}
