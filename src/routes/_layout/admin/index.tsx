import { createFileRoute } from "@tanstack/react-router";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";

export const Route = createFileRoute("/_layout/admin/")({
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  usePageTitle("Pengaturan Sistem", "Konfigurasi Smart Reordering & pengaturan umum");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <div className="max-w-lg">
        <div className="rounded-lg border p-4 space-y-3">
          <h2 className="font-semibold">Smart Reordering</h2>
          <p className="text-sm text-muted-foreground">
            Rumus perhitungan rekomendasi order otomatis
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm">(Rata-rata keluar ×</span>
            <input
              type="number"
              min={1}
              defaultValue={5}
              className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm text-center"
            />
            <span className="text-sm">hari)</span>
          </div>
        </div>
      </div>
    </RoleGuard>
  );
}
