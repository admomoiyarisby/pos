import { createFileRoute } from "@tanstack/react-router";
import RoleGuard from "#/components/RoleGuard";

export const Route = createFileRoute("/_layout/admin/")({
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Pengaturan Sistem</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Konfigurasi umum sistem POS & inventori
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border p-4 space-y-3">
            <h2 className="font-semibold">Pajak Restoran (PB1)</h2>
            <p className="text-sm text-muted-foreground">
              Toggle pajak restoran untuk semua transaksi
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="rounded border-gray-300" />
              <span className="text-sm">Aktifkan PB1 10%</span>
            </label>
          </div>

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

          <div className="rounded-lg border p-4 space-y-3">
            <h2 className="font-semibold">Struk POS</h2>
            <p className="text-sm text-muted-foreground">Konfigurasi header & footer struk</p>
            <div className="space-y-2">
              <input
                placeholder="Header struk"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                placeholder="Footer struk"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <h2 className="font-semibold">Periode Aktif</h2>
            <p className="text-sm text-muted-foreground">Status periode fiskal saat ini</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              Periode Mei 2026 — Terbuka
            </div>
          </div>
        </div>
      </div>
    </RoleGuard>
  );
}
