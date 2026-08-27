import { useState, useRef, useEffect } from "react";
import { Bell, Check, AlertTriangle, Info, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getNotifications, markNotificationRead } from "#/lib/server/system";
import { lookupLabel } from "#/lib/label-lookup";
import { useAuth } from "#/lib/auth-context";
import type { systemNotifications } from "#/db/schema";
import type { InferSelectModel } from "drizzle-orm";

type Notification = InferSelectModel<typeof systemNotifications>;

export default function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) {
        // On mobile the sheet lives in a portal (fixed), so don't close via click-outside — backdrop handles it
        if (window.matchMedia("(max-width: 639px)").matches) return;
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ESC + body scroll lock when open (especially for mobile sheet)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    if (open) {
      document.addEventListener("keydown", onKey);
      const prev = document.body.style.overflow;
      // Only lock scroll on mobile sheet — desktop dropdown shouldn't
      if (window.matchMedia("(max-width: 639px)").matches) document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", onKey);
        document.body.style.overflow = prev;
      };
    }
    return undefined;
  }, [open]);

  const { data } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: async () => getNotifications({ data: {} }),
    enabled: !!user,
    refetchInterval: 30000,
  });
  const notifications = data ?? [];

  const readMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const urgentUnreadCount = notifications.filter(
    (n) => !n.isRead && n.priority === "urgent",
  ).length;

  const typeIcons = {
    info: <Info className="h-4 w-4 text-blue-500 shrink-0" />,
    warning: <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />,
    alert: <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />,
  };

  const markAllRead = () => {
    for (const n of notifications) {
      if (!n.isRead) void readMutation.mutateAsync({ data: { id: n.id } });
    }
  };

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        aria-label={unreadCount > 0 ? `Notifikasi, ${unreadCount} belum dibaca` : "Notifikasi"}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border bg-card text-muted-foreground shadow-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span
            className={`absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums shadow-sm ${urgentUnreadCount > 0 ? "bg-red-500 text-white animate-pulse" : "bg-destructive text-destructive-foreground"}`}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop — dim on mobile, invisible on desktop */}
          <button
            type="button"
            aria-label="Tutup notifikasi"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] sm:bg-transparent sm:backdrop-blur-none sm:pointer-events-none"
          />

          {/* Desktop: anchored dropdown */}
          <div className="hidden sm:block absolute right-0 top-11 z-50 w-96 rounded-xl border bg-card shadow-[0_8px_32px_rgba(0,0,0,0.12)] overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b bg-card px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold tracking-tight">Notifikasi</h3>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {unreadCount > 0 ? `${unreadCount} belum dibaca` : "Semua terbaca"}
                  {urgentUnreadCount > 0 ? ` • ${urgentUnreadCount} urgent` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="h-8 px-2.5 rounded-md text-xs font-medium hover:bg-muted transition-colors"
                  >
                    Tandai dibaca
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Tutup"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto overscroll-contain [scrollbar-width:thin]">
              {notifications.length === 0 ? (
                <div className="p-10 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <Bell className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-sm font-medium">Tidak ada notifikasi</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Semua terkendali. Cek lagi nanti.
                  </p>
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`group flex items-start gap-3 border-b p-3.5 pr-2 text-left transition-colors last:border-b-0 ${n.isRead ? "opacity-60 hover:opacity-100" : n.priority === "urgent" ? "bg-red-50/70 dark:bg-red-950/20 border-l-2 border-l-red-500" : "bg-muted/20 hover:bg-muted/40"}`}
                  >
                    <div className="mt-0.5">
                      {lookupLabel(typeIcons, n.type) ?? <Info className="h-4 w-4 shrink-0" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium leading-tight">{n.title}</p>
                        {n.priority === "urgent" && !n.isRead && (
                          <span className="inline-flex items-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold tracking-widest uppercase text-white">
                            Urgent
                          </span>
                        )}
                        {!n.isRead && (
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-primary shrink-0"
                            aria-hidden
                          />
                        )}
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground mt-1 line-clamp-3">
                        {n.message}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                        {new Date(n.createdAt).toLocaleString("id-ID", {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "2-digit",
                          month: "short",
                        })}
                      </p>
                    </div>
                    {!n.isRead ? (
                      <button
                        onClick={() => void readMutation.mutateAsync({ data: { id: n.id } })}
                        className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full bg-background border shadow-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground active:scale-95 transition-all"
                        title="Tandai dibaca"
                        aria-label="Tandai dibaca"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    ) : (
                      <span className="shrink-0 h-8 w-8" aria-hidden />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Mobile: bottom sheet */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Notifikasi"
            className="sm:hidden fixed inset-x-0 bottom-0 z-50 flex max-h-[78vh] flex-col rounded-t-2xl border-t bg-card shadow-[0_-8px_32px_rgba(0,0,0,0.16)] safe-bottom"
          >
            <div className="shrink-0 flex flex-col gap-3 border-b px-4 pb-3 pt-3">
              <div className="mx-auto h-1.5 w-10 rounded-full bg-muted" aria-hidden />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold tracking-tight">Notifikasi</h3>
                  <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                    {notifications.length} total • {unreadCount} belum dibaca
                    {urgentUnreadCount > 0 ? ` • ${urgentUnreadCount} urgent` : ""}
                  </p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Tutup"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border bg-background shadow-xs hover:bg-muted active:scale-95 transition-all shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="inline-flex h-9 w-full items-center justify-center rounded-xl border bg-background text-sm font-medium shadow-xs hover:bg-muted active:scale-[0.99] transition-all"
                >
                  Tandai semua dibaca ({unreadCount})
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
              {notifications.length === 0 ? (
                <div className="py-12 text-center px-4">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Bell className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-sm font-medium">Tidak ada notifikasi</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Semua terkendali. Tarik untuk menutup.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`flex items-start gap-3 rounded-xl border p-3.5 shadow-xs text-left ${n.isRead ? "bg-card opacity-70" : n.priority === "urgent" ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/30" : "bg-card border-border"}`}
                    >
                      <div className="mt-0.5">
                        {lookupLabel(typeIcons, n.type) ?? <Info className="h-4 w-4 shrink-0" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium leading-tight">{n.title}</p>
                          {n.priority === "urgent" && !n.isRead && (
                            <span className="inline-flex items-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold tracking-widest uppercase text-white">
                              Urgent
                            </span>
                          )}
                          {!n.isRead && (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground mt-1">
                          {n.message}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-2 tabular-nums">
                          {new Date(n.createdAt).toLocaleString("id-ID", {
                            hour: "2-digit",
                            minute: "2-digit",
                            day: "2-digit",
                            month: "short",
                          })}
                        </p>
                      </div>
                      {!n.isRead ? (
                        <button
                          onClick={() => void readMutation.mutateAsync({ data: { id: n.id } })}
                          className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm active:scale-95 transition-transform"
                          title="Tandai dibaca"
                          aria-label="Tandai dibaca"
                        >
                          <Check className="h-5 w-5" />
                        </button>
                      ) : (
                        <span className="shrink-0 h-11 w-11" aria-hidden />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
