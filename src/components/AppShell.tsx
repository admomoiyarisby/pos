import { useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { Menu } from "lucide-react";
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

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        userRole={userRole}
        userName={userName}
        mobileOpen={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
      />
      <main className="flex-1 min-w-0 p-4 md:ml-64 md:p-6">
        <div
          data-impeccable-variants="346444d6"
          data-impeccable-variant-count="3"
          style={{ display: "contents" }}
        >
          {/* impeccable-variants-start 346444d6 */}
          {/* Original */}
          <div data-impeccable-variant="original">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMobileSidebarOpen(true)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border md:hidden"
                  aria-label="Buka menu navigasi"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div>
                  {state.title && (
                    <h1 className="text-xl font-bold tracking-tight">{state.title}</h1>
                  )}
                  {state.description && (
                    <p className="text-sm text-muted-foreground">{state.description}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
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
