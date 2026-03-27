"use client";

import { useState } from "react";
import { Send, X } from "lucide-react";

import { useAgentChat } from "@/lib/hooks/use-agent-chat";

import { ChatMessage } from "./chat-message";

export interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const suggestedPrompts = [
  "Summarise my top accounts this week.",
  "Which deals are stalling vs benchmark?",
  "Draft a follow-up for my last meeting.",
  "What signals should I prioritise today?",
] as const;

export function ChatSidebar({ isOpen, onClose }: ChatSidebarProps) {
  const [input, setInput] = useState("");

  const _agentChat = useAgentChat("stub-rep-id", "stub-tenant-id");
  void _agentChat;

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setInput("");
  }

  return (
    <div
      className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l border-zinc-800 bg-zinc-900 shadow-2xl transition-transform duration-300 ease-out ${
        isOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
      }`}
      aria-hidden={!isOpen}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-4">
          <ChatMessage
            role="assistant"
            content="Welcome to Prospector OS. Ask about accounts, funnel health, or outreach — your context loads from CRM."
          />
        </div>
      </div>

      <div className="shrink-0 border-t border-zinc-800 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Suggested
        </p>
        <div className="mt-2 flex flex-col gap-2">
          {suggestedPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setInput(prompt)}
              className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-left text-xs leading-snug text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-900 hover:text-zinc-100"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={handleSend}
        className="flex shrink-0 gap-2 border-t border-zinc-800 p-4"
      >
        <label htmlFor="agent-chat-input" className="sr-only">
          Message
        </label>
        <input
          id="agent-chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message Prospector OS…"
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none ring-zinc-600 focus:border-zinc-600 focus:ring-2 focus:ring-zinc-600/40"
        />
        <button
          type="submit"
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-zinc-100 px-3 py-2 text-zinc-900 transition-colors hover:bg-zinc-200"
          aria-label="Send message"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
