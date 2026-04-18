"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2, Send, X } from "lucide-react";
import type { Message } from "@ai-sdk/react";

import { useAgentChat, type AgentType } from "@/lib/hooks/use-agent-chat";
import { createSupabaseBrowser } from "@/lib/supabase/client";

import { ChatMessage } from "./chat-message";
import { SuggestedPrompts } from "./suggested-prompts";

/**
 * The id the dashboard header's "open chat" button refers to via
 * `aria-controls`. Centralised so the trigger button and the panel
 * can never drift out of sync. (WCAG 4.1.2 — name/role/value.)
 */
const CHAT_PANEL_ID = "ai-chat-sidebar";

/**
 * Close the chat panel on Escape — the modal-like keyboard contract
 * users expect from any slide-in/dialog surface (WCAG 2.1.2 keyboard
 * trap avoidance + standard dialog behaviour).
 */
function useEscapeToClose(isOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);
}

export interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  initialPrompt?: string | null;
  onPromptConsumed?: () => void;
  agentType?: AgentType;
  /**
   * URN of the object the user is currently viewing. Flows into the agent
   * request so the context builder can pick account_deep / deal_deep and
   * every emitted event gets the subject_urn attached.
   */
  activeUrn?: string | null;
}

const fallbackPrompts = [
  "Who should I call first today?",
  "What's happening with my stalled deals?",
  "Why is Acme Corp flagged as high priority?",
  "How's my pipeline compared to the team?",
] as const;

const WELCOME_MESSAGE =
  "This is the free-form fallback. For most tasks, use the action chips on each page — they pre-fill context. If you really want to type, go ahead.";

function ContextualSuggestions({ onSelect }: { onSelect: (prompt: string) => void }) {
  const pathname = usePathname();
  return (
    <SuggestedPrompts
      currentPage={pathname}
      onSelectPrompt={onSelect}
    />
  );
}

type HistoryMsg = { id?: string; role: string; content: string };

function mapHistoryToMessages(rows: HistoryMsg[]): Message[] {
  return rows.map((m, i) => ({
    id: m.id ?? `history-${i}-${crypto.randomUUID()}`,
    role: m.role as Message["role"],
    content: typeof m.content === "string" ? m.content : "",
  }));
}

function ChatSidebarChat({
  isOpen,
  onClose,
  initialPrompt,
  onPromptConsumed,
  initialMessages,
  accessToken,
  agentType,
  activeUrn,
}: ChatSidebarProps & {
  initialMessages: Message[];
  accessToken: string | null;
  activeUrn?: string | null;
}) {
  const pathname = usePathname();
  const pageContext = {
    page: pathname ?? "",
    activeUrn: activeUrn ?? undefined,
  };
  const { messages, input, setInput, handleSubmit, append, isLoading, error, interactionId } =
    useAgentChat({
      agentType,
      initialMessages,
      initialAccessToken: accessToken,
      pageContext,
    });

  const scrollRef = useRef<HTMLDivElement>(null);
  const promptSentRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEscapeToClose(isOpen, onClose);

  // When the panel opens, focus the chat input so screen-reader and
  // keyboard users land in a useful place rather than having to tab in
  // from the trigger. WCAG 2.4.3 (focus order).
  useEffect(() => {
    if (isOpen) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (initialPrompt && isOpen && initialPrompt !== promptSentRef.current) {
      promptSentRef.current = initialPrompt;
      append({ role: "user", content: initialPrompt });
      onPromptConsumed?.();
    }
  }, [initialPrompt, isOpen, append, onPromptConsumed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading]);

  function handleSuggestedPrompt(prompt: string) {
    append({ role: "user", content: prompt });
  }

  const showSuggestions = messages.length === 0;
  const canSend = input.trim().length > 0 && !isLoading;

  return (
    <div
      id={CHAT_PANEL_ID}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-chat-sidebar-title"
      className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l border-zinc-800 bg-zinc-900 shadow-2xl transition-transform duration-300 ease-out ${
        isOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
      }`}
      aria-hidden={!isOpen}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div>
          <h2 id="ai-chat-sidebar-title" className="text-sm font-semibold tracking-tight text-zinc-100">
            Ask anything
          </h2>
          <p className="text-[11px] text-zinc-500">
            Fallback chat. Page-level actions are usually faster.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Close chat"
        >
          <X className="size-5" />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-4">
          {messages.length === 0 && (
            <ChatMessage role="assistant" content={WELCOME_MESSAGE} />
          )}
          {messages.map((m, idx) => {
            const isLast = idx === messages.length - 1;
            return (
              <ChatMessage
                key={m.id}
                role={m.role as "user" | "assistant"}
                content={m.content}
                isLatest={isLast && m.role === "assistant"}
                interactionId={isLast && m.role === "assistant" ? interactionId : undefined}
                isStreaming={isLast && isLoading}
                activeUrn={activeUrn}
              />
            );
          })}
          {isLoading && messages.at(-1)?.role === "user" && (
            <div className="flex items-center gap-2 px-1 text-sm text-zinc-500">
              <Loader2 className="size-4 animate-spin" />
              Thinking…
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm text-red-300">
              Something went wrong. Try again.
            </div>
          )}
        </div>
      </div>

      {showSuggestions && (
        <div className="shrink-0 border-t border-zinc-800 px-4 py-3">
          <ContextualSuggestions onSelect={handleSuggestedPrompt} />
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 gap-2 border-t border-zinc-800 p-4"
      >
        <label htmlFor="agent-chat-input" className="sr-only">
          Message
        </label>
        <input
          ref={inputRef}
          id="agent-chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message Prospector OS…"
          disabled={isLoading}
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none ring-zinc-600 focus:border-zinc-600 focus:ring-2 focus:ring-zinc-600/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-zinc-100 px-3 py-2 text-zinc-900 transition-colors hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Send message"
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </button>
      </form>
    </div>
  );
}

export function ChatSidebar({
  isOpen,
  onClose,
  initialPrompt,
  onPromptConsumed,
  agentType,
  activeUrn,
}: ChatSidebarProps) {
  const [historyReady, setHistoryReady] = useState(false);
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const supabase = createSupabaseBrowser();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const token = session?.access_token ?? null;
        if (!token) {
          if (!cancelled) {
            setAccessToken(null);
            setInitialMessages([]);
            setHistoryReady(true);
          }
          return;
        }

        if (!cancelled) setAccessToken(token);

        const res = await fetch("/api/agent/history", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          if (!cancelled) {
            setInitialMessages([]);
            setHistoryReady(true);
          }
          return;
        }

        const data = (await res.json()) as { messages?: HistoryMsg[] };
        const rows = Array.isArray(data.messages) ? data.messages : [];
        const normalized = rows.filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string",
        );

        if (!cancelled) {
          setInitialMessages(mapHistoryToMessages(normalized));
          setHistoryReady(true);
        }
      } catch {
        if (!cancelled) {
          setInitialMessages([]);
          setHistoryReady(true);
        }
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!historyReady) {
    return (
      <ChatSidebarLoading
        isOpen={isOpen}
        onClose={onClose}
      />
    );
  }

  return (
    <ChatSidebarChat
      isOpen={isOpen}
      onClose={onClose}
      initialPrompt={initialPrompt}
      onPromptConsumed={onPromptConsumed}
      initialMessages={initialMessages}
      accessToken={accessToken}
      agentType={agentType}
      activeUrn={activeUrn ?? null}
    />
  );
}

function ChatSidebarLoading({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  // The loading state is its own dialog instance so id, role, and Escape
  // wiring all work the moment the panel becomes visible — even before
  // history finishes loading. Without this, opening the chat and pressing
  // Escape during the load would do nothing.
  useEscapeToClose(isOpen, onClose);

  return (
    <div
      id={CHAT_PANEL_ID}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-chat-sidebar-loading-title"
      className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l border-zinc-800 bg-zinc-900 shadow-2xl transition-transform duration-300 ease-out ${
        isOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
      }`}
      aria-hidden={!isOpen}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <h2 id="ai-chat-sidebar-loading-title" className="text-sm font-semibold tracking-tight text-zinc-100">
          Prospector OS
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Close chat"
        >
          <X className="size-5" />
        </button>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-5 animate-spin" />
          Loading conversation…
        </div>
      </div>
    </div>
  )
}
