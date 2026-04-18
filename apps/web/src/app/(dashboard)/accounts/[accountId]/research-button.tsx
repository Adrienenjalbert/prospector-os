"use client";

import { Sparkles } from "lucide-react";

/**
 * Compact "Ask AI" button for the account header. Routes through the new
 * AgentPanel system so the response renders inline with citations rather than
 * dropping the user into a free-form chat thread.
 */
export function AccountResearchButton({
  accountName,
  accountId,
}: {
  accountName: string;
  accountId: string;
}) {
  function handleClick() {
    window.dispatchEvent(
      new CustomEvent("prospector:open-agent-panel", {
        detail: {
          agent: "account-strategist",
          prompt: `Research ${accountName} — show me their ICP fit, recent signals, key contacts, and recommended next steps.`,
          pageContext: { page: "account-detail", accountId },
          panelTitle: `Research ${accountName}`,
        },
      }),
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-violet-600/60 hover:bg-violet-600/10 hover:text-violet-100"
    >
      <Sparkles className="size-4 text-violet-400" />
      Ask AI
    </button>
  );
}
