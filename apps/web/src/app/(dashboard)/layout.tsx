"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bell, MessageSquare, Sparkles } from "lucide-react";
import { clsx } from "clsx";

const navItems = [
  { href: "/inbox", label: "Inbox" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/accounts", label: "Accounts" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Settings" },
] as const;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
              <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-semibold text-white">
                3
              </span>
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
        {sidebarOpen ? (
          <aside
            id="ai-chat-sidebar"
            className="w-full max-w-md shrink-0 border-l border-zinc-800 bg-zinc-900/80 backdrop-blur-sm"
          >
            <div className="flex h-full flex-col p-4">
              <div className="mb-4 flex items-center gap-2 border-b border-zinc-800 pb-3">
                <Sparkles className="size-5 text-violet-400" />
                <span className="text-sm font-semibold text-zinc-100">
                  AI assistant
                </span>
              </div>
              <p className="text-sm leading-relaxed text-zinc-500">
                Chat will connect to your agent here. Toggle with the button in
                the header.
              </p>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
