"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, MessageCircleQuestion, Sparkles } from "lucide-react";
import { ChatSidebar } from "@/components/agent/chat-sidebar";
import { AgentPanel, type AgentPanelContext } from "@/components/agent/agent-panel";
import type { AgentType } from "@/lib/hooks/use-agent-chat";
import { NotificationList } from "@/components/notifications/notification-list";
import { NavDropdown } from "@/components/nav/nav-dropdown";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { getSkillsForPath, resolveSkillPrompt } from "@/lib/agent/skills";
import { clsx } from "clsx";

type NavItem = { href: string; label: string; roles?: string[] };
type NavDropdownItem = { href: string; label: string; roles?: string[] };
type NavDropdownDef = { label: string; items: NavDropdownItem[]; roles?: string[] };
type NavEntry = (NavItem & { type: 'link' }) | (NavDropdownDef & { type: 'dropdown' });

const allNavEntries: NavEntry[] = [
  { type: 'link', href: "/inbox", label: "Inbox" },
  { type: 'link', href: "/pipeline", label: "Pipeline" },
  { type: 'link', href: "/accounts", label: "Accounts" },
  { type: 'link', href: "/objects/companies", label: "Objects" },
  { type: 'link', href: "/signals", label: "Signals" },
  {
    type: 'dropdown',
    label: 'Analytics',
    items: [
      { href: "/analytics/my-funnel", label: "My Funnel" },
      { href: "/analytics/forecast", label: "Forecast", roles: ["manager", "admin", "revops"] },
      { href: "/analytics/team", label: "Team", roles: ["manager", "admin", "revops"] },
    ],
  },
  { type: 'link', href: "/settings", label: "Settings" },
  { type: 'link', href: "/admin/config", label: "Admin", roles: ["admin", "revops"] },
];

function getNavForRole(role: string): NavEntry[] {
  return allNavEntries
    .filter((entry) => !entry.roles || entry.roles.includes(role))
    .map((entry) => {
      if (entry.type !== 'dropdown') return entry
      const items = entry.items.filter((i) => !i.roles || i.roles.includes(role))
      if (items.length === 0) return null
      return { ...entry, items }
    })
    .filter((e): e is NavEntry => e != null)
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatInitialPrompt, setChatInitialPrompt] = useState<string | null>(null);
  const [chatActiveUrn, setChatActiveUrn] = useState<string | null>(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [userRole, setUserRole] = useState<string>("rep");
  const bellContainerRef = useRef<HTMLDivElement>(null);

  const [agentPanel, setAgentPanel] = useState<{
    isOpen: boolean;
    agentType: AgentType;
    prompt: string | null;
    context?: AgentPanelContext;
    title?: string;
  }>({ isOpen: false, agentType: "pipeline-coach", prompt: null });

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

  const navEntries = getNavForRole(userRole);

  useEffect(() => {
    function handleOpenChat(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.prompt) setChatInitialPrompt(detail.prompt);
      if (detail?.activeUrn) setChatActiveUrn(detail.activeUrn);
      setSidebarOpen(true);
    }
    window.addEventListener("prospector:open-chat", handleOpenChat);
    return () => window.removeEventListener("prospector:open-chat", handleOpenChat);
  }, []);

  useEffect(() => {
    function handleOpenPanel(e: Event) {
      const detail = (e as CustomEvent).detail as {
        agent: AgentType;
        prompt: string;
        pageContext?: AgentPanelContext;
        panelTitle?: string;
      };
      if (!detail?.agent || !detail?.prompt) return;
      setAgentPanel({
        isOpen: true,
        agentType: detail.agent,
        prompt: detail.prompt,
        context: detail.pageContext,
        title: detail.panelTitle,
      });
    }
    window.addEventListener("prospector:open-agent-panel", handleOpenPanel);
    return () =>
      window.removeEventListener("prospector:open-agent-panel", handleOpenPanel);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-900">
        <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-8">
            <Link
              href="/inbox"
              className="shrink-0"
            >
              <span className="text-sm font-semibold tracking-tight text-zinc-100">Prospector OS</span>
              <span className="ml-2 hidden text-xs text-zinc-600 sm:inline">Today&apos;s priorities</span>
            </Link>
            <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5 md:pb-0">
              {navEntries.map((entry) => {
                if (entry.type === 'dropdown') {
                  const isActive = entry.items.some(
                    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
                  );
                  return (
                    <NavDropdown
                      key={entry.label}
                      label={entry.label}
                      items={entry.items}
                      isActive={isActive}
                    />
                  );
                }
                const active =
                  pathname === entry.href ||
                  pathname.startsWith(`${entry.href}/`);
                return (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    className={clsx(
                      "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-zinc-800 text-zinc-50"
                        : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200",
                    )}
                  >
                    {entry.label}
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
              onClick={() => {
                const skills = getSkillsForPath(pathname);
                const primary = skills[0];
                if (primary) {
                  setAgentPanel({
                    isOpen: true,
                    agentType: primary.agent,
                    prompt: resolveSkillPrompt(primary, {}),
                    context: { page: pathname },
                    title: primary.label,
                  });
                } else {
                  setSidebarOpen(true);
                }
              }}
              className={clsx(
                "flex items-center gap-2 rounded-md bg-violet-600/15 px-3 py-2 text-sm font-medium text-violet-200 transition-colors hover:bg-violet-600/25 hover:text-violet-100",
              )}
              aria-label="Ask AI about this page"
            >
              <Sparkles className="size-4" />
              <span className="hidden sm:inline">Ask AI</span>
            </button>
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              className={clsx(
                "rounded-md p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200",
                sidebarOpen && "bg-zinc-800 text-zinc-100",
              )}
              aria-expanded={sidebarOpen}
              aria-controls="ai-chat-sidebar"
              aria-label="Ask anything (free-form chat)"
              title="Ask anything (free-form chat)"
            >
              <MessageCircleQuestion className="size-5" />
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
          activeUrn={chatActiveUrn}
          agentType={
            pathname.startsWith('/objects/deals') || pathname.startsWith('/pipeline')
              ? 'pipeline-coach'
              : pathname.startsWith('/objects/companies') || pathname.startsWith('/accounts')
                ? 'account-strategist'
                : 'pipeline-coach'
          }
        />
        <AgentPanel
          isOpen={agentPanel.isOpen}
          onClose={() => setAgentPanel((s) => ({ ...s, isOpen: false }))}
          agentType={agentPanel.agentType}
          initialPrompt={agentPanel.prompt}
          context={agentPanel.context}
          panelTitle={agentPanel.title}
        />
      </div>
    </div>
  );
}
