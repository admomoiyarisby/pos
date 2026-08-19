import { createFileRoute } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { formText } from "#/lib/utils";
import { useState, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getYieldConversions, createYieldConversion } from "#/lib/server/yield";
import { getIngredients } from "#/lib/server/ingredients";
import { getBranches } from "#/lib/server/branches";
import type { Column } from "#/components/ui/DataTable";
import { AlertCircle, ArrowRightLeft, PackageMinus, PackagePlus, X } from "lucide-react";

interface ProductionItem {
  ingredientId: string;
  quantity: number;
}

interface ProductionRow {
  id: string;
  createdAt: Date;
  productionDate?: Date;
  notes: string | null;
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
            return (
              <div
                key={item.ingredientId}
                className="flex items-center gap-3 rounded-md border p-2"
              >
                <span className="flex-1 truncate text-sm">{ing?.name ?? item.ingredientId}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {ing?.stockUnit}
                </span>
                <input
                  value={item.quantity > 0 ? item.quantity : ""}
                  onChange={(e) => onUpdateQty(item.ingredientId, Number(e.target.value))}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
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
  const { conversions: initial, ingredients, branches } = Route.useLoaderData();
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

  const { data: rawConversions } = useQuery({
    queryKey: ["yield-conversions"],
    queryFn: () => getYieldConversions({ data: {} }),
    initialData: initial,
  });

  const conversions = [...rawConversions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const createMutation = useMutation({
    mutationFn: createYieldConversion,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["yield-conversions"] });
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

  const totalOut = conversions.reduce(
    (sum, c) => sum + c.out.reduce((a, i) => a + i.quantity, 0),
    0,
  );
  const totalProduced = conversions.reduce(
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
  ];

  usePageTitle("Tracking Produksi", "Pencatatan produksi: barang keluar & barang dihasilkan");

  return (
    <RoleGuard allowedRoles={["super_admin", "central_kitchen"]}>
      <div className="space-y-6">
        <PageHeader action={{ label: "Input Produksi", onClick: () => setModalOpen(true) }} />

        {result && (
          <div className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-success-foreground">
            <p className="font-medium">Produksi berhasil dicatat!</p>
            <p>
              {result.outCount} bahan keluar · {result.producedCount} bahan dihasilkan dicatat
              sebagai histori (stok tidak berubah).
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
            <p className="text-2xl font-bold mt-2">{conversions.length}</p>
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

        <DataTable
          columns={columns}
          data={conversions}
          keyExtractor={(r) => r.id}
          pageSize={15}
          search={search}
          onSearchChange={setSearch}
        />

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
              <select
                name="branchId"
                required
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {branches
                  .filter((b) => b.type === "Central")
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
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
                Pencatatan ini murni histori — stok barang keluar maupun dihasilkan tidak berubah.
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
      </div>
    </RoleGuard>
  );
}
