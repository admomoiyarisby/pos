import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import Modal from "#/components/ui/Modal";
import {
  getStockOpnameDetail,
  submitStockOpname,
  approveStockOpname,
  updateStockOpnameCounts,
  markStockOpnameInvestigation,
  realizeStockOpname,
  printStockOpname,
} from "#/lib/server/inventory";
import { Badge } from "#/components/ui/badge";
import { openPrintWindow } from "#/lib/print-window";
import { cn } from "#/lib/utils";
import { toast } from "sonner";
import { calculateNasiConversion } from "#/lib/server/nasi-conversion";
import { usePageTitle } from "#/hooks/usePageTitle";

function loadSoCache(key: string) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as { physicalInputs: Record<string, string>; touchedItems: string[] };
  } catch {
    return null;
  }
}

function saveSoCache(key: string, physicalInputs: Record<string, string>, touchedItems: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify({ physicalInputs, touchedItems }));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

function clearSoCache(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

const statusColors: Record<string, "default" | "warning" | "success"> = {
  Submitted: "default",
  Approved: "success",
  "Under Investigation": "warning",
};

export const Route = createFileRoute("/_layout/stock-opname/$soId")({
  component: StockOpnameDetailPage,
  loader: async ({ params }) => {
    const detail = await getStockOpnameDetail({ data: { id: params.soId } });
    return { detail };
  },
});

function StockOpnameDetailPage() {
  const { user } = useAuth();
  const { detail: initial } = Route.useLoaderData();
  const { soId } = Route.useParams();
  const queryClient = useQueryClient();
  const cacheKey = `so-edit-${soId}`;
  const cached = loadSoCache(cacheKey);
  const [physicalInputs, setPhysicalInputs] = useState<Record<string, string>>(
    cached?.physicalInputs ?? {},
  );
  const [touchedItems, setTouchedItems] = useState<Set<string>>(
    () => new Set(cached?.touchedItems ?? []),
  );
  const [investigationNote, setInvestigationNote] = useState("");
  const [approveModal, setApproveModal] = useState(false);
  const [investigationModal, setInvestigationModal] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Debounced save edit state to localStorage
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveSoCache(cacheKey, physicalInputs, [...touchedItems]);
    }, 300);
    return () => clearTimeout(saveTimer.current);
  }, [cacheKey, physicalInputs, touchedItems]);

  const { data: detail } = useQuery({
    queryKey: ["stock-opname", soId],
    queryFn: () => getStockOpnameDetail({ data: { id: soId } }),
    initialData: initial,
  });

  const submitMutation = useMutation({
    mutationFn: submitStockOpname,
    onSuccess: () => {
      clearSoCache(`so-edit-${soId}`);
      void queryClient.invalidateQueries({ queryKey: ["stock-opname", soId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
      setSubmitError("");
      toast.success("Stock opname berhasil disubmit");
    },
    onError: (error) => {
      toast.error("Gagal submit stock opname", { description: error.message });
    },
  });

  const approveMutation = useMutation({
    mutationFn: approveStockOpname,
    onSuccess: () => {
      clearSoCache(cacheKey);
      void queryClient.invalidateQueries({ queryKey: ["stock-opname", soId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
      setApproveModal(false);
      toast.success("Stock opname berhasil diapprove");
    },
    onError: (error) => {
      toast.error("Gagal approve stock opname", { description: error.message });
    },
  });

  const updateCountsMutation = useMutation({
    mutationFn: updateStockOpnameCounts,
    onSuccess: () => {
      clearSoCache(cacheKey);
      void queryClient.invalidateQueries({ queryKey: ["stock-opname", soId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
      setSubmitError("");
      toast.success("Hitungan berhasil diperbarui");
    },
    onError: (error) => {
      toast.error("Gagal memperbarui hitungan", { description: error.message });
    },
  });

  const markInvestigationMutation = useMutation({
    mutationFn: markStockOpnameInvestigation,
    onSuccess: () => {
      clearSoCache(cacheKey);
      void queryClient.invalidateQueries({ queryKey: ["stock-opname", soId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
      setInvestigationModal(false);
      setInvestigationNote("");
      toast.success("SO ditandai Under Investigation");
    },
    onError: (error) => {
      toast.error("Gagal menandai investigasi", { description: error.message });
    },
  });

  // ID12: Realize SO mutation
  const realizeMutation = useMutation({
    mutationFn: realizeStockOpname,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["stock-opname", soId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
      toast.success(`Stock opname berhasil di-realize. ${result.itemsAdjusted} item disesuaikan.`);
    },
    onError: (error) => {
      toast.error("Gagal realize stock opname", { description: error.message });
    },
  });

  if (!detail) {
    return <div className="text-muted-foreground">Stock opname tidak ditemukan</div>;
  }

  const isBlind = detail.isBlind;
  const canApprove =
    ["super_admin", "area_manager"].includes(user?.role ?? "") && detail.status !== "Approved";
  const canSubmit =
    (detail.status === "Submitted" || detail.status === "Under Investigation") &&
    user?.role === "branch_admin";
  const canUpdate =
    detail.status === "Under Investigation" &&
    (user?.role === "branch_admin" || ["super_admin", "area_manager"].includes(user?.role ?? ""));
  const canMarkInvestigation =
    detail.status === "Submitted" && ["super_admin", "area_manager"].includes(user?.role ?? "");

  // ID12: Can realize SO only on 25th, for admin_pusat/super_admin, when status is Approved
  const today = new Date();
  const is25th = today.getDate() === 25;
  const canRealize =
    is25th &&
    ["super_admin", "admin_pusat"].includes(user?.role ?? "") &&
    detail.status === "Approved" &&
    !detail.realizedAt;

  const handleInputChange = (itemId: string, value: string) => {
    setPhysicalInputs((prev) => ({ ...prev, [itemId]: value }));
    setTouchedItems((prev) => new Set(prev).add(itemId));
  };

  const buildItems = () => {
    // 1. Check that EVERY item has an explicit entry in physicalInputs
    const missingItems = detail.items.filter((item: any) => physicalInputs[item.id] === undefined);
    if (missingItems.length > 0) {
      setSubmitError(
        `Masih ada ${missingItems.length} item yang belum diisi. Semua item wajib diisi sebelum submit.`,
      );
      return null;
    }

    // 2. Build payload only from explicitly entered values
    const items = detail.items.map((item: any) => ({
      itemId: item.id,
      physicalStock: Number(physicalInputs[item.id]),
    }));

    // 3. Validate all values are valid non-negative numbers
    const hasInvalid = items.some((i) => isNaN(i.physicalStock) || i.physicalStock < 0);
    if (hasInvalid) {
      setSubmitError("Stok fisik tidak valid. Pastikan semua nilai adalah angka non-negatif.");
      return null;
    }

    return items;
  };

  const handleSubmit = () => {
    const items = buildItems();
    if (!items) return;
    setSubmitError("");
    void submitMutation.mutateAsync({ data: { soId, items } });
  };

  const handleUpdateCounts = () => {
    const items = buildItems();
    if (!items) return;
    setSubmitError("");
    void updateCountsMutation.mutateAsync({ data: { soId, items } });
  };

  const handleApprove = () => {
    void approveMutation.mutateAsync({
      data: { soId, investigationNote },
    });
  };

  // Dev-only: auto-fill stock numbers for testing
  const handleDebugFill = () => {
    const newInputs: Record<string, string> = {};
    const newTouched = new Set<string>();
    for (const item of detail.items) {
      // Generate truly random positive number (0 to 2x system stock)
      const maxStock = Math.max(item.systemStock * 2, 100);
      const physicalStock = Math.floor(Math.random() * maxStock);
      newInputs[item.id] = String(physicalStock);
      newTouched.add(item.id);
    }
    setPhysicalInputs(newInputs);
    setTouchedItems(newTouched);
    toast.info("Debug: Angka stok diisi secara random");
  };

  const isDev = import.meta.env.DEV;
  const [realizeModal, setRealizeModal] = useState(false);

  usePageTitle("Opname Stok", `${detail.date} · ${detail.branchName}`);

  const handleMarkInvestigation = () => {
    void markInvestigationMutation.mutateAsync({
      data: { soId, investigationNote },
    });
  };

  return (
    <RoleGuard
      allowedRoles={[
        "super_admin",
        "admin_pusat",
        "area_manager",
        "branch_admin",
        "central_kitchen",
      ]}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              Tanggal: {detail.date} · Cabang: {detail.branchName}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={statusColors[detail.status] ?? "default"}>
              {detail.status === "Under Investigation" ? "Investigasi" : detail.status}
            </Badge>
            {isBlind && <Badge variant="outline">Blind SO</Badge>}
            <button
              type="button"
              onClick={async () => {
                try {
                  const result = await printStockOpname({ data: { soId } });
                  openPrintWindow(result.html);
                } catch (err) {
                  toast.error("Gagal mencetak", { description: (err as Error).message });
                }
              }}
              className="h-8 px-3 rounded-md border text-xs font-medium hover:bg-muted transition-colors"
            >
              Cetak PDF
            </button>
          </div>
        </div>

        {submitError && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {submitError}
          </div>
        )}

        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">No</th>
                <th className="px-4 py-3 text-left font-medium">Kode</th>
                <th className="px-4 py-3 text-left font-medium">Nama Item</th>
                {!isBlind && <th className="px-4 py-3 text-right font-medium">Stok Sistem</th>}
                <th className="px-4 py-3 text-right font-medium">Stok Fisik</th>
                {!isBlind && <th className="px-4 py-3 text-right font-medium">Selisih</th>}
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item: any, idx: number) => {
                const inputValue =
                  physicalInputs[item.id] ??
                  (item.physicalStock > 0 ? String(item.physicalStock) : "");
                const variance = !isBlind ? Number(inputValue) - item.systemStock : 0;
                const hasVariance = !isBlind && variance !== 0;

                return (
                  <tr key={item.id} className={`border-b ${hasVariance ? "bg-warning/10" : ""}`}>
                    <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.ingredientCode}</td>
                    <td className="px-4 py-3">{item.ingredientName}</td>
                    {!isBlind && (
                      <td className="px-4 py-3 text-right">
                        {item.systemStock.toLocaleString("id-ID")}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={inputValue}
                        onChange={(e) => handleInputChange(item.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const inputs = Array.from(
                              document.querySelectorAll<HTMLInputElement>(
                                "input[inputmode='numeric']",
                              ),
                            );
                            const currentIdx = inputs.indexOf(e.currentTarget);
                            if (currentIdx < inputs.length - 1) {
                              inputs[currentIdx + 1].focus();
                              inputs[currentIdx + 1].select();
                            }
                          }
                        }}
                        disabled={detail.status === "Approved"}
                        aria-label={`${item.ingredientName} stok fisik`}
                        className={cn(
                          "h-8 w-24 rounded-md border bg-background px-2 text-sm text-right disabled:opacity-50",
                          !touchedItems.has(item.id) && detail.status !== "Approved"
                            ? "border-warning/40 bg-warning/10"
                            : "border-input",
                        )}
                      />
                    </td>
                    {!isBlind && (
                      <td
                        className={`px-4 py-3 text-right font-medium ${variance > 0 ? "text-success-foreground" : variance < 0 ? "text-destructive" : ""}`}
                      >
                        {variance > 0 ? "+" : ""}
                        {variance.toLocaleString("id-ID")}
                      </td>
                    )}
                  </tr>
                );
              })}
              {detail.items.length === 0 && (
                <tr>
                  <td colSpan={isBlind ? 4 : 6} className="h-24 text-center text-muted-foreground">
                    Tidak ada item
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Investigation Note (if exists) */}
        {detail.investigationNote && (
          <div className="rounded-md bg-warning/10 border border-warning/20 p-4">
            <p className="text-sm font-medium text-warning-foreground mb-1">Catatan Investigasi</p>
            <p className="text-sm text-warning-foreground/80">{detail.investigationNote}</p>
          </div>
        )}

        {/* Nasi Conversion Display */}
        {detail.items.some((item: any) => item.isNasi) && (
          <div className="rounded-md border bg-blue-50/50 p-4">
            <p className="text-sm font-medium mb-2">Konversi Nasi Putih → Bahan Baku</p>
            <p className="text-xs text-muted-foreground mb-3">
              Stok fisik Nasi akan dikonversi ke bahan baku saat Realize SO.
            </p>
            {detail.items
              .filter((item: any) => item.isNasi)
              .map((item: any) => {
                const portions = physicalInputs[item.id] ?? String(item.physicalStock);
                const numPortions = Number(portions) || 0;
                const conversions = calculateNasiConversion(numPortions);
                return (
                  <div key={item.id} className="space-y-2">
                    <div className="text-sm font-medium">{numPortions} porsi Nasi Putih</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {conversions.map((conv) => (
                        <div key={conv.ingredientName} className="text-xs">
                          <span className="text-muted-foreground">{conv.ingredientName}:</span>
                          <span className="ml-1 font-medium">
                            {conv.totalAmount.toLocaleString("id-ID")} {conv.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-3">
          {canSubmit && (
            <button
              onClick={handleSubmit}
              disabled={submitMutation.isPending}
              className="h-10 px-6 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {submitMutation.isPending ? "Menyimpan..." : "Simpan Opname"}
            </button>
          )}

          {canMarkInvestigation && (
            <button
              onClick={() => setInvestigationModal(true)}
              className="h-8 px-3 rounded-md bg-warning text-warning-foreground text-xs font-medium hover:bg-warning/90"
            >
              Tandai Investigasi
            </button>
          )}

          {canUpdate && (
            <button
              onClick={handleUpdateCounts}
              disabled={updateCountsMutation.isPending}
              className="h-8 px-3 rounded-md bg-warning text-warning-foreground text-xs font-medium hover:bg-warning/90 disabled:opacity-50"
            >
              {updateCountsMutation.isPending ? "Memperbarui..." : "Perbarui Hitungan"}
            </button>
          )}

          {canApprove && detail.status !== "Approved" && (
            <button
              onClick={() => setApproveModal(true)}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium"
            >
              Setujui & Sesuaikan
            </button>
          )}

          {/* ID12: Realize SO button - only on 25th for admin_pusat/super_admin */}
          {canRealize && (
            <button
              onClick={() => setRealizeModal(true)}
              disabled={realizeMutation.isPending}
              className="h-8 px-3 rounded-md bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {realizeMutation.isPending ? "Memproses..." : "Realize SO"}
            </button>
          )}

          {/* Show info when SO is already realized */}
          {detail.realizedAt && (
            <div className="text-sm text-muted-foreground">
              Di-realize pada {new Date(detail.realizedAt).toLocaleString("id-ID")}
            </div>
          )}

          {isDev && canSubmit && (
            <button
              onClick={handleDebugFill}
              className="h-10 px-4 rounded-md bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 ml-auto"
              title="Dev only: Auto-fill with random variance"
            >
              🐛 Debug Fill
            </button>
          )}
        </div>
      </div>

      <Modal open={approveModal} onClose={() => setApproveModal(false)} title="Setujui Opname Stok">
        <div className="space-y-4">
          <div className="rounded-md bg-warning/10 p-3 text-sm text-warning-foreground">
            <p className="font-medium">Perhatian</p>
            <p>Approval akan menyesuaikan stok sistem ke stok fisik dan membuat jurnal ledger.</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Catatan Investigasi (opsional)</label>
            <textarea
              value={investigationNote}
              onChange={(e) => setInvestigationNote(e.target.value)}
              placeholder="Alasan selisih..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setApproveModal(false)}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {approveMutation.isPending ? "Memproses..." : "Approve"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={investigationModal}
        onClose={() => setInvestigationModal(false)}
        title="Tandai Investigasi"
      >
        <div className="space-y-4">
          <div className="rounded-md bg-info/10 p-3 text-sm text-info-foreground">
            <p className="font-medium">Informasi</p>
            <p>
              SO akan ditandai sebagai Under Investigation. Branch Admin akan diminta untuk
              menghitung ulang.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Catatan Investigasi</label>
            <textarea
              value={investigationNote}
              onChange={(e) => setInvestigationNote(e.target.value)}
              placeholder="Jelaskan mengapa hitung ulang diperlukan..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setInvestigationModal(false)}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              onClick={handleMarkInvestigation}
              disabled={markInvestigationMutation.isPending || !investigationNote}
              className="h-9 px-4 rounded-md bg-amber-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {markInvestigationMutation.isPending ? "Memproses..." : "Tandai Investigasi"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={realizeModal}
        onClose={() => setRealizeModal(false)}
        title="Realize Stock Opname"
      >
        <div className="space-y-4">
          <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
            <p className="font-medium">Konfirmasi Realisasi</p>
            <p className="mt-1">
              Stok fisik akan disetel sebagai stok baru. Selisih akan dibuatkan jurnal ledger.
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            <p>
              Tanggal: <span className="font-medium text-foreground">{detail.date}</span>
            </p>
            <p>
              Cabang: <span className="font-medium text-foreground">{detail.branchName}</span>
            </p>
            <p className="mt-2 text-xs">
              Aksi ini tidak dapat dibatalkan. Hanya dapat dilakukan pada tanggal 25.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setRealizeModal(false)}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              onClick={() => {
                void realizeMutation.mutateAsync({ data: { soId } });
                setRealizeModal(false);
              }}
              disabled={realizeMutation.isPending}
              className="h-9 px-4 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {realizeMutation.isPending ? "Memproses..." : "Ya, Realize"}
            </button>
          </div>
        </div>
      </Modal>
    </RoleGuard>
  );
}
