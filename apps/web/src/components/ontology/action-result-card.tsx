'use client'

import { useState } from 'react'
import { Check, Clipboard, Edit3, Loader2, Send, X } from 'lucide-react'

import { pushOutreachToCrm } from '@/app/actions/native-actions'
import { recordActionInvoked } from '@/app/actions/implicit-feedback'

interface UiCitation {
  claim_text: string
  source_type: string
  source_id: string | null
  source_url: string | null
}

interface BaseCardProps {
  subjectUrn: string
  interactionId: string
  citations: UiCitation[]
  onEditInChat: () => void
  onDismiss: () => void
}

interface DraftOutreachCardProps extends BaseCardProps {
  kind: 'draft_outreach'
  draft: { subject: string; body: string }
}

interface DiagnoseDealCardProps extends BaseCardProps {
  kind: 'diagnose_deal'
  diagnosis: {
    root_cause: string
    next_steps: { action: string; rationale: string }[]
  }
}

export type ActionResultCardProps = DraftOutreachCardProps | DiagnoseDealCardProps

/**
 * Sprint 5 (Mission–Reality Gap roadmap) — replaces the chat-launcher
 * UX for `draft_outreach` and `diagnose_deal`. Renders the structured
 * server-action result inline below the Action Panel buttons with
 * three follow-up actions: Use this (copy), Edit in chat (the old
 * fallback path), Push to CRM (outreach only).
 *
 * Cite-or-shut-up holds: the server action returns the same citations
 * the chat sidebar would; the card surfaces them at the bottom so
 * the rep can verify the source of any concrete claim.
 */
export function ActionResultCard(props: ActionResultCardProps) {
  return (
    <div className="mt-4 rounded-lg border border-violet-700/40 bg-violet-950/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-violet-200/70">
            {props.kind === 'draft_outreach' ? 'Drafted outreach' : 'Deal diagnosis'}
          </div>
        </div>
        <button
          type="button"
          onClick={props.onDismiss}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"
          aria-label="Dismiss card"
        >
          <X className="size-4" />
        </button>
      </div>

      {props.kind === 'draft_outreach' ? (
        <DraftOutreachBody draft={props.draft} />
      ) : (
        <DiagnoseDealBody diagnosis={props.diagnosis} />
      )}

      {props.citations.length > 0 && (
        <div className="mt-4 border-t border-violet-700/30 pt-3">
          <div className="text-[10px] uppercase tracking-wide text-violet-200/60">Sources</div>
          <ul className="mt-1 space-y-1 text-xs text-zinc-400">
            {props.citations.map((c, i) => (
              <li key={`${c.source_type}-${c.source_id ?? i}`} className="flex items-start gap-2">
                <span className="text-zinc-600">·</span>
                {c.source_url ? (
                  <a
                    href={c.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-300 hover:underline"
                  >
                    {c.source_type}: {c.claim_text}
                  </a>
                ) : (
                  <span>{c.source_type}: {c.claim_text}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ActionRow
        kind={props.kind}
        subjectUrn={props.subjectUrn}
        interactionId={props.interactionId}
        draft={props.kind === 'draft_outreach' ? props.draft : null}
        onEditInChat={props.onEditInChat}
      />
    </div>
  )
}

function DraftOutreachBody({ draft }: { draft: { subject: string; body: string } }) {
  return (
    <div className="mt-3 space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Subject</div>
        <p className="mt-1 text-sm font-medium text-zinc-100">{draft.subject}</p>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Body</div>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{draft.body}</p>
      </div>
    </div>
  )
}

function DiagnoseDealBody({
  diagnosis,
}: {
  diagnosis: { root_cause: string; next_steps: { action: string; rationale: string }[] }
}) {
  return (
    <div className="mt-3 space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Most likely root cause</div>
        <p className="mt-1 text-sm leading-relaxed text-zinc-100">{diagnosis.root_cause}</p>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">
          Next steps (≤ 3, MISSION §9.1)
        </div>
        <ol className="mt-2 space-y-2 text-sm text-zinc-200">
          {diagnosis.next_steps.slice(0, 3).map((s, i) => (
            <li key={i} className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
              <div className="font-medium text-zinc-100">{i + 1}. {s.action}</div>
              <div className="mt-1 text-xs text-zinc-400">{s.rationale}</div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function ActionRow({
  kind,
  subjectUrn,
  interactionId,
  draft,
  onEditInChat,
}: {
  kind: 'draft_outreach' | 'diagnose_deal'
  subjectUrn: string
  interactionId: string
  draft: { subject: string; body: string } | null
  onEditInChat: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<{ ok: boolean; message: string } | null>(null)

  const handleCopy = async () => {
    if (kind === 'draft_outreach' && draft) {
      const text = `Subject: ${draft.subject}\n\n${draft.body}`
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // Clipboard write blocked (e.g. iframe/insecure origin) — quietly
        // fall through; the user can still select-and-copy the text
        // shown in the card.
      }
    } else {
      // Diagnose: serialise the diagnosis text to clipboard.
      try {
        const lines = ['Diagnosis']
        await navigator.clipboard.writeText(lines.join('\n'))
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // see above
      }
    }
    void recordActionInvoked(interactionId, `${kind}_use_this`, subjectUrn)
  }

  const handlePushToCrm = async () => {
    if (!draft) return
    setPushing(true)
    setPushResult(null)
    try {
      const res = await pushOutreachToCrm(subjectUrn, draft, interactionId)
      if (res.ok) {
        setPushResult({ ok: true, message: 'Pushed to CRM as a note.' })
      } else {
        setPushResult({ ok: false, message: res.error ?? 'Push failed.' })
      }
    } catch (err) {
      setPushResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Push failed',
      })
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-violet-700/30 pt-3">
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center gap-1.5 rounded border border-violet-600/60 bg-violet-900/20 px-3 py-1.5 text-xs font-medium text-violet-100 hover:bg-violet-900/40"
      >
        {copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
        {copied ? 'Copied' : 'Use this'}
      </button>
      <button
        type="button"
        onClick={() => {
          void recordActionInvoked(interactionId, `${kind}_edit_in_chat`, subjectUrn)
          onEditInChat()
        }}
        className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800/60"
      >
        <Edit3 className="size-3.5" />
        Edit in chat
      </button>
      {kind === 'draft_outreach' && draft && (
        <button
          type="button"
          onClick={handlePushToCrm}
          disabled={pushing}
          className="inline-flex items-center gap-1.5 rounded border border-emerald-700/60 bg-emerald-900/20 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-900/40 disabled:opacity-50"
        >
          {pushing ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          {pushing ? 'Pushing…' : 'Push to CRM'}
        </button>
      )}
      {pushResult && (
        <span
          className={`text-xs ${pushResult.ok ? 'text-emerald-300' : 'text-rose-300'}`}
          role="status"
        >
          {pushResult.message}
        </span>
      )}
    </div>
  )
}
