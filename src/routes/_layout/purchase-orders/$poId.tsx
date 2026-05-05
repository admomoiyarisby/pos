import { createFileRoute } from "@tanstack/react-router";
import RoleGuard from "#/components/RoleGuard";

export const Route = createFileRoute("/_layout/purchase-orders/$poId")({
  component: PODetailPage,
});

function PODetailPage() {
  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <div>
        <h1 className="text-2xl font-bold">Detail Purchase Order</h1>
        <p className="text-muted-foreground">Halaman detail PO akan ditampilkan di sini.</p>
      </div>
    </RoleGuard>
  );
}
