import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useState, useMemo } from "react";
import { formText } from "#/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { lookupLabel } from "#/lib/label-lookup";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable, { type Column } from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import MoneyInput from "#/components/MoneyInput";
import {
  getIngredients,
  createIngredient,
  updateIngredient,
  deleteIngredient,
} from "#/lib/server/ingredients";
import { getBranches } from "#/lib/server/branches";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Switch } from "#/components/ui/switch";
import { ArrowRight, Trash2, Check, Search, X, Plus, Package } from "lucide-react";

interface IngredientRow {
  id: string;
  code: string;
  name: string;
  category: "Fresh" | "Dry" | "Packaging";
  skuType: "RM" | "SFG" | "FG";
  purchaseUnit: string;
  stockUnit: string;
  conversionFactor: number;
  averageCost: number;
  status: "Active" | "Inactive" | "Deleted";
  isBranchVisible: boolean;
}

const skuLabels = {
  RM: "Raw Material",
  SFG: "Semi-Finished",
  FG: "Finished Goods",
} satisfies Record<string, string>;

export const Route = createFileRoute("/_layout/ingredients/")({
  component: IngredientsPage,
  loader: async () => {
    const [ingredients, branches] = await Promise.all([
      getIngredients({ data: {} }),
      getBranches({ data: {} }),
    ]);
    return { ingredients, branches };
  },
});

function IngredientsPage() {
  const [search, setSearch, committedSearch] = useTableSearch({ debounceMs: 250 });
  const { page, setPage, sort, setSort, filters, setFilter } = useTableUrlState<{
    category?: string;
    skuType?: string;
  }>(["category", "skuType"]);
  const categoryFilter = filters.category ?? "all";
  const skuTypeFilter = filters.skuType ?? "all";
  const { ingredients: initial, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [ingredientToDelete, setIngredientToDelete] = useState<string | null>(null);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [isBranchVisible, setIsBranchVisible] = useState(false);

  const { data: ingredients } = useQuery({
    queryKey: ["ingredients", committedSearch, categoryFilter, skuTypeFilter],
    queryFn: () =>
      getIngredients({
        data: {
          search: committedSearch || undefined,
          // SAFETY: these URL filters are restricted by the corresponding selects.
          category:
            categoryFilter === "all" ? null : (categoryFilter as "Fresh" | "Dry" | "Packaging"),
          // SAFETY: this URL filter is restricted by the corresponding select.
          skuType: skuTypeFilter === "all" ? null : (skuTypeFilter as "RM" | "SFG" | "FG"),
        },
      }),
    initialData: initial,
  });

  const filteredIngredients = ingredients;

  const createMutation = useMutation({
    mutationFn: createIngredient,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      setModalOpen(false);
      toast.success("Bahan baku berhasil ditambahkan");
    },
    onError: (error: Error) => {
      toast.error("Gagal menambah bahan baku", { description: error.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateIngredient,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      toast.success("Status bahan baku berhasil diubah");
    },
    onError: (error: Error) => {
      toast.error("Gagal mengubah status", { description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ data }: { data: { id: string; hardDelete: boolean } }) =>
      deleteIngredient({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      setDeleteModalOpen(false);
      setIngredientToDelete(null);
      toast.success("Bahan baku berhasil dihapus");
    },
    onError: (error: Error) => {
      toast.error("Gagal menghapus bahan baku", { description: error.message });
    },
  });

  const handleStatusToggle = async (
    id: string,
    currentStatus: "Active" | "Inactive" | "Deleted",
  ) => {
    const newStatus = currentStatus === "Active" ? "Inactive" : "Active";
    await updateMutation.mutateAsync({ data: { id, status: newStatus } });
  };

  const handleDelete = async () => {
    if (ingredientToDelete) {
      await deleteMutation.mutateAsync({
        data: { id: ingredientToDelete, hardDelete: false },
      });
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const aliasRaw = formText(fd, "alias");
    const data = {
      code: formText(fd, "code"),
      name: formText(fd, "name"),
      alias: aliasRaw || null,
      category: z.enum(["Fresh", "Dry", "Packaging"]).parse(formText(fd, "category")),
      skuType: z.enum(["RM", "SFG", "FG"]).parse(formText(fd, "skuType")),
      purchaseUnit: formText(fd, "purchaseUnit"),
      stockUnit: formText(fd, "stockUnit"),
      conversionFactor: Number(fd.get("conversionFactor")),
      averageCost: Number(fd.get("averageCost")),
      rop: Number(fd.get("rop")),
      moq: Number(fd.get("moq")),
      isBranchVisible,
      // Central-only (toggle off) ⇒ no branch links; branch-visible ⇒ honor selection.
      branchIds: isBranchVisible ? selectedBranchIds : [],
    };
    void createMutation.mutateAsync({ data });
  };

  const displayRows = useMemo(() => filteredIngredients ?? [], [filteredIngredients]);
  const totalPages = Math.ceil(displayRows.length / 15) || 1;
  const pagedRows = useMemo(
    () => displayRows.slice(page * 15, (page + 1) * 15),
    [displayRows, page],
  );
  const hasActiveFilters = !!(search.trim() || categoryFilter !== "all" || skuTypeFilter !== "all");

  usePageTitle("Bahan Baku", "Kelola master bahan baku, semi-finished, dan finished goods");

  const setCategoryFilter = (v: string) => {
    setFilter("category", v === "all" ? undefined : v);
    setPage(0);
  };
  const setSkuTypeFilter = (v: string) => {
    setFilter("skuType", v === "all" ? undefined : v);
    setPage(0);
  };

  const columns: Column<IngredientRow>[] = [
    { accessorKey: "code", header: "Kode", width: "w-24", enableSorting: true },
    { accessorKey: "name", header: "Nama Bahan", enableSorting: true },
    {
      accessorKey: "skuType",
      header: "Tipe SKU",
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline">{lookupLabel(skuLabels, row.original.skuType) ?? "-"}</Badge>
      ),
    },
    {
      accessorKey: "category",
      header: "Kategori",
      enableSorting: true,
      cell: ({ row }) => (
        <Badge
          variant={
            row.original.category === "Fresh"
              ? "destructive"
              : row.original.category === "Dry"
                ? "secondary"
                : "default"
          }
        >
          {row.original.category}
        </Badge>
      ),
    },
    { accessorKey: "purchaseUnit", header: "Satuan Beli", width: "w-28", enableSorting: true },
    { accessorKey: "stockUnit", header: "Satuan Stok", width: "w-28", enableSorting: true },
    {
      accessorKey: "averageCost",
      header: "HPP",
      align: "right",
      enableSorting: true,
      cell: ({ row }) => `Rp ${row.original.averageCost.toLocaleString("id-ID")}`,
    },
    {
      accessorKey: "status",
      header: "Status",
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={row.original.status === "Active" ? "success" : "secondary"}>
          {row.original.status === "Active" ? "Aktif" : "Nonaktif"}
        </Badge>
      ),
    },
    {
      accessorKey: "isBranchVisible",
      header: "Visibilitas",
      cell: ({ row }) => (
        <Badge variant={row.original.isBranchVisible ? "success" : "secondary"}>
          {row.original.isBranchVisible ? "Cabang" : "Pusat"}
        </Badge>
      ),
    },
    {
      accessorKey: "id",
      header: "",
      width: "w-32",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link
            to="/ingredients/$ingId"
            params={{ ingId: row.original.id }}
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <ArrowRight className="h-4 w-4" />
          </Link>
          <button
            onClick={() => handleStatusToggle(row.original.id, row.original.status)}
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title={row.original.status === "Active" ? "Nonaktifkan" : "Aktifkan"}
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              setIngredientToDelete(row.original.id);
              setDeleteModalOpen(true);
            }}
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Hapus"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "central_kitchen"]}>
      {/* ── Toolbar: search + action (mobile-first) ── */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-[380px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              aria-label="Cari bahan baku"
              placeholder="Cari kode, nama bahan…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-9 text-[16px] shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:rounded-lg sm:text-sm"
            />
            {search ? (
              <button
                type="button"
                aria-label="Hapus pencarian"
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <Button
            onClick={() => setModalOpen(true)}
            className="w-full sm:w-auto sm:ml-auto h-11 sm:h-9 rounded-xl sm:rounded-md shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Tambah Bahan
          </Button>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 snap-x snap-mandatory">
          <div className="flex items-center gap-1.5 shrink-0 snap-start">
            {(["all", "Fresh", "Dry", "Packaging"] as const).map((c) => {
              const active = categoryFilter === c;
              return (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(c)}
                  aria-pressed={active}
                  className={`shrink-0 snap-start inline-flex items-center h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${active ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
                >
                  {c === "all" ? "Semua" : c}
                </button>
              );
            })}
          </div>
          <div className="h-5 w-px bg-border shrink-0 hidden sm:block" />
          <div className="flex items-center gap-1.5 shrink-0 snap-start">
            {(["all", "RM", "SFG", "FG"] as const).map((s) => {
              const active = skuTypeFilter === s;
              return (
                <button
                  key={s}
                  onClick={() => setSkuTypeFilter(s)}
                  aria-pressed={active}
                  className={`shrink-0 snap-start inline-flex items-center h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${active ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
                >
                  {s === "all" ? "Semua SKU" : s}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between sm:hidden text-xs">
          <span className="text-muted-foreground tabular-nums">
            {displayRows.length} bahan • Hal {page + 1}/{totalPages}
          </span>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearch("");
                setCategoryFilter("all");
                setSkuTypeFilter("all");
                setPage(0);
              }}
              className="font-medium text-primary hover:underline underline-offset-4"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2.5 -mx-4 px-4">
        {pagedRows.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Package className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium">
              {hasActiveFilters ? "Tidak ada hasil" : "Belum ada bahan"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {hasActiveFilters ? "Tidak ada bahan untuk pencarian ini." : "Tambah bahan pertama."}
            </p>
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setSearch("");
                  setCategoryFilter("all");
                  setSkuTypeFilter("all");
                  setPage(0);
                }}
              >
                Reset
              </Button>
            )}
          </div>
        ) : (
          pagedRows.map((r) => (
            <div key={r.id} className="rounded-xl border bg-card p-3.5 shadow-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs text-muted-foreground truncate">{r.code}</div>
                  <div className="font-medium text-sm truncate">{r.name}</div>
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[11px] h-5">
                      {lookupLabel(skuLabels, r.skuType) ?? r.skuType}
                    </Badge>
                    <Badge
                      variant={
                        r.category === "Fresh"
                          ? "destructive"
                          : r.category === "Dry"
                            ? "secondary"
                            : "default"
                      }
                      className="text-[11px] h-5"
                    >
                      {r.category}
                    </Badge>
                    <Badge
                      variant={r.status === "Active" ? "success" : "secondary"}
                      className="text-[11px] h-5"
                    >
                      {r.status === "Active" ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </div>
                </div>
                <Link
                  to="/ingredients/$ingId"
                  params={{ ingId: r.id }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background shadow-xs shrink-0"
                >
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5 text-xs">
                <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                  <div className="text-[10px] tracking-widest uppercase text-muted-foreground font-medium">
                    Beli
                  </div>
                  <div className="font-medium truncate">{r.purchaseUnit}</div>
                </div>
                <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                  <div className="text-[10px] tracking-widest uppercase text-muted-foreground font-medium">
                    Stok
                  </div>
                  <div className="font-medium truncate">{r.stockUnit}</div>
                </div>
                <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                  <div className="text-[10px] tracking-widest uppercase text-muted-foreground font-medium">
                    Konversi
                  </div>
                  <div className="font-mono font-medium">{r.conversionFactor}</div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  HPP Rp {r.averageCost.toLocaleString("id-ID")}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleStatusToggle(r.id, r.status)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground hover:bg-accent"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      setIngredientToDelete(r.id);
                      setDeleteModalOpen(true);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
        {totalPages > 1 && pagedRows.length > 0 && (
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="inline-flex items-center justify-center h-9 px-3 rounded-lg border bg-background text-sm font-medium disabled:opacity-30 hover:bg-muted min-w-[96px]"
            >
              Sebelumnya
            </button>
            <span className="text-xs tabular-nums text-muted-foreground">
              Hal {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="inline-flex items-center justify-center h-9 px-3 rounded-lg border bg-background text-sm font-medium disabled:opacity-30 hover:bg-muted min-w-[96px]"
            >
              Selanjutnya
            </button>
          </div>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block -mx-4 md:mx-0">
        <DataTable
          columns={columns}
          data={displayRows}
          keyExtractor={(r) => r.id}
          searchable={false}
          page={page}
          onPageChange={setPage}
          sort={sort}
          onSortChange={(nextSort) => {
            setSort(nextSort);
            setPage(0);
          }}
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Tambah Bahan Baku"
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Kode</label>
              <input
                name="code"
                required
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Nama</label>
              <input
                name="name"
                required
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Alias (opsional)</label>
            <input
              name="alias"
              placeholder="Mask nama asli, contoh: Chicken HOT Level 1"
              className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <p className="text-xs text-muted-foreground">Kosong = tampilkan nama asli</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipe SKU</label>
              <select
                name="skuType"
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="RM">Raw Material</option>
                <option value="SFG">Semi-Finished Good</option>
                <option value="FG">Finished Good</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Kategori</label>
              <select
                name="category"
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Fresh">Fresh</option>
                <option value="Dry">Dry</option>
                <option value="Packaging">Packaging</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Satuan Beli</label>
              <input
                name="purchaseUnit"
                required
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Satuan Stok</label>
              <input
                name="stockUnit"
                required
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Konversi</label>
              <input
                name="conversionFactor"
                type="number"
                min={1}
                required
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">HPP (Rp)</label>
              <MoneyInput
                name="averageCost"
                defaultValue={0}
                required
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">ROP</label>
              <input
                name="rop"
                type="number"
                min={0}
                defaultValue={0}
                className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">MOQ</label>
            <input
              name="moq"
              type="number"
              min={1}
              defaultValue={1}
              className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">Tampil di Cabang</p>
              <p className="text-xs text-muted-foreground">
                Aktif = masuk katalog cabang (terlihat branch_admin). Nonaktif = hanya Gudang Pusat
                &amp; manajemen.
              </p>
            </div>
            <Switch
              checked={isBranchVisible}
              onCheckedChange={(checked) => {
                setIsBranchVisible(checked);
                // Auto-sync the branch option: turning ON defaults to "all branches".
                if (checked) setSelectedBranchIds([]);
              }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Ketersediaan Cabang</label>
            <p className="text-xs text-muted-foreground">
              Pilih cabang yang boleh melihat & memilih bahan ini. Kosong = semua cabang.
            </p>
            {!isBranchVisible && (
              <p className="text-xs text-amber-600">
                Nonaktif: bahan hanya untuk Gudang Pusat &amp; manajemen, pilihan cabang diabaikan.
              </p>
            )}
            <div className="rounded-lg border p-4 space-y-3">
              <label
                className={
                  "flex items-center gap-3 " +
                  (isBranchVisible ? "cursor-pointer" : "cursor-not-allowed opacity-60")
                }
              >
                <input
                  type="checkbox"
                  disabled={!isBranchVisible}
                  checked={selectedBranchIds.length === 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedBranchIds([]);
                    } else {
                      setSelectedBranchIds(branches.map((b) => b.id));
                    }
                  }}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <div>
                  <span className="text-sm font-medium">Semua cabang</span>
                  <p className="text-xs text-muted-foreground">Bahan tersedia di semua cabang</p>
                </div>
              </label>
            </div>
            {selectedBranchIds.length > 0 && isBranchVisible && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Pilih cabang:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {branches.map((b) => (
                    <label
                      key={b.id}
                      className="flex items-center gap-2 rounded-md border p-3 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedBranchIds.includes(b.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedBranchIds([...selectedBranchIds, b.id]);
                          } else {
                            setSelectedBranchIds(selectedBranchIds.filter((id) => id !== b.id));
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="h-10 md:h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              className="h-10 md:h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
            >
              Tambah
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setIngredientToDelete(null);
        }}
        title="Hapus Bahan Baku"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Yakin ingin menghapus bahan baku ini? Bahan akan dihapus dari daftar dan tidak dapat
            dikembalikan melalui aplikasi.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteModalOpen(false);
                setIngredientToDelete(null);
              }}
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Menghapus..." : "Hapus"}
            </Button>
          </div>
        </div>
      </Modal>
    </RoleGuard>
  );
}
