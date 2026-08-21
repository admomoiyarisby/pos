import { useState, useEffect } from "react";
import { Outlet } from "@tanstack/react-router";
import { Menu, PanelLeftClose, PanelLeft } from "lucide-react";
import Sidebar from "./Sidebar";
import NotificationBell from "./NotificationBell";
import ThemeToggle from "./ThemeToggle";
import { usePageTitleContext } from "./PageTitleProvider";
import type { UserRole } from "#/lib/auth-context";

export default function AppShell({
  userRole,
  userName,
}: {
  userRole: UserRole;
  userName?: string;
}) {
  const { state } = usePageTitleContext();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);

  useEffect(function () {
    try {
      const stored = localStorage.getItem("sidebar-collapsed");
      if (stored === "1") setDesktopCollapsed(true);
    } catch {}
  }, []);

  useEffect(
    function () {
      try {
        localStorage.setItem("sidebar-collapsed", desktopCollapsed ? "1" : "0");
      } catch {}
    },
    [desktopCollapsed],
  );

  function handleToggleSidebar() {
    // SAFETY: handler is only invoked on client click; window is guaranteed
    if (window.matchMedia("(min-width: 768px)").matches) {
      setDesktopCollapsed(function (v) {
        return !v;
      });
    } else {
      setMobileSidebarOpen(function (v) {
        return !v;
      });
    }
  }

  return (
    <div
      className="flex min-h-screen bg-background"
      style={
        // SAFETY: CSSProperties with custom property --sidebar-width needs assertion
        {
          // SAFETY: custom property --sidebar-width requires string key assertion
          ["--sidebar-width" as string]: desktopCollapsed ? "4rem" : "16rem",
        } as React.CSSProperties
      }
    >
      <Sidebar
        userRole={userRole}
        userName={userName}
        mobileOpen={mobileSidebarOpen}
        collapsed={desktopCollapsed}
        onClose={() => setMobileSidebarOpen(false)}
        onToggleCollapse={() =>
          setDesktopCollapsed(function (v) {
            return !v;
          })
        }
      />
      <main
        className={
          "flex flex-1 min-h-0 flex-col min-w-0 p-4 md:p-6 transition-all duration-200 " +
          (desktopCollapsed ? "md:ml-16" : "md:ml-64")
        }
      >
        <div
          data-impeccable-variants="346444d6"
          data-impeccable-variant-count="3"
          style={{ display: "contents" }}
        >
          {/* impeccable-variants-start 346444d6 */}
          {/* Original */}
          <div data-impeccable-variant="original">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={handleToggleSidebar}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-card hover:bg-accent transition-colors"
                  aria-label="Toggle sidebar"
                >
                  <Menu className="h-5 w-5 md:hidden" />
                  <span className="hidden md:inline-flex">
                    {desktopCollapsed ? (
                      <PanelLeft className="h-5 w-5" />
                    ) : (
                      <PanelLeftClose className="h-5 w-5" />
                    )}
                  </span>
                </button>
                <div className="min-w-0">
                  {state.title && (
                    <h1 className="text-xl font-bold tracking-tight truncate">{state.title}</h1>
                  )}
                  {state.description && (
                    <p className="text-sm text-muted-foreground truncate">{state.description}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ThemeToggle />
                <NotificationBell />
              </div>
            </div>
          </div>
          {/* Variants: insert below this line */}
          {/* impeccable-variants-end 346444d6 */}
        </div>
        <Outlet />
      </main>
    </div>
  );
}
