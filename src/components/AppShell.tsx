import { Outlet } from "@tanstack/react-router";
import Sidebar from "./Sidebar";
import NotificationBell from "./NotificationBell";
import type { UserRole } from "#/lib/auth-context";

export default function AppShell({ userRole }: { userRole: UserRole }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar userRole={userRole} />
      <main className="ml-64 flex-1 p-6">
        <div className="flex items-center justify-between mb-4">
          <div />
          <NotificationBell />
        </div>
        <Outlet />
      </main>
    </div>
  );
}
