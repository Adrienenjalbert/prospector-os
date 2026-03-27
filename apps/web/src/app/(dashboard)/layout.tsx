"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, MessageSquare } from "lucide-react";
import { ChatSidebar } from "@/components/agent/chat-sidebar";
import { clsx } from "clsx";

const navItems = [
  { href: "/inbox", label: "Inbox" },
  { href: "/analytics/my-funnel", label: "My Stats" },
  { href: "/settings", label: "Settings" },
] as const;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatInitialPrompt, setChatInitialPrompt] = useState<string | null>(null);

  useEffect(() => {
    function handleOpenChat(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.prompt) {
        setChatInitialPrompt(detail.prompt);
      }
      setSidebarOpen(true);
    }
    window.addEventListener('prospector:open-chat', handleOpenChat);
    return () => window.removeEventListener('prospector:open-chat', handleOpenChat);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-900">
        <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-8">
            <Link
              href="/inbox"
              className="shrink-0 text-sm font-semibold tracking-tight text-zinc-100"
            >
              Prospector OS
            </Link>
            <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5 md:pb-0">
              {navItems.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx(
                      "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-zinc-800 text-zinc-50"
                        : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="relative rounded-md p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Notifications"
            >
              <Bell className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              className={clsx(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                sidebarOpen
                  ? "bg-zinc-800 text-zinc-50"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
              )}
              aria-expanded={sidebarOpen}
              aria-controls="ai-chat-sidebar"
            >
              <MessageSquare className="size-4" />
              <span className="hidden sm:inline">AI chat</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 sm:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
        )}
        <ChatSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          initialPrompt={chatInitialPrompt}
          onPromptConsumed={() => setChatInitialPrompt(null)}
        />
      </div>
    </div>
  );
}
