"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export type NotificationRow = {
  id: string;
  title: string;
  body: string;
  severity: string;
  action_url: string | null;
  read: boolean | null;
  created_at: string;
};

export interface NotificationListProps {
  isOpen: boolean;
  onClose: () => void;
  onNotificationsChanged?: () => void;
  /** Ref to the bell + panel wrapper — outside clicks close the popover */
  containerRef: React.RefObject<HTMLElement | null>;
}

const severityStyles: Record<string, string> = {
  critical: "bg-red-950/80 text-red-200 border-red-800",
  high: "bg-amber-950/60 text-amber-100 border-amber-800",
  medium: "bg-zinc-800 text-zinc-200 border-zinc-600",
  info: "bg-sky-950/50 text-sky-100 border-sky-800",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diffMs = now - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function NotificationList({
  isOpen,
  onClose,
  onNotificationsChanged,
  containerRef,
}: NotificationListProps) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadUnread = useCallback(async () => {
    const supabase = createSupabaseBrowser();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setItems([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select(
          "id, title, body, severity, action_url, read, created_at",
        )
        .eq("user_id", user.id)
        .eq("read", false)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("[notifications]", error);
        setItems([]);
        return;
      }
      setItems((data ?? []) as NotificationRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadUnread();
  }, [isOpen, loadUnread]);

  useEffect(() => {
    if (!isOpen) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onPointerDown(e: MouseEvent) {
      const el = containerRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        onClose();
      }
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [isOpen, onClose, containerRef]);

  async function handleSelect(n: NotificationRow) {
    const supabase = createSupabaseBrowser();
    const { error } = await supabase
      .from("notifications")
      .update({ read: true, read_at: new Date().toISOString() })
      .eq("id", n.id);

    if (error) {
      console.error("[notifications] mark read", error);
    }

    setItems((prev) => prev.filter((x) => x.id !== n.id));
    onNotificationsChanged?.();
    onClose();

    const url = n.action_url?.trim() || "/inbox";
    if (url.startsWith("http://") || url.startsWith("https://")) {
      window.location.href = url;
    } else {
      router.push(url.startsWith("/") ? url : `/${url}`);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="absolute right-0 top-full z-50 mt-2 w-[min(100vw-2rem,22rem)] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
      role="dialog"
      aria-label="Notifications"
    >
      <div className="border-b border-zinc-800 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Unread
        </p>
      </div>

      <div className="max-h-[min(70vh,24rem)] overflow-y-auto">
        {loading && (
          <div className="px-3 py-8 text-center text-sm text-zinc-500">
            Loading…
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="px-3 py-10 text-center text-sm text-zinc-500">
            No notifications
          </div>
        )}

        {!loading &&
          items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => void handleSelect(n)}
              className="flex w-full flex-col gap-1 border-b border-zinc-800/80 px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-zinc-800/60"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-sm font-medium text-zinc-100">
                  {n.title}
                </span>
                <span
                  className={clsx(
                    "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase",
                    severityStyles[n.severity] ?? severityStyles.medium,
                  )}
                >
                  {n.severity}
                </span>
              </div>
              <p className="line-clamp-3 text-xs leading-snug text-zinc-400">
                {n.body}
              </p>
              <span className="text-[11px] text-zinc-500">
                {formatTime(n.created_at)}
              </span>
            </button>
          ))}
      </div>
    </div>
  );
}
