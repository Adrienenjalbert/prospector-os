"use client";

import { Sparkles } from "lucide-react";

export function AccountResearchButton({ accountName }: { accountName: string }) {
  function handleClick() {
    const prompt = `Research ${accountName} — show me their ICP fit, recent signals, key contacts, and recommended next steps.`;
    window.dispatchEvent(
      new CustomEvent("prospector:open-chat", { detail: { prompt } })
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-50"
    >
      <Sparkles className="size-4 text-violet-400" />
      Ask AI
    </button>
  );
}
