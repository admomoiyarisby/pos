import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { useUnsavedDraft } from "#/hooks/useUnsavedDraft";
const statusColors = {
  Submitted: "default",
  Approved: "success",
  "Under Investigation": "warning",
} satisfies Record<string, "default" | "warning" | "success">;

export const Route = createFileRoute("/_layout/stock-opname/$soId")({
  component: StockOpnameDetailPage,
  loader: async ({ params }) => {
    const detail = await getStockOpnameDetail({ data: { id: params.soId } });
    return { detail };
  },
});

interface StockOpnameDraft {
  physicalInputs: Record<string, string>;
  touchedItems: string[];
}

function StockOpnameDetailPage() {
  const { user } = useAuth();
  const { detail: initial } = Route.useLoaderData();
  const { soId } = Route.useParams();
  const queryClient = useQueryClient();
  const cacheKey = `so-edit-${soId}`;
  const initialDraft: StockOpnameDraft = {
    // SAFETY: empty collections are seeded as the starting draft value; the
    // shape is pinned by the named StockOpnameDraft contract below.
    physicalInputs: {} as Record<string, string>,
    // SAFETY: same — the empty array is the fresh-draft seed.
    touchedItems: [] as string[],
  };
  const {
    state: draft,
    setState: setDraft,
    clear: clearDraft,
  } = useUnsavedDraft(cacheKey, initialDraft, {
    restoreMode: "silent",
    isDirty: (s) => Object.keys(s.physicalInputs).length > 0 || s.touchedItems.length > 0,
  });
  const physicalInputs = draft.physicalInputs;
  const touchedItems = draft.touchedItems;
  const [investigationNote, setInvestigationNote] = useState("");
  const [approveModal, setApproveModal] = useState(false);
  const [investigationModal, setInvestigationModal] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const { data: detail } = useQuery({
    queryKey: ["stock-opname", soId],
    queryFn: () => getStockOpnameDetail({ data: { id: soId } }),
    initialData: initial,
  });

  const submitMutation = useMutation({
    mutationFn: submitStockOpname,
    onSuccess: () => {
      clearDraft();
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
      clearDraft();
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
      clearDraft();
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
      clearDraft();
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
  // Supervisors can run the full flow themselves (trigger → count → submit →
  // approve). Without this, a super_admin/area_manager filling counts would have
  // no way to persist them before approving, and approve would apply zeros.
  const canSubmit =
    (detail.status === "Submitted" || detail.status === "Under Investigation") &&
    ["branch_admin", "super_admin", "area_manager"].includes(user?.role ?? "");
  const canUpdate =
    detail.status === "Under Investigation" &&
    (user?.role === "branch_admin" || ["super_admin", "area_manager"].includes(user?.role ?? ""));
  const canMarkInvestigation =
    detail.status === "Submitted" && ["super_admin", "area_manager"].includes(user?.role ?? "");

  const today = new Date();
  const is25th = today.getDate() === 25;
  const canRealize =
    is25th &&
    ["super_admin", "admin_pusat"].includes(user?.role ?? "") &&
    detail.status === "Approved" &&
    !detail.realizedAt;

  const handleInputChange = (itemId: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      physicalInputs: { ...prev.physicalInputs, [itemId]: value },
      touchedItems: prev.touchedItems.includes(itemId)
        ? prev.touchedItems
        : [...prev.touchedItems, itemId],
    }));
  };

  const buildItems = () => {
    const missingItems = detail.items.filter((item: any) => physicalInputs[item.id] === undefined);
    if (missingItems.length > 0) {
      setSubmitError(
        `Masih ada ${missingItems.length} item yang belum diisi. Semua item wajib diisi sebelum submit.`,
      );
      return null;
    }
    const items = detail.items.map((item: any) => ({
      itemId: item.id,
      physicalStock: Number(physicalInputs[item.id]),
    }));
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

  const handleDebugFill = () => {
    const newInputs: Record<string, string> = {};
    const newTouched: string[] = [];
    for (const item of detail.items) {
      const maxStock = Math.max(item.systemStock * 2, 100);
      const physicalStock = Math.floor(Math.random() * maxStock);
      newInputs[item.id] = String(physicalStock);
      newTouched.push(item.id);
    }
    setDraft({ physicalInputs: newInputs, touchedItems: newTouched });
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

  const filledCount = Object.keys(physicalInputs).filter(
    (k) => physicalInputs[k] !== "" && physicalInputs[k] !== undefined,
  ).length;
  const totalCount = detail.items.length;
  const progressPct = totalCount ? Math.round((filledCount / totalCount) * 100) : 0;

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
      <div className="space-y-4">
        {/* Header card — stacked on mobile */}
        <div className="rounded-xl border bg-card p-3.5 sm:p-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
                Opname Stok
              </div>
              <div className="text-sm font-semibold truncate">
                {detail.date} · {detail.branchName}
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden sm:hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums sm:hidden">
                {filledCount}/{totalCount} terisi • {progressPct}%
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <Badge
                variant={statusColors[detail.status] ?? "default"}
                className="rounded-full px-3 py-1 text-xs"
              >
                {detail.status === "Under Investigation" ? "Investigasi" : detail.status}
              </Badge>
              {isBlind && (
                <Badge variant="outline" className="rounded-full text-[11px]">
                  Blind SO
                </Badge>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
              <span>
                {filledCount}/{totalCount} terisi
              </span>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
              <span>{progressPct}%</span>
              <div className="ml-2 h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const result = await printStockOpname({ data: { soId } });
                  openPrintWindow(result.html);
                } catch (err) {
                  toast.error("Gagal mencetak", {
                    description: err instanceof Error ? err.message : String(err),
                  });
                }
              }}
              className="inline-flex items-center justify-center h-8 px-3 rounded-lg sm:rounded-md border bg-background text-xs font-medium hover:bg-muted transition-colors shrink-0"
            >
              Cetak PDF
            </button>
          </div>
        </div>

        {submitError && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {submitError}
          </div>
        )}

        {/* Mobile cards */}
        <div className="md:hidden space-y-2.5 -mx-4 px-4">
          {detail.items.map((item: any, idx: number) => {
            const inputValue =
              physicalInputs[item.id] ?? (item.physicalStock > 0 ? String(item.physicalStock) : "");
            const variance = !isBlind ? Number(inputValue || 0) - item.systemStock : 0;
            const hasVariance = !isBlind && inputValue !== "" && variance !== 0;
            const isEmpty = inputValue === "";
            const isTouched = touchedItems.includes(item.id);
            return (
              <div
                key={item.id}
                className={`rounded-xl border bg-card p-3.5 shadow-xs ${hasVariance ? "border-warning/30 bg-warning/5" : ""} ${isEmpty && detail.status !== "Approved" ? "ring-1 ring-warning/20" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                        {idx + 1}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground truncate">
                        {item.ingredientCode}
                      </span>
                      {!isBlind && hasVariance && (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${variance > 0 ? "bg-success/15 text-success-foreground" : "bg-destructive/10 text-destructive"}`}
                        >
                          {variance > 0
                            ? `+${variance.toLocaleString("id-ID")}`
                            : variance.toLocaleString("id-ID")}
                        </span>
                      )}
                    </div>
                    <div className="font-medium text-sm truncate mt-1">{item.ingredientName}</div>
                    {!isBlind && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Sistem:{" "}
                        <span className="font-mono font-medium text-foreground">
                          {item.systemStock.toLocaleString("id-ID")}
                        </span>
                      </div>
                    )}
                  </div>
                  {isTouched && (
                    <span
                      className="shrink-0 h-2 w-2 rounded-full bg-success mt-1"
                      aria-label="terisi"
                    />
                  )}
                </div>
                <div className="mt-3">
                  <label className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                    Stok Fisik
                  </label>
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
                          document.querySelectorAll<HTMLInputElement>("input[inputmode='numeric']"),
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
                    placeholder="0"
                    className={cn(
                      "mt-1 h-12 w-full rounded-xl border bg-background px-3 text-base font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                      !isTouched && detail.status !== "Approved"
                        ? "border-warning/40 bg-warning/10"
                        : "border-input",
                    )}
                  />
                </div>
              </div>
            );
          })}
          {detail.items.length === 0 && (
            <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              Tidak ada item
            </div>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block rounded-md border overflow-x-auto">
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
                const variance = !isBlind ? Number(inputValue || 0) - item.systemStock : 0;
                const hasVariance = !isBlind && inputValue !== "" && variance !== 0;
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
                          !touchedItems.includes(item.id) && detail.status !== "Approved"
                            ? "border-warning/40 bg-warning/10"
                            : "border-input",
                        )}
                      />
                    </td>
                    {!isBlind && (
                      <td
                        className={`px-4 py-3 text-right font-medium ${variance > 0 ? "text-success-foreground" : variance < 0 ? "text-destructive" : ""}`}
                      >
                        {inputValue !== ""
                          ? `${variance > 0 ? "+" : ""}${variance.toLocaleString("id-ID")}`
                          : "—"}
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

        {detail.investigationNote && (
          <div className="rounded-xl bg-warning/10 border border-warning/20 p-4">
            <p className="text-sm font-medium text-warning-foreground mb-1">Catatan Investigasi</p>
            <p className="text-sm text-warning-foreground/80">{detail.investigationNote}</p>
          </div>
        )}

        {detail.items.some((item: any) => item.isNasi) && (
          <div className="rounded-xl border bg-blue-50/50 p-4 shadow-xs">
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
                        <div
                          key={conv.ingredientName}
                          className="text-xs rounded-lg bg-background border px-2.5 py-2"
                        >
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

        {/* Actions — sticky on mobile */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sticky bottom-0 bg-background -mx-4 px-4 sm:mx-0 sm:px-0 py-3 sm:py-0 border-t sm:border-0 z-10 safe-bottom">
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            {canSubmit && (
              <button
                onClick={handleSubmit}
                disabled={submitMutation.isPending}
                className="inline-flex items-center justify-center h-11 sm:h-10 px-6 rounded-xl sm:rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 w-full sm:w-auto shadow-sm"
              >
                {submitMutation.isPending ? "Menyimpan..." : "Simpan Opname"}
              </button>
            )}
            {canUpdate && (
              <button
                onClick={handleUpdateCounts}
                disabled={updateCountsMutation.isPending}
                className="inline-flex items-center justify-center h-11 sm:h-10 px-4 rounded-xl sm:rounded-md bg-warning text-warning-foreground text-sm font-medium hover:bg-warning/90 disabled:opacity-50 w-full sm:w-auto"
              >
                {updateCountsMutation.isPending ? "Memperbarui..." : "Perbarui Hitungan"}
              </button>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:justify-end">
            {canMarkInvestigation && (
              <button
                onClick={() => setInvestigationModal(true)}
                className="inline-flex items-center justify-center h-11 sm:h-10 px-4 rounded-xl sm:rounded-md bg-warning text-warning-foreground text-sm font-medium hover:bg-warning/90 w-full sm:w-auto"
              >
                Tandai Investigasi
              </button>
            )}
            {canApprove && detail.status !== "Approved" && (
              <button
                onClick={() => setApproveModal(true)}
                className="inline-flex items-center justify-center h-11 sm:h-10 px-4 rounded-xl sm:rounded-md bg-primary text-primary-foreground text-sm font-medium w-full sm:w-auto shadow-sm"
              >
                Setujui & Sesuaikan
              </button>
            )}
            {canRealize && (
              <button
                onClick={() => setRealizeModal(true)}
                disabled={realizeMutation.isPending}
                className="inline-flex items-center justify-center h-11 sm:h-10 px-4 rounded-xl sm:rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 w-full sm:w-auto"
              >
                {realizeMutation.isPending ? "Memproses..." : "Realize SO"}
              </button>
            )}
          </div>
          {detail.realizedAt && (
            <div className="text-xs text-muted-foreground text-center sm:text-right w-full sm:w-auto">
              Di-realize pada {new Date(detail.realizedAt).toLocaleString("id-ID")}
            </div>
          )}
          {isDev && canSubmit && (
            <button
              onClick={handleDebugFill}
              className="inline-flex items-center justify-center h-11 sm:h-10 px-4 rounded-xl sm:rounded-md bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 w-full sm:w-auto sm:ml-2"
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
