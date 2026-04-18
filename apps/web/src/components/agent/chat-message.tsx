import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { MessageFeedback } from "./message-feedback";
import { CitationPills } from "./citation-pills";
import { SuggestedActions } from "./suggested-actions";

export interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isLatest?: boolean;
  interactionId?: string | null;
  isStreaming?: boolean;
  /** URN of the object the chat is anchored on (passed via layout). */
  activeUrn?: string | null;
}

/**
 * Hide the `## Next Steps` section from the rendered text — the
 * SuggestedActions component renders it as interactive buttons instead.
 * Without this, users see the markdown twice (raw + parsed).
 */
function stripNextSteps(content: string): string {
  return content.replace(/(?:^|\n)\s*(?:#{2,3}|\*\*)\s*Next Steps[\s\S]*$/i, "").trim();
}

export function ChatMessage({
  role,
  content,
  isLatest,
  interactionId,
  isStreaming,
  activeUrn,
}: ChatMessageProps) {
  const isUser = role === "user";
  const display = isUser ? content : stripNextSteps(content);

  return (
    <div>
      <div
        className={cn(
          "flex w-full gap-3",
          isUser ? "justify-end" : "justify-start",
        )}
      >
        {!isUser && (
          <div
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-700 text-zinc-100"
            aria-hidden
          >
            <Sparkles className="size-4 text-violet-300" />
          </div>
        )}
        <div
          className={cn(
            "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
            isUser ? "bg-zinc-700 text-zinc-50" : "bg-zinc-800 text-zinc-100",
          )}
        >
          {display || content}
        </div>
      </div>
      {!isUser && interactionId && (
        <CitationPills
          interactionId={interactionId}
          isStreaming={isStreaming ?? false}
        />
      )}
      {!isUser && interactionId && (
        <SuggestedActions
          content={content}
          interactionId={interactionId}
          activeUrn={activeUrn}
          isStreaming={isStreaming ?? false}
        />
      )}
      {!isUser && isLatest && interactionId && (
        <MessageFeedback
          interactionId={interactionId}
          isStreaming={isStreaming ?? false}
        />
      )}
    </div>
  );
}
