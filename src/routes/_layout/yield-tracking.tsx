import { createFileRoute } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { formText } from "#/lib/utils";
import { useState, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import {
  getYieldConversions,
  createYieldConversion,
  requestYieldCancel,
  getYieldCancelRequests,
  approveYieldCancelRequest,
  rejectYieldCancelRequest,
  directCancelYieldConversion,
} from "#/lib/server/yield";
import { getIngredients } from "#/lib/server/ingredients";
import { getBranches } from "#/lib/server/branches";
import { getInventory } from "#/lib/server/inventory";
import { useAuth } from "#/lib/auth-context";
import type { Column } from "#/components/ui/DataTable";
import {
  AlertCircle,
  ArrowRightLeft,
  PackageMinus,
  PackagePlus,
  X,
  Trash2,
  Check,
  Ban,
} from "lucide-react";

interface ProductionItem {
  ingredientId: string;
  quantity: number;
}

interface ProductionRow {
  id: string;
  branchId: string;
  branchName: string | null;
  recordedByName: string | null;
  createdAt: Date;
  productionDate?: Date;
  notes: string | null;
  status: "Active" | "Cancelled";
  cancelledAt?: Date | null;
  cancelReason?: string | null;
  out: { ingredientId: string; quantity: number; ingredientName: string | null }[];
  produced: { ingredientId: string; quantity: number; ingredientName: string | null }[];
}

type IngredientLike = {
  id: string;
  name: string;
  stockUnit: string | null;
  category: string | null;
};

/**
 * SidePicker — grouped, collapsible checkbox selection for one side of a
 * production record (Barang Keluar / Barang Dihasilkan). Mirrors the
 * "Sesuaikan Stok" modal in /inventory: ingredients are grouped by category
 * with a per-category select-all (indeterminate) and a selected list with
 * quantity inputs. An ingredient already chosen on the OTHER side is disabled
 * here so it can't appear in both sides of one record.
 */
function SidePicker({
  title,
  icon,
  items,
  allIngredients,
  pickerOpen,
  setPickerOpen,
  openCats,
  setOpenCats,
  otherSelectedIds,
  onToggle,
  onToggleCat,
  onUpdateQty,
  onRemove,
  stockByIngredient,
  direction,
  stockLoading,
}: {
  title: string;
  icon: React.ReactNode;
  items: ProductionItem[];
  allIngredients: IngredientLike[];
  pickerOpen: boolean;
  setPickerOpen: (v: boolean) => void;
  openCats: Set<string>;
  setOpenCats: Dispatch<SetStateAction<Set<string>>>;
  otherSelectedIds: Set<string>;
  onToggle: (ing: IngredientLike) => void;
  onToggleCat: (cat: string) => void;
  onUpdateQty: (ingredientId: string, qty: number) => void;
  onRemove: (ingredientId: string) => void;
  stockByIngredient: Map<string, number>;
  direction: "OUT" | "PRODUCED";
  stockLoading: boolean;
}) {
  const grouped = useMemo(() => {
    const m: Record<string, IngredientLike[]> = {};
    for (const ing of allIngredients) {
      const cat = ing.category ?? "Lainnya";
      (m[cat] ??= []).push(ing);
    }
    return m;
  }, [allIngredients]);
  const categoryOrder = ["Fresh", "Dry", "Packaging", "Lainnya"];
  const isIncluded = (id: string) => items.some((i) => i.ingredientId === id);

  return (
    <div className="rounded-md border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          {icon}
          {title}
        </h3>
        <span className="text-xs text-muted-foreground">{items.length} dipilih</span>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setPickerOpen(!pickerOpen)}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <span>Pilih Bahan (centang per tipe)</span>
          <span className="text-muted-foreground">{pickerOpen ? "▾" : "▸"}</span>
        </button>
        {pickerOpen && (
          <div className="rounded-md border max-h-[34vh] overflow-y-auto">
            {categoryOrder
              .filter((c) => grouped[c]?.length)
              .map((cat) => {
                const opts = grouped[cat] ?? [];
                const catAll = opts.length > 0 && opts.every((o) => isIncluded(o.id));
                const catSome = opts.some((o) => isIncluded(o.id));
                return (
                  <div key={cat} className="border-b last:border-b-0">
                    <div className="flex w-full items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`Pilih semua ${cat}`}
                          className="h-4 w-4 cursor-pointer"
                          ref={(el) => {
                            if (el) el.indeterminate = catSome && !catAll;
                          }}
                          checked={catAll}
                          onChange={() => onToggleCat(cat)}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setOpenCats((prev) => {
                              const next = new Set(prev);
                              if (next.has(cat)) next.delete(cat);
                              else next.add(cat);
                              return next;
                            })
                          }
                          className="text-sm font-medium hover:underline"
                        >
                          {cat}
                          <span className="text-muted-foreground text-xs"> ({opts.length})</span>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenCats((prev) => {
                            const next = new Set(prev);
                            if (next.has(cat)) next.delete(cat);
                            else next.add(cat);
                            return next;
                          })
                        }
                        className="text-muted-foreground"
                        aria-label={openCats.has(cat) ? "Tutup" : "Buka"}
                      >
                        {openCats.has(cat) ? "▾" : "▸"}
                      </button>
                    </div>
                    {openCats.has(cat) && (
                      <div className="divide-y">
                        {opts.map((opt) => {
                          const disabled = otherSelectedIds.has(opt.id);
                          return (
                            <label
                              key={opt.id}
                              className={
                                "flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50 cursor-pointer" +
                                (disabled ? " opacity-50" : "")
                              }
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 cursor-pointer"
                                disabled={disabled}
                                checked={isIncluded(opt.id)}
                                onChange={() => onToggle(opt)}
                              />
                              <span className="flex-1 truncate">{opt.name}</span>
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {opt.stockUnit}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">Daftar bahan ({items.length})</span>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">
            Belum ada bahan dipilih. Centang bahan di atas.
          </p>
        ) : (
          items.map((item) => {
            const ing = allIngredients.find((i) => i.id === item.ingredientId);
            const current = stockByIngredient.get(item.ingredientId) ?? 0;
            // OUT consumes stock (−), PRODUCED produces stock (+); negative is
            // allowed (ADR 0012), so an OUT line that would drive stock below 0
            // shows a warning instead of blocking.
            const resulting = current + (direction === "OUT" ? -1 : 1) * item.quantity;
            const goesNegative = direction === "OUT" && item.quantity > 0 && resulting < 0;
            return (
              <div
                key={item.ingredientId}
                className="flex items-center gap-2 md:gap-3 rounded-md border p-2"
              >
                <span className="flex-1 truncate text-sm">{ing?.name ?? item.ingredientId}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground whitespace-nowrap">
                  {ing?.stockUnit}
                </span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  Stok: {stockLoading ? "…" : current.toLocaleString("id-ID")}
                </span>
                <span
                  className={
                    "text-xs font-semibold whitespace-nowrap tabular-nums " +
                    (goesNegative ? "text-destructive" : "text-success")
                  }
                >
                  → {stockLoading ? "…" : resulting.toLocaleString("id-ID")}
                </span>
                {goesNegative && (
                  <span className="text-xs font-medium text-destructive whitespace-nowrap">
                    ⚠ Stok negatif
                  </span>
                )}
                <input
                  value={item.quantity > 0 ? item.quantity : ""}
                  onChange={(e) => onUpdateQty(item.ingredientId, Number(e.target.value))}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
                  placeholder="Jumlah"
                />
                <button
                  type="button"
                  onClick={() => onRemove(item.ingredientId)}
                  className="h-9 w-9 rounded-md border text-muted-foreground hover:bg-muted flex items-center justify-center"
                  title="Hapus"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_layout/yield-tracking")({
  component: YieldTrackingPage,
  loader: async () => {
    const conversions = await getYieldConversions({ data: {} });
    const ingredients = await getIngredients({ data: { excludeNasi: true } });
    const branches = await getBranches({ data: {} });
    return { conversions, ingredients, branches };
  },
});

function YieldTrackingPage() {
  const [search, setSearch] = useTableSearch();
  const {
    page,
    setPage,
    sort,
    setSort,
    filters: { branchId },
    setFilter,
  } = useTableUrlState<{ branchId?: string }>(["branchId"]);
  const { conversions: initial, ingredients, branches } = Route.useLoaderData();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [result, setResult] = useState<{ outCount: number; producedCount: number } | null>(null);
  const [outItems, setOutItems] = useState<ProductionItem[]>([]);
  const [producedItems, setProducedItems] = useState<ProductionItem[]>([]);
  const [outPickerOpen, setOutPickerOpen] = useState(true);
  const [producedPickerOpen, setProducedPickerOpen] = useState(true);
  const [openOutCats, setOpenOutCats] = useState<Set<string>>(
    new Set(["Fresh", "Dry", "Packaging"]),
  );
  const [openProducedCats, setOpenProducedCats] = useState<Set<string>>(
    new Set(["Fresh", "Dry", "Packaging"]),
  );

  // Live stock preview (ADR 0012): current stock for the record's branch,
  // fetched when the modal opens so each line shows "Stok → sisa". Missing
  // inventory rows read as 0 (upsert-from-0 semantics).
  const [formBranchId, setFormBranchId] = useState("");
  const selectedBranchId = user?.role === "branch_admin" ? (user.branchId ?? "") : formBranchId;
  const stockQuery = useQuery({
    queryKey: ["branch-inventory", selectedBranchId],
    queryFn: () => getInventory({ data: { branchId: selectedBranchId, limit: 1000 } }),
    enabled: modalOpen && !!selectedBranchId,
  });
  const stockByIngredient = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of stockQuery.data?.data ?? []) m.set(row.ingredientId, row.quantity);
    return m;
  }, [stockQuery.data]);
  const stockReady = !!selectedBranchId && !stockQuery.isPending;

  const { data: rawConversions } = useQuery({
    queryKey: ["yield-conversions"],
    queryFn: () => getYieldConversions({ data: {} }),
    initialData: initial,
  });

  const conversions = [...rawConversions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Branch filter — only roles that can see more than one branch get the
  // dropdown (branch_admin is scoped to their own branch server-side).
  const canFilterBranches =
    user?.role === "super_admin" ||
    user?.role === "central_kitchen" ||
    user?.role === "area_manager";
  const filteredBranches = useMemo(() => {
    if (user?.role === "area_manager" && user.assignedBranches?.length) {
      return branches.filter((b) => user.assignedBranches!.includes(b.id));
    }
    return branches;
  }, [branches, user]);
  const filteredConversions = useMemo(() => {
    if (!branchId) return conversions;
    return conversions.filter((c) => c.branchId === branchId);
  }, [conversions, branchId]);

  const createMutation = useMutation({
    mutationFn: createYieldConversion,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["yield-conversions"] });
      void queryClient.invalidateQueries({ queryKey: ["branch-inventory"] });
      setModalOpen(false);
      const v = createMutation.variables?.data;
      setResult({
        outCount: v?.out?.length ?? 0,
        producedCount: v?.produced?.length ?? 0,
      });
      setOutItems([{ ingredientId: "", quantity: 0 }]);
      setProducedItems([{ ingredientId: "", quantity: 0 }]);
      setTimeout(() => setResult(null), 5000);
    },
  });

  // ── Cancel Produksi (branch_admin → super_admin/area_manager)
  const [cancelTarget, setCancelTarget] = useState<ProductionRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const canApprove = user?.role === "super_admin" || user?.role === "area_manager";
  const { data: cancelRequests = [] } = useQuery({
    queryKey: ["yield-cancel-requests", user?.role],
    queryFn: () => getYieldCancelRequests({ data: { status: "Pending" } }),
    enabled: canApprove,
  });
  const pendingByYield = useMemo(() => {
    const m = new Map<string, (typeof cancelRequests)[number]>();
    for (const r of cancelRequests) m.set(r.yieldConversionId, r);
    return m;
  }, [cancelRequests]);
  const requestCancelMutation = useMutation({
    mutationFn: requestYieldCancel,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["yield-cancel-requests"] });
      setCancelTarget(null);
      setCancelReason("");
    },
  });
  const approveMutation = useMutation({
    mutationFn: approveYieldCancelRequest,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["yield-conversions"] });
      void queryClient.invalidateQueries({ queryKey: ["branch-inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["yield-cancel-requests"] });
    },
  });
  const rejectMutation = useMutation({
    mutationFn: rejectYieldCancelRequest,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["yield-cancel-requests"] });
    },
  });
  const directCancelMutation = useMutation({
    mutationFn: directCancelYieldConversion,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["yield-conversions"] });
      void queryClient.invalidateQueries({ queryKey: ["branch-inventory"] });
      setCancelTarget(null);
      setCancelReason("");
    },
  });

  // ── Barang Keluar (Out) — checkbox selection
  const outIds = useMemo(() => new Set(outItems.map((i) => i.ingredientId)), [outItems]);
  const producedIds = useMemo(
    () => new Set(producedItems.map((i) => i.ingredientId)),
    [producedItems],
  );
  const grouped = useMemo(() => {
    const m: Record<string, IngredientLike[]> = {};
    for (const ing of ingredients) {
      const cat = ing.category ?? "Lainnya";
      (m[cat] ??= []).push(ing);
    }
    return m;
  }, [ingredients]);

  const toggleOutInclude = (ing: IngredientLike) => {
    if (outIds.has(ing.id)) setOutItems((p) => p.filter((i) => i.ingredientId !== ing.id));
    else setOutItems((p) => [...p, { ingredientId: ing.id, quantity: 0 }]);
  };
  const toggleOutCatAll = (cat: string) => {
    const opts = grouped[cat] ?? [];
    const allIn = opts.length > 0 && opts.every((o) => outIds.has(o.id));
    if (allIn) {
      const ids = new Set(opts.map((o) => o.id));
      setOutItems((p) => p.filter((i) => !ids.has(i.ingredientId)));
    } else {
      const toAdd = opts
        .filter((o) => !outIds.has(o.id) && !producedIds.has(o.id))
        .map((o) => ({ ingredientId: o.id, quantity: 0 }));
      setOutItems((p) => [...p, ...toAdd]);
    }
  };
  const updateOutItem = (ingredientId: string, qty: number) =>
    setOutItems((p) =>
      p.map((i) => (i.ingredientId === ingredientId ? { ...i, quantity: qty } : i)),
    );
  const removeOutItem = (ingredientId: string) =>
    setOutItems((p) => p.filter((i) => i.ingredientId !== ingredientId));

  // ── Barang Dihasilkan (Produced) — checkbox selection
  const toggleProducedInclude = (ing: IngredientLike) => {
    if (producedIds.has(ing.id))
      setProducedItems((p) => p.filter((i) => i.ingredientId !== ing.id));
    else setProducedItems((p) => [...p, { ingredientId: ing.id, quantity: 0 }]);
  };
  const toggleProducedCatAll = (cat: string) => {
    const opts = grouped[cat] ?? [];
    const allIn = opts.length > 0 && opts.every((o) => producedIds.has(o.id));
    if (allIn) {
      const ids = new Set(opts.map((o) => o.id));
      setProducedItems((p) => p.filter((i) => !ids.has(i.ingredientId)));
    } else {
      const toAdd = opts
        .filter((o) => !producedIds.has(o.id) && !outIds.has(o.id))
        .map((o) => ({ ingredientId: o.id, quantity: 0 }));
      setProducedItems((p) => [...p, ...toAdd]);
    }
  };
  const updateProducedItem = (ingredientId: string, qty: number) =>
    setProducedItems((p) =>
      p.map((i) => (i.ingredientId === ingredientId ? { ...i, quantity: qty } : i)),
    );
  const removeProducedItem = (ingredientId: string) =>
    setProducedItems((p) => p.filter((i) => i.ingredientId !== ingredientId));

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const out = outItems.filter((s) => s.ingredientId && s.quantity > 0);
    const produced = producedItems.filter((s) => s.ingredientId && s.quantity > 0);

    void createMutation.mutateAsync({
      data: {
        branchId: formText(fd, "branchId"),
        out,
        produced,
        notes: formText(fd, "notes") || undefined,
        productionDate: formText(fd, "productionDate") || undefined,
      },
    });
  };

  const resetForm = () => {
    setOutItems([]);
    setProducedItems([]);
  };

  const totalOut = filteredConversions.reduce(
    (sum, c) => sum + c.out.reduce((a, i) => a + i.quantity, 0),
    0,
  );
  const totalProduced = filteredConversions.reduce(
    (sum, c) => sum + c.produced.reduce((a, i) => a + i.quantity, 0),
    0,
  );

  const itemList = (
    items: { ingredientId: string; quantity: number; ingredientName: string | null }[],
  ) => (
    <div className="space-y-0.5">
      {items.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        items.map((s, i) => (
          <div key={i}>
            <span className="font-medium">{s.ingredientName}</span>
            <span className="text-muted-foreground ml-2">
              {s.quantity.toLocaleString("id-ID")} unit
            </span>
          </div>
        ))
      )}
    </div>
  );

  const columns: Column<ProductionRow>[] = [
    {
      key: "productionDate",
      header: "Tanggal Produksi",
      width: "w-32",
      sortable: true,
      render: (r) =>
        new Date(r.productionDate ?? r.createdAt).toLocaleDateString("id-ID", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
    },
    {
      key: "createdAt",
      header: "Jam Input",
      width: "w-24",
      sortable: true,
      render: (r) =>
        new Date(r.createdAt).toLocaleString("id-ID", { hour: "2-digit", minute: "2-digit" }),
    },
    {
      key: "branchName",
      header: "Cabang",
      width: "w-40",
      sortable: true,
      render: (r) => (
        <div className="space-y-0.5">
          <span className="font-medium">{r.branchName ?? "-"}</span>
          <div className="text-xs text-muted-foreground">{r.recordedByName ?? "-"}</div>
        </div>
      ),
    },
    { key: "out", header: "Barang Keluar", sortable: false, render: (r) => itemList(r.out) },
    {
      key: "produced",
      header: "Barang Dihasilkan",
      sortable: false,
      render: (r) => itemList(r.produced),
    },
    {
      key: "notes",
      header: "Catatan",
      sortable: false,
      render: (r) => <span className="text-muted-foreground">{r.notes ?? "-"}</span>,
    },
    {
      key: "status",
      header: "Status",
      width: "w-28",
      sortable: true,
      render: (r) => {
        const pending = pendingByYield.get(r.id);
        if (r.status === "Cancelled")
          return (
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs">
                Cancelled
              </span>
              <a
                href={`/inventory/ledger?reference=YIELD-${r.id}`}
                title="Lihat mutasi pembalikan di Kartu Stok"
                className="inline-flex items-center rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/20"
              >
                stok dibalik
              </a>
            </div>
          );
        if (pending)
          return (
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center rounded bg-amber-100 text-amber-800 px-2 py-0.5 text-xs">
                Pending Cancel
              </span>
              <a
                href={`/inventory/ledger?reference=YIELD-${r.id}`}
                title="Lihat mutasi stok produksi di Kartu Stok"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
              >
                Kartu Stok
              </a>
            </div>
          );
        return (
          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center rounded bg-emerald-50 text-emerald-700 px-2 py-0.5 text-xs">
              Active
            </span>
            <a
              href={`/inventory/ledger?reference=YIELD-${r.id}`}
              title="Lihat mutasi stok produksi di Kartu Stok"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
            >
              Kartu Stok
            </a>
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "Aksi",
      width: "w-40",
      sortable: false,
      render: (r) => {
        const pending = pendingByYield.get(r.id);
        const isCancelled = r.status === "Cancelled";
        if (isCancelled) return <span className="text-xs text-muted-foreground">—</span>;
        if (pending && canApprove) {
          return (
            <div className="flex gap-1">
              <button
                onClick={() => approveMutation.mutate({ data: { requestId: pending.id } })}
                disabled={approveMutation.isPending}
                className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Setujui
              </button>
              <button
                onClick={() => rejectMutation.mutate({ data: { requestId: pending.id } })}
                disabled={rejectMutation.isPending}
                className="inline-flex items-center gap-1 rounded bg-destructive px-2 py-1 text-xs text-white hover:bg-destructive/90 disabled:opacity-50"
              >
                <Ban className="h-3 w-3" /> Tolak
              </button>
            </div>
          );
        }
        if (pending) return <span className="text-xs text-amber-600">Menunggu persetujuan</span>;
        // branch_admin / central_kitchen can request; super_admin can direct cancel
        const canRequest =
          user?.role === "branch_admin" ||
          user?.role === "central_kitchen" ||
          user?.role === "super_admin";
        if (!canRequest) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <button
            onClick={() => setCancelTarget(r)}
            className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
          >
            <Trash2 className="h-3 w-3" /> Batal
          </button>
        );
      },
    },
  ];

  usePageTitle(
    "Tracking Produksi",
    "Pencatatan produksi yang mengubah stok: barang keluar & barang dihasilkan",
  );

  return (
    <RoleGuard allowedRoles={["super_admin", "central_kitchen", "branch_admin", "area_manager"]}>
      <div className="space-y-6">
        {/* Area managers are view-only: production records belong to the
            branch/central kitchen that performed them. */}
        <PageHeader
          action={
            user?.role === "area_manager"
              ? undefined
              : { label: "Input Produksi", onClick: () => setModalOpen(true) }
          }
        />

        {result && (
          <div className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-success-foreground">
            <p className="font-medium">Produksi berhasil dicatat!</p>
            <p>
              {result.outCount} bahan keluar · {result.producedCount} bahan dihasilkan dicatat. Stok
              diperbarui: bahan keluar dikurangi, bahan dihasilkan ditambah.
            </p>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase">Total Produksi</span>
            </div>
            <p className="text-2xl font-bold mt-2">{filteredConversions.length}</p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <PackageMinus className="h-4 w-4 text-destructive" />
              <span className="text-xs text-muted-foreground uppercase">Total Barang Keluar</span>
            </div>
            <p className="text-2xl font-bold mt-2">{totalOut.toLocaleString("id-ID")}</p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <PackagePlus className="h-4 w-4 text-success" />
              <span className="text-xs text-muted-foreground uppercase">
                Total Barang Dihasilkan
              </span>
            </div>
            <p className="text-2xl font-bold mt-2">{totalProduced.toLocaleString("id-ID")}</p>
          </div>
        </div>

        {canFilterBranches && filteredBranches.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={branchId ?? ""}
              onChange={(e) => {
                setFilter("branchId", e.target.value);
                setPage(0);
              }}
              className="h-8 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Semua Cabang</option>
              {filteredBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <DataTable
          columns={columns}
          data={filteredConversions}
          keyExtractor={(r) => r.id}
          pageSize={15}
          search={search}
          onSearchChange={setSearch}
          page={page}
          onPageChange={setPage}
          sort={sort}
          onSortChange={setSort}
        />

        {canApprove && cancelRequests.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-800">
              {cancelRequests.length} permintaan batal produksi menunggu persetujuan
            </p>
            <p className="text-amber-700 text-xs">
              Setujui atau tolak dari kolom Aksi pada tabel di bawah.
            </p>
          </div>
        )}

        <Modal
          open={modalOpen}
          onClose={() => {
            setModalOpen(false);
            resetForm();
            createMutation.reset();
          }}
          title="Input Produksi"
          size="3xl"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {createMutation.isError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {createMutation.error instanceof Error
                    ? createMutation.error.message
                    : "Gagal mencatat produksi"}
                </span>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Cabang / Gudang</label>
              {user?.role === "branch_admin" ? (
                <>
                  {/* Branch admins always record against their own branch; the
                      server ignores any submitted branchId for them anyway. */}
                  <input type="hidden" name="branchId" value={user.branchId ?? ""} />
                  <p className="h-10 md:h-9 w-full rounded-md border bg-muted px-3 py-2 text-sm">
                    {branches.find((b) => b.id === user.branchId)?.name ?? "Cabang saya"}
                  </p>
                </>
              ) : (
                <select
                  name="branchId"
                  required
                  value={formBranchId}
                  onChange={(e) => setFormBranchId(e.target.value)}
                  className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Pilih cabang…</option>
                  {branches
                    .filter((b) => b.type === "Central")
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Tanggal Produksi</label>
              <input
                type="date"
                name="productionDate"
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>

            <SidePicker
              title="Barang Keluar (Out)"
              icon={<PackageMinus className="h-4 w-4 text-destructive" />}
              items={outItems}
              allIngredients={ingredients}
              pickerOpen={outPickerOpen}
              setPickerOpen={setOutPickerOpen}
              openCats={openOutCats}
              setOpenCats={setOpenOutCats}
              otherSelectedIds={producedIds}
              onToggle={toggleOutInclude}
              onToggleCat={toggleOutCatAll}
              onUpdateQty={updateOutItem}
              onRemove={removeOutItem}
              stockByIngredient={stockByIngredient}
              direction="OUT"
              stockLoading={!stockReady}
            />

            <div className="flex items-center justify-center">
              <div className="rounded-full bg-muted p-2">
                <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            <SidePicker
              title="Barang Dihasilkan (Produced)"
              icon={<PackagePlus className="h-4 w-4 text-success" />}
              items={producedItems}
              allIngredients={ingredients}
              pickerOpen={producedPickerOpen}
              setPickerOpen={setProducedPickerOpen}
              openCats={openProducedCats}
              setOpenCats={setOpenProducedCats}
              otherSelectedIds={outIds}
              onToggle={toggleProducedInclude}
              onToggleCat={toggleProducedCatAll}
              onUpdateQty={updateProducedItem}
              onRemove={removeProducedItem}
              stockByIngredient={stockByIngredient}
              direction="PRODUCED"
              stockLoading={!stockReady}
            />

            <div className="space-y-2">
              <label className="text-sm font-medium">Catatan Produksi</label>
              <textarea
                name="notes"
                placeholder="Contoh: Pengolahan batch pagi"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] md:min-h-[60px] resize-none"
              />
            </div>

            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <p>
                Mencatat produksi langsung mengubah stok: bahan keluar dikurangi, bahan dihasilkan
                ditambah. Membatalkan produksi membalik perubahan ini.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  resetForm();
                  createMutation.reset();
                }}
                className="h-10 md:h-9 px-4 rounded-md border text-sm"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="h-10 md:h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                {createMutation.isPending ? "Memproses..." : "Catat Produksi"}
              </button>
            </div>
          </form>
        </Modal>

        <Modal
          open={!!cancelTarget}
          onClose={() => {
            setCancelTarget(null);
            setCancelReason("");
            requestCancelMutation.reset();
            directCancelMutation.reset();
          }}
          title={user?.role === "super_admin" ? "Batalkan Produksi" : "Request Batal Produksi"}
          size="lg"
        >
          <div className="space-y-4">
            {(requestCancelMutation.isError || directCancelMutation.isError) && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {(requestCancelMutation.error instanceof Error
                    ? requestCancelMutation.error.message
                    : undefined) ||
                    (directCancelMutation.error instanceof Error
                      ? directCancelMutation.error.message
                      : undefined) ||
                    "Gagal membatalkan"}
                </span>
              </div>
            )}
            {requestCancelMutation.isSuccess && (
              <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
                Permintaan batal dikirim. Bila disetujui, stok produksi ini dibalik.
              </div>
            )}
            {cancelTarget && (
              <div className="rounded-md border p-3 text-sm space-y-1">
                <p className="font-medium">
                  Produksi {cancelTarget.id.slice(0, 8)} —{" "}
                  {new Date(
                    cancelTarget.productionDate ?? cancelTarget.createdAt,
                  ).toLocaleDateString("id-ID")}
                </p>
                <p className="text-muted-foreground text-xs">
                  {cancelTarget.branchName ?? "-"} · {cancelTarget.recordedByName ?? "-"} ·{" "}
                  {cancelTarget.out.map((o) => o.ingredientName).join(", ")} →{" "}
                  {cancelTarget.produced.map((p) => p.ingredientName).join(", ")}
                </p>
              </div>
            )}
            <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              Menyetujui pembatalan akan membalik stok produksi ini: bahan keluar dikembalikan,
              bahan dihasilkan dikurangi.
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Alasan pembatalan *</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Contoh: salah input tanggal / duplikat"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCancelTarget(null);
                  setCancelReason("");
                }}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Tutup
              </button>
              {user?.role === "super_admin" ? (
                <button
                  type="button"
                  disabled={
                    !cancelReason.trim() ||
                    directCancelMutation.isPending ||
                    requestCancelMutation.isPending
                  }
                  onClick={() => {
                    if (!cancelTarget) return;
                    // super_admin direct cancel without request queue
                    directCancelMutation.mutate({
                      data: { yieldConversionId: cancelTarget.id, reason: cancelReason.trim() },
                    });
                  }}
                  className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50"
                >
                  {directCancelMutation.isPending ? "Memproses..." : "Batalkan Langsung"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={!cancelReason.trim() || requestCancelMutation.isPending}
                onClick={() => {
                  if (!cancelTarget) return;
                  requestCancelMutation.mutate({
                    data: { yieldConversionId: cancelTarget.id, reason: cancelReason.trim() },
                  });
                }}
                className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                {requestCancelMutation.isPending
                  ? "Mengirim..."
                  : user?.role === "super_admin"
                    ? "Request Batal"
                    : "Kirim Request"}
              </button>
            </div>
            {user?.role === "super_admin" && (
              <p className="text-xs text-muted-foreground">
                Sebagai super_admin Anda dapat “Batalkan Langsung” tanpa menunggu persetujuan, atau
                kirim request seperti branch_admin.
              </p>
            )}
          </div>
        </Modal>
      </div>
    </RoleGuard>
  );
}
