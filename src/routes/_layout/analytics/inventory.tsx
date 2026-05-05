import { createFileRoute } from "@tanstack/react-router";
import RoleGuard from "#/components/RoleGuard";

export const Route = createFileRoute("/_layout/analytics/inventory")({
  component: AnalyticsInventoryPage,
});

function AnalyticsInventoryPage() {
  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <div>
        <h1 className="text-2xl font-bold">Laporan Inventaris</h1>
        <p className="text-muted-foreground">
          Laporan inventaris & audit akan ditampilkan di sini.
        </p>
      </div>
    </RoleGuard>
  );
}
