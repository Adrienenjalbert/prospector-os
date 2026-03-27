import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
}

export function ChatMessage({ role, content }: ChatMessageProps) {
  const isUser = role === "user";

  return (
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
          isUser
            ? "bg-zinc-700 text-zinc-50"
            : "bg-zinc-800 text-zinc-100",
        )}
      >
        {content}
      </div>
    </div>
  );
}
