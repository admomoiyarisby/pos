import { useState, useRef, useEffect } from "react";
import { Bell, Check, AlertTriangle, Info } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getNotifications, markNotificationRead } from "#/lib/server/system";
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
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { data } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const result = await getNotifications({ data: {} });
      return result as Notification[];
    },
    enabled: !!user,
    refetchInterval: 30000,
  });
  const notifications = data ?? [];

  const readMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const urgentUnreadCount = notifications.filter((n) => !n.isRead && n.priority === "urgent").length;

  const typeIcons = {
    info: <Info className="h-4 w-4 text-blue-500" />,
    warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    alert: <AlertTriangle className="h-4 w-4 text-red-500" />,
  };

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span
            className={`absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium ${
              urgentUnreadCount > 0
                ? "bg-red-500 text-white animate-pulse"
                : "bg-destructive text-destructive-foreground"
            }`}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-[calc(100vw-2rem)] sm:w-80 rounded-lg border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b p-3">
            <h3 className="text-sm font-semibold">Notifikasi</h3>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Tidak ada notifikasi
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 border-b p-3 transition-colors ${
                    n.isRead
                      ? "opacity-60"
                      : n.priority === "urgent"
                        ? "bg-red-50 border-l-2 border-l-red-500"
                        : "bg-muted/30"
                  }`}
                >
                  {typeIcons[n.type as keyof typeof typeIcons] ?? <Info className="h-4 w-4" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{n.title}</p>
                      {n.priority === "urgent" && !n.isRead && (
                        <span className="text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                          URGENT
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {new Date(n.createdAt).toLocaleString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "2-digit",
                        month: "short",
                      })}
                    </p>
                  </div>
                  {!n.isRead && (
                    <button
                      onClick={() => void readMutation.mutateAsync({ data: { id: n.id } })}
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
                      title="Tandai dibaca"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
