"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, MessageSquare } from "lucide-react";
import { ChatSidebar } from "@/components/agent/chat-sidebar";
import { NotificationList } from "@/components/notifications/notification-list";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { clsx } from "clsx";

type NavItem = { href: string; label: string; roles?: string[] };

const allNavItems: NavItem[] = [
  { href: "/inbox", label: "Inbox" },
  { href: "/pipeline", label: "Pipeline", roles: ["manager", "admin"] },
  { href: "/accounts", label: "Accounts", roles: ["manager", "admin"] },
  { href: "/analytics/my-funnel", label: "My Stats" },
  { href: "/analytics/team", label: "Team", roles: ["manager", "admin"] },
  { href: "/settings", label: "Settings" },
  { href: "/admin/config", label: "Admin", roles: ["admin"] },
];

function getNavForRole(role: string): NavItem[] {
  return allNavItems.filter((item) => !item.roles || item.roles.includes(role));
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatInitialPrompt, setChatInitialPrompt] = useState<string | null>(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [userRole, setUserRole] = useState<string>("rep");
  const bellContainerRef = useRef<HTMLDivElement>(null);

  const refreshUnreadCount = useCallback(async () => {
    const supabase = createSupabaseBrowser();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUnreadCount(0);
      return;
    }

    const { count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("read", false);

    if (error) {
      console.error("[layout] unread count", error);
      return;
    }
    setUnreadCount(count ?? 0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createSupabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setUnreadCount(0);
        return;
      }
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("read", false);
      if (cancelled) return;
      if (error) {
        console.error("[layout] unread count", error);
        return;
      }
      setUnreadCount(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createSupabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (cancelled) return;
      if (profile?.role) setUserRole(profile.role);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const navItems = getNavForRole(userRole);

  useEffect(() => {
    function handleOpenChat(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.prompt) {
        setChatInitialPrompt(detail.prompt);
      }
      setSidebarOpen(true);
    }
    window.addEventListener("prospector:open-chat", handleOpenChat);
    return () => window.removeEventListener("prospector:open-chat", handleOpenChat);
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
            <div className="relative" ref={bellContainerRef}>
              <button
                type="button"
                onClick={() => setNotificationOpen((o) => !o)}
                className={clsx(
                  "relative rounded-md p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200",
                  notificationOpen && "bg-zinc-800 text-zinc-100",
                )}
                aria-label="Notifications"
                aria-expanded={notificationOpen}
              >
                <Bell className="size-5" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
              <NotificationList
                isOpen={notificationOpen}
                onClose={() => setNotificationOpen(false)}
                onNotificationsChanged={() => void refreshUnreadCount()}
                containerRef={bellContainerRef}
              />
            </div>
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
