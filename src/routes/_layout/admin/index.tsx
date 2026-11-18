import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { Button } from "#/components/ui/button";
import {
  getStockRecommendationSettings,
  updateStockRecommendationSettings,
} from "#/lib/server/stock-recommendation";
import {
  MAX_LEAD_TIME_DAYS,
  MIN_LEAD_TIME_DAYS,
  USAGE_WINDOW_DAYS,
} from "#/lib/stock-recommendation";

export const Route = createFileRoute("/_layout/admin/")({
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  usePageTitle("Pengaturan Sistem", "Konfigurasi Smart Reordering & pengaturan umum");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <ReorderingSettingsCard />
    </RoleGuard>
  );
}

function ReorderingSettingsCard() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["stock-recommendation-settings"],
    queryFn: () => getStockRecommendationSettings(),
    retry: 1,
  });

  // `null` means "not edited yet" so the input follows the fetched value
  // without an effect writing state on every render.
  const [editedLeadTime, setEditedLeadTime] = useState<string | null>(null);
  const leadTimeValue =
    editedLeadTime ?? (settingsQuery.data ? String(settingsQuery.data.leadTimeDays) : "");
  const parsedLeadTime = Number(leadTimeValue);
  const isValidLeadTime =
    Number.isInteger(parsedLeadTime) &&
    parsedLeadTime >= MIN_LEAD_TIME_DAYS &&
    parsedLeadTime <= MAX_LEAD_TIME_DAYS;

  const saveMutation = useMutation({
    mutationFn: updateStockRecommendationSettings,
    onSuccess: (result) => {
      setEditedLeadTime(String(result.leadTimeDays));
      void queryClient.invalidateQueries({ queryKey: ["stock-recommendation-settings"] });
      // Both inventory and procurement read this prefix; their target stock and
      // recommendation numbers must follow the saved horizon immediately.
      void queryClient.invalidateQueries({ queryKey: ["stock-recommendations"] });
      toast.success("Pengaturan disimpan");
    },
    onError: (error: Error) => {
      toast.error("Gagal menyimpan pengaturan", { description: error.message });
    },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidLeadTime) return;
    void saveMutation.mutateAsync({ data: { leadTimeDays: parsedLeadTime } });
  }

  return (
    <div className="max-w-lg">
      <div className="rounded-lg border p-4 space-y-3">
        <h2 className="font-semibold">Pemesanan Ulang Otomatis</h2>
        <p className="text-sm text-muted-foreground">
          Rumus perhitungan rekomendasi order otomatis
        </p>

        {settingsQuery.isError ? (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
            Gagal memuat pengaturan.{" "}
            <button
              type="button"
              onClick={() => {
                void settingsQuery.refetch();
              }}
              className="font-medium underline"
            >
              Coba lagi
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">(Rata-rata keluar ×</span>
              <input
                type="number"
                min={MIN_LEAD_TIME_DAYS}
                max={MAX_LEAD_TIME_DAYS}
                step={1}
                required
                aria-label="Hari acuan rekomendasi stok"
                disabled={settingsQuery.isPending || saveMutation.isPending}
                value={leadTimeValue}
                onChange={(e) => {
                  setEditedLeadTime(e.target.value);
                }}
                className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm text-center disabled:opacity-50"
              />
              <span className="text-sm">hari)</span>
              <Button
                type="submit"
                size="sm"
                disabled={!isValidLeadTime || settingsQuery.isPending || saveMutation.isPending}
                className="ml-auto"
              >
                {saveMutation.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>

            {!settingsQuery.isPending && !isValidLeadTime && (
              <p className="text-xs text-destructive">
                Isi angka bulat {MIN_LEAD_TIME_DAYS}–{MAX_LEAD_TIME_DAYS} hari.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Rata-rata keluar dihitung dari pemakaian {USAGE_WINDOW_DAYS} hari terakhir. Nilai ini
              menjadi acuan stok dan rekomendasi order di Inventori dan Pengadaan.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
