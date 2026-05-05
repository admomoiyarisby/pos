import { createFileRoute } from "@tanstack/react-router";
import RoleGuard from "#/components/RoleGuard";

export const Route = createFileRoute("/_layout/stock-transfers/$trId")({
  component: TransferDetailPage,
});

function TransferDetailPage() {
  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div>
        <h1 className="text-2xl font-bold">Detail Mutasi Stok</h1>
        <p className="text-muted-foreground">
          Halaman detail mutasi stok akan ditampilkan di sini.
        </p>
      </div>
    </RoleGuard>
  );
}
