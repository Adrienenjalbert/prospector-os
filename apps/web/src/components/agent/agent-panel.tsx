"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { ExternalLink, Loader2, Send, Sparkles, X } from "lucide-react";

import { createSupabaseBrowser } from "@/lib/supabase/client";
import type { AgentType } from "@/lib/hooks/use-agent-chat";
import { cn } from "@/lib/utils";

import { ChatMessage } from "./chat-message";

export interface AgentPanelContext {
  page: string;
  accountId?: string;
  dealId?: string;
}

export interface AgentPanelProps {
  isOpen: boolean;
  onClose: () => void;
  agentType: AgentType;
  initialPrompt: string | null;
  context?: AgentPanelContext;
  panelTitle?: string;
}

interface Citation {
  claim_text: string;
  source_type: string;
  source_id: string | null;
  source_url: string | null;
}

const TITLE_BY_AGENT: Record<AgentType, string> = {
  "pipeline-coach": "Pipeline Coach",
  "account-strategist": "Account Strategist",
  "leadership-lens": "Leadership Lens",
  "onboarding-coach": "Onboarding Coach",
};

/**
 * Inline contextual panel. Opens with a pre-filled prompt, streams a single
 * answer, renders the Sources footer (citations), and offers a small follow-up
 * input as a fallback. Designed to replace free-form chat for skill-triggered
 * actions: every visit starts from a clear prompt, never an empty box.
 */
export function AgentPanel({
  isOpen,
  onClose,
  agentType,
  initialPrompt,
  context,
  panelTitle,
}: AgentPanelProps) {
  const [authHeaders, setAuthHeaders] = useState<Record<string, string>>({});
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const promptSentRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowser();
    void supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (token) setAuthHeaders({ Authorization: `Bearer ${token}` });
    });
  }, []);

  const { messages, append, isLoading, error, input, setInput, handleSubmit, setMessages } = useChat({
    api: "/api/agent",
    id: `panel-${agentType}-${context?.accountId ?? context?.dealId ?? "global"}`,
    headers: authHeaders,
    body: {
      agent_type: agentType,
      context: { pageContext: context },
    },
    onResponse: (res) => {
      const id = res.headers.get("x-interaction-id");
      setInteractionId(id);
      setCitations([]);
    },
    onFinish: () => {
      // Citations are flushed server-side after the stream ends. Fetch on a
      // brief delay so the row inserts have time to commit.
      setTimeout(() => void loadCitations(), 600);
    },
  });

  async function loadCitations() {
    if (!interactionId) return;
    try {
      const res = await fetch(
        `/api/agent/citations?interaction_id=${encodeURIComponent(interactionId)}`,
        { headers: authHeaders },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { citations: Citation[] };
      setCitations(data.citations ?? []);
    } catch {
      // Silently ignore — citations are nice-to-have, not blocking.
    }
  }

  // Reset and fire when a new prompt arrives
  useEffect(() => {
    if (!isOpen || !initialPrompt) return;
    if (initialPrompt === promptSentRef.current) return;

    promptSentRef.current = initialPrompt;
    setMessages([]);
    setCitations([]);
    setInteractionId(null);
    setFollowUpOpen(false);
    void append({ role: "user", content: initialPrompt });
  }, [initialPrompt, isOpen, append, setMessages]);

  // Reset prompt tracking when panel closes so re-opening with the same skill
  // re-runs the prompt (a deliberate UX choice — clicking again means "redo").
  useEffect(() => {
    if (!isOpen) {
      promptSentRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading, citations]);

  const title = panelTitle ?? TITLE_BY_AGENT[agentType];
  const promptShown = messages.find((m) => m.role === "user")?.content;
  const assistantMessages = messages.filter((m) => m.role === "assistant");

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-zinc-800 bg-zinc-900 shadow-2xl transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
        aria-hidden={!isOpen}
        aria-label={title}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-violet-500/15">
              <Sparkles className="size-4 text-violet-300" />
            </div>
            <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close panel"
          >
            <X className="size-5" />
          </button>
        </header>

        {promptShown && (
          <div className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              You asked
            </div>
            <div className="mt-1 text-sm text-zinc-200">{promptShown}</div>
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="flex flex-col gap-4">
            {assistantMessages.length === 0 && isLoading && (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="size-4 animate-spin" />
                Thinking…
              </div>
            )}

            {assistantMessages.map((m, i) => {
              const isLast = i === assistantMessages.length - 1;
              return (
                <ChatMessage
                  key={m.id}
                  role="assistant"
                  content={m.content}
                  isLatest={isLast}
                  isStreaming={isLast && isLoading}
                  interactionId={isLast ? interactionId : undefined}
                />
              );
            })}

            {error && (
              <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm text-red-300">
                Something went wrong. Try again.
              </div>
            )}

            {!isLoading && citations.length > 0 && (
              <CitationsFooter citations={citations} />
            )}

            {!isLoading && assistantMessages.length > 0 && !followUpOpen && (
              <button
                type="button"
                onClick={() => setFollowUpOpen(true)}
                className="self-start text-xs text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-300 hover:underline"
              >
                Ask a follow-up
              </button>
            )}
          </div>
        </div>

        {followUpOpen && (
          <form
            onSubmit={handleSubmit}
            className="flex shrink-0 gap-2 border-t border-zinc-800 p-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a follow-up…"
              disabled={isLoading}
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-600 focus:ring-2 focus:ring-zinc-600/40 disabled:opacity-50"
              autoFocus
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-zinc-100 px-3 py-2 text-zinc-900 transition-colors hover:bg-zinc-200 disabled:opacity-40"
              aria-label="Send"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </button>
          </form>
        )}
      </aside>
    </>
  );
}

function CitationsFooter({ citations }: { citations: Citation[] }) {
  // De-dupe by source_id+source_type so the footer doesn't repeat the same
  // record when multiple tool steps reference it.
  const seen = new Set<string>();
  const unique = citations.filter((c) => {
    const key = `${c.source_type}:${c.source_id ?? c.claim_text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        Sources
      </div>
      <ul className="mt-2 space-y-1">
        {unique.map((c, idx) => (
          <li
            key={`${c.source_type}-${c.source_id ?? idx}`}
            className="flex items-center gap-2 text-xs text-zinc-400"
          >
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
              {c.source_type}
            </span>
            <span className="truncate">{c.claim_text}</span>
            {c.source_url && (
              <a
                href={c.source_url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-violet-300 transition-colors hover:text-violet-200"
                aria-label={`Open ${c.claim_text} in source`}
              >
                <ExternalLink className="size-3" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
