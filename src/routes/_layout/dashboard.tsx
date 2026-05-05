import { createFileRoute } from "@tanstack/react-router";
import RoleGuard from "#/components/RoleGuard";

export const Route = createFileRoute("/_layout/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Analytics & overview akan ditampilkan di sini.</p>
      </div>
    </RoleGuard>
  );
}
