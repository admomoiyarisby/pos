import { createFileRoute } from "@tanstack/react-router";
import RoleGuard from "#/components/RoleGuard";

export const Route = createFileRoute("/_layout/analytics/sales")({
  component: AnalyticsSalesPage,
});

function AnalyticsSalesPage() {
  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <div>
        <h1 className="text-2xl font-bold">Laporan Penjualan</h1>
        <p className="text-muted-foreground">Laporan penjualan detail akan ditampilkan di sini.</p>
      </div>
    </RoleGuard>
  );
}
