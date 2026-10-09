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
import { cn, formatQuantity, parseQuantityInput, roundQuantity } from "#/lib/utils";
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

  // ADR 0021: the opname's OWN date decides whether it can ever touch stock —
  // only the 25th. And the date identifies a monthly CYCLE: a 25th opname can
  // be realized any day within that month (count continuously, realize early),
  // but not before its month starts. Mirrors the server guard exactly so the
  // button never shows for an opname the server would refuse.
  const soDay = Number.parseInt(String(detail?.date ?? "").slice(8, 10), 10);
  const soIs25th = soDay === 25;
  const soCycle = String(detail?.date ?? "").slice(0, 7); // YYYY-MM
  const currentCycle = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const soCycleOpen = soCycle !== "" && soCycle <= currentCycle;

  const submitMutation = useMutation({
    mutationFn: submitStockOpname,
    onSuccess: (result) => {
      clearDraft();
      void queryClient.invalidateQueries({ queryKey: ["stock-opname", soId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
      setSubmitError("");
      toast.success("Stock opname berhasil disubmit", {
        description: `${result.counted} item dihitung — item yang tidak diisi tidak mengubah stok.`,
      });
    },
    onError: (error) => {
      toast.error("Gagal submit stock opname", { description: error.message });
    },
  });

  const approveMutation = useMutation({
    mutationFn: approveStockOpname,
    onSuccess: (result) => {
      clearDraft();
      void queryClient.invalidateQueries({ queryKey: ["stock-opname", soId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
      setApproveModal(false);
      // ADR 0021: approve no longer touches stock. The counts become a signed
      // note. Whether they can EVER be applied depends on the opname's date:
      // only the 25th gets a realize (once its month is open); anything else
      // is a note permanently.
      const changed = result.changes.filter((c) => c.delta !== 0).length;
      toast.success("Stock opname disetujui", {
        description: !soIs25th
          ? `${changed} item tercatat sebagai selisih. Opname di luar tanggal 25 hanya catatan — stok tidak akan berubah.`
          : soCycleOpen
            ? `${changed} item tercatat sebagai selisih. Stok belum berubah — perubahan diterapkan saat Realize.`
            : `${changed} item tercatat sebagai selisih. Stok belum berubah — Realize terbuka mulai periode ${soCycle}.`,
      });
      if (result.drift.length > 0) {
        toast.warning("Stok bergerak sejak SO dibuat", {
          description: `${result.drift.length} item memiliki stok berbeda dari snapshot SO — penyesuaian dihitung dari stok aktual, bukan snapshot.`,
        });
      }
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

  // ADR 0021: realize is gated on the OPNAME's own date, not today's date. An
  // SO dated the 25th is the monthly baseline — the only SO that moves stock —
  // and it becomes realizable once its calendar month opens.
  const canRealize =
    soIs25th &&
    soCycleOpen &&
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

  // Partial opname: only the fields the counter actually filled are sent.
  // Unfilled items keep their stock unchanged on realize — but at
  // least one field must be filled, otherwise submitting is pointless.
  const buildItems = () => {
    const filled = detail.items
      .filter((item: any) => {
        const raw = physicalInputs[item.id];
        return raw !== undefined && raw !== "";
      })
      .map((item: any) => ({
        itemId: item.id,
        // null for a half-typed value ("23,") as well as for junk — both mean
        // "not a usable count yet", so the counter is told to finish typing
        // rather than shown a generic invalid error.
        counted: parseQuantityInput(physicalInputs[item.id] ?? ""),
      }));
    if (filled.length === 0) {
      setSubmitError(
        "Belum ada stok fisik yang diisi. Isi minimal satu item — item yang dikosongkan tidak akan mengubah stok.",
      );
      return null;
    }
    const hasInvalid = filled.some((f) => f.counted === null || f.counted < 0);
    if (hasInvalid) {
      setSubmitError(
        "Stok fisik tidak valid. Isi angka non-negatif; boleh pecahan, pakai koma untuk desimal (misal 23,5).",
      );
      return null;
    }
    // `counted` is non-null for every row here (checked above); the ?? 0 keeps
    // the type honest without an assertion.
    return filled.map((f) => ({ itemId: f.itemId, physicalStock: f.counted ?? 0 }));
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
      // Fractional, like a real count of a kg/ml ingredient — the point of the
      // debug fill is to exercise the real path.
      const physicalStock = roundQuantity(Math.random() * maxStock);
      // Written in the id-ID decimal form the field actually accepts.
      newInputs[item.id] = formatQuantity(physicalStock);
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

  // Counted = sent in this draft session, or already counted server-side
  // (countedAt set from a previous submit — restores progress after reload).
  const filledCount = detail.items.filter((item: any) => {
    const raw = physicalInputs[item.id];
    if (raw !== undefined) return raw !== "";
    return item.countedAt != null;
  }).length;
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
            // Only prefill from stored state when the item was actually counted —
            // physicalStock 0 on an uncounted row is the trigger default, not a count.
            const inputValue =
              physicalInputs[item.id] ?? (item.countedAt != null ? String(item.physicalStock) : "");
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
                    // A controlled text field, not type=number: the raw text is
                    // what the draft persists, and parseQuantityInput reads it
                    // with the id-ID convention the rest of the UI formats with
                    // ("23,5" = 23.5, "6.000" = 6000 — never 6). inputMode
                    // still asks mobile for a decimal keypad.
                    type="text"
                    inputMode="decimal"
                    value={inputValue}
                    onChange={(e) => handleInputChange(item.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const inputs = Array.from(
                          document.querySelectorAll<HTMLInputElement>("input[inputmode='decimal']"),
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
                    placeholder="kosong = tetap"
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
                // Prefill only counted rows (see mobile cards above).
                const inputValue =
                  physicalInputs[item.id] ??
                  (item.countedAt != null ? String(item.physicalStock) : "");
                // Parsed with the same id-ID rule the submit path uses, so the
                // live variance preview can never disagree with what gets saved.
                const counted = parseQuantityInput(inputValue);
                const variance = !isBlind && counted !== null ? counted - item.systemStock : 0;
                const hasVariance = !isBlind && counted !== null && variance !== 0;
                return (
                  <tr key={item.id} className={`border-b ${hasVariance ? "bg-warning/10" : ""}`}>
                    <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.ingredientCode}</td>
                    <td className="px-4 py-3">{item.ingredientName}</td>
                    {!isBlind && (
                      <td className="px-4 py-3 text-right">{formatQuantity(item.systemStock)}</td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <input
                        // See the mobile card input for why this stays a
                        // controlled text field.
                        type="text"
                        inputMode="decimal"
                        value={inputValue}
                        onChange={(e) => handleInputChange(item.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const inputs = Array.from(
                              document.querySelectorAll<HTMLInputElement>(
                                "input[inputmode='decimal']",
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
                        placeholder="kosong = tetap"
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
                        {counted !== null
                          ? `${variance > 0 ? "+" : ""}${formatQuantity(variance)}`
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

        {/* Persistent change summary — pending (until realized) or applied (realize).
            Server strips it for blind roles, so an empty list hides the block. */}
        {!isBlind && detail.summary.length > 0 && (
          <div className="rounded-xl border bg-card p-3.5 sm:p-4 shadow-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
                Ringkasan Perubahan
              </div>
              <Badge
                variant={detail.summary[0]?.applied ? "success" : "outline"}
                className="rounded-full px-2.5 py-0.5 text-[11px]"
              >
                {detail.realizedAt ? "Sudah diterapkan ke stok" : "Belum diterapkan ke stok"}
              </Badge>
            </div>
            <div className="mt-3 space-y-1.5">
              {detail.summary.map((row: any, idx: number) => (
                <div
                  key={`${row.ingredientName}-${idx}`}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{row.ingredientName}</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    <span className="text-muted-foreground line-through">
                      {row.oldQuantity.toLocaleString("id-ID")}
                    </span>
                    <span aria-hidden="true">→</span>
                    <span className="font-medium">{row.newQuantity.toLocaleString("id-ID")}</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        row.delta > 0
                          ? "bg-success/15 text-success-foreground"
                          : row.delta < 0
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {row.delta > 0 ? "+" : ""}
                      {row.delta.toLocaleString("id-ID")}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {detail.realizedAt
                ? "Perubahan di atas sudah masuk ke stok dan Kartu Stok."
                : soIs25th
                  ? "Item yang tidak dihitung tidak muncul di sini — stoknya tetap. Perubahan masuk ke stok saat Realize."
                  : "Opname di luar tanggal 25 hanya catatan — perubahan ini tidak akan masuk ke stok."}
            </p>
          </div>
        )}

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
              {soIs25th
                ? "Stok fisik Nasi akan dikonversi ke bahan baku saat Realize SO."
                : "Konversi Nasi hanya berlaku saat Realize — opname di luar tanggal 25 hanya catatan, jadi tidak ada pengurangan bahan baku."}
            </p>
            {detail.items
              .filter((item: any) => item.isNasi)
              .map((item: any) => {
                const portions = physicalInputs[item.id] ?? String(item.physicalStock);
                const numPortions = parseQuantityInput(portions) ?? 0;
                const conversions = calculateNasiConversion(numPortions);
                return (
                  <div key={item.id} className="space-y-2">
                    <div className="text-sm font-medium">
                      {formatQuantity(numPortions)} porsi Nasi Putih
                    </div>
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
                Setujui Opname
              </button>
            )}
            {canRealize && (
              <button
                onClick={() => setRealizeModal(true)}
                disabled={realizeMutation.isPending}
                className="inline-flex items-center justify-center h-11 sm:h-10 px-4 rounded-xl sm:rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 w-full sm:w-auto"
              >
                {realizeMutation.isPending ? "Memproses..." : "Realize SO — terapkan ke stok"}
              </button>
            )}
            {/* Note-only opnames: the whole flow runs, nothing moves (ADR 0021) */}
            {detail.status !== "Approved" && !soIs25th && (
              <p className="text-xs text-muted-foreground w-full sm:w-auto sm:self-center">
                Opname di luar tanggal 25 hanya catatan — realisasi tidak mengubah stok.
              </p>
            )}
            {detail.status === "Approved" && !soIs25th && !detail.realizedAt && (
              <p className="text-xs text-muted-foreground w-full sm:w-auto sm:self-center">
                Opname di luar tanggal 25 hanya catatan — tidak ada perubahan stok.
              </p>
            )}
            {soIs25th && !soCycleOpen && detail.status !== "Approved" && (
              <p className="text-xs text-muted-foreground w-full sm:w-auto sm:self-center">
                Opname periode {soCycle} — Realize terbuka mulai periode {soCycle} (bulan itu).
              </p>
            )}
            {soIs25th && !soCycleOpen && detail.status === "Approved" && !detail.realizedAt && (
              <p className="text-xs text-muted-foreground w-full sm:w-auto sm:self-center">
                Realize terbuka mulai {soCycle} — belum bisa menerapkan stok untuk periode
                mendatang.
              </p>
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
            <p>
              Persetujuan <b>tidak mengubah stok</b>. Hasil hitungan disimpan sebagai catatan resmi.
              Stok sistem baru menyesuaikan saat <b>Realize</b> — dan hanya untuk opname yang
              tanggalnya 25.
            </p>
          </div>
          {detail.drift.length > 0 && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              <p className="font-medium">
                Stok bergerak sejak SO dibuat ({detail.drift.length} item)
              </p>
              <p className="mt-1 text-xs">
                Stok sistem di bawah adalah snapshot saat SO dibuat. Penyesuaian dihitung dari stok
                aktual saat ini, bukan snapshot tersebut.
              </p>
              <ul className="mt-2 space-y-1">
                {detail.drift.map((row, idx: number) => (
                  <li
                    key={`${row.ingredientName}-${idx}`}
                    className="flex items-center justify-between gap-2 tabular-nums"
                  >
                    <span className="min-w-0 truncate">{row.ingredientName}</span>
                    <span className="shrink-0 font-mono text-xs">
                      snapshot {row.systemStock.toLocaleString("id-ID")} → sekarang{" "}
                      {row.currentQuantity.toLocaleString("id-ID")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
              Aksi ini tidak dapat dibatalkan. Hanya opname tanggal 25 yang bisa di-realize — opname
              lain tidak mengubah stok.
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
