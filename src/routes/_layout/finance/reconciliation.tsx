import { createFileRoute } from "@tanstack/react-router";
import RoleGuard from "#/components/RoleGuard";

export const Route = createFileRoute("/_layout/finance/reconciliation")({
  component: ReconciliationPage,
});

function ReconciliationPage() {
  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <div>
        <h1 className="text-2xl font-bold">Rekonsiliasi</h1>
        <p className="text-muted-foreground">Rekonsiliasi keuangan akan ditampilkan di sini.</p>
      </div>
    </RoleGuard>
  );
}
