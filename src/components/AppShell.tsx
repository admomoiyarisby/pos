import { Outlet } from "@tanstack/react-router";
import Sidebar from "./Sidebar";
import NotificationBell from "./NotificationBell";
import ThemeToggle from "./ThemeToggle";
import { usePageTitleContext } from "./PageTitleProvider";
import type { UserRole } from "#/lib/auth-context";

export default function AppShell({ userRole }: { userRole: UserRole }) {
  const { state } = usePageTitleContext();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar userRole={userRole} />
      <main className="ml-64 flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            {state.title && <h1 className="text-xl font-bold tracking-tight">{state.title}</h1>}
            {state.description && (
              <p className="text-sm text-muted-foreground">{state.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <NotificationBell />
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
