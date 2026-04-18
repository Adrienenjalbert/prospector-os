'use client'

import { ArrowRight } from 'lucide-react'

interface OpenChatStepProps {
  done: boolean
  label: string
  sub: string
  cta: string
  index: number
}

/**
 * Client island for the welcome banner's "Open chat" step. The previous
 * version used `href="#"` on a Link — focus jumped to the page top and
 * the chat never opened. We now fire the same custom event the
 * dashboard header listens for, so the chat sidebar slides in and
 * focus moves to the chat input (handled by chat-sidebar.tsx).
 */
export function OpenChatStep({ done, label, sub, cta, index }: OpenChatStepProps) {
  function openChat() {
    if (done) return
    window.dispatchEvent(new CustomEvent('prospector:open-chat'))
  }

  return (
    <button
      type="button"
      onClick={openChat}
      disabled={done}
      className={`group flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        done
          ? 'border-emerald-700/40 bg-emerald-950/20 cursor-default'
          : 'border-zinc-700/60 bg-zinc-950/40 hover:border-violet-600/50 hover:bg-zinc-900'
      }`}
    >
      <div
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
          done
            ? 'bg-emerald-500/30 text-emerald-200'
            : 'border border-zinc-600 text-zinc-400'
        }`}
        aria-hidden
      >
        {done ? '✓' : index + 1}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-zinc-100">{label}</div>
        <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>
        <div
          className={`mt-1.5 inline-flex items-center gap-1 text-[11px] ${
            done ? 'text-emerald-300' : 'text-violet-300 group-hover:text-violet-200'
          }`}
        >
          {cta}
          {!done && <ArrowRight className="size-3" />}
        </div>
      </div>
    </button>
  )
}
