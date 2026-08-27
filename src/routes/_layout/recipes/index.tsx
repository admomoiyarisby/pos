import { createFileRoute, Link } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { toast } from "sonner";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { RecipeWizard } from "#/components/RecipeWizard";
import { getRecipes, createRecipe, recalculateAllRecipeCosts } from "#/lib/server/recipes";
import { getBrands } from "#/lib/server/brands";
import { getBranches } from "#/lib/server/branches";
import { getCategories } from "#/lib/server/categories";
import { getModifierGroups } from "#/lib/server/modifier-groups";
import { useAuth } from "#/lib/auth-context";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  ArrowRight,
  RefreshCw,
  Zap,
  Package,
  Image as ImageIcon,
  Search,
  X,
  Plus,
  Layers,
  Tag,
} from "lucide-react";

interface RecipeRow {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  categoryName: string | null;
  isSubRecipe: boolean;
  basePrice: number;
  totalCogs: number;
  isBOGO: boolean;
  hasChildren: boolean;
  status: "Active" | "Inactive" | "Deleted";
  brands: { id: string; name: string | null }[];
  imageUrl?: string | null;
}

export const Route = createFileRoute("/_layout/recipes/")({
  component: RecipesPage,
  loader: async () => {
    const [recipes, brands, branches, categories] = await Promise.all([
      getRecipes({ data: {} }),
      getBrands({ data: {} }),
      getBranches({ data: {} }),
      getCategories({}),
    ]);
    return { recipes, brands, branches, categories };
  },
});

function RecipesPage() {
  const [search, setSearch] = useTableSearch();
  // URL-persisted table state (page/sort/status/category) so returning from a
  // recipe detail page restores exactly where the operator left off.
  const { page, setPage, sort, setSort, filters, setFilter } = useTableUrlState<{
    status?: string;
    category?: string;
  }>(["status", "category"]);
  const statusParam = filters.status;
  const statusFilter = statusParam === "Active" || statusParam === "Inactive" ? statusParam : "All";
  const setStatusFilter = (next: string) => {
    setFilter("status", next === "All" ? undefined : next);
    setPage(0);
  };
  const categoryFilter = filters.category ?? "all";
  const setCategoryFilter = (next: string) => {
    setFilter("category", next === "all" ? undefined : next);
    setPage(0);
  };
  const {
    recipes: initial,
    brands,
    branches,
    categories: initialCategories,
  } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const user = useAuth().user;

  const { data: recipes } = useQuery({
    queryKey: ["recipes", statusFilter],
    queryFn: () =>
      getRecipes({ data: { status: statusFilter === "All" ? undefined : statusFilter } }),
    initialData: initial,
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories({}),
    initialData: initialCategories,
  });

  const filteredRecipes =
    categoryFilter === "all" ? recipes : recipes.filter((r) => r.categoryId === categoryFilter);

  const { data: allModifierGroups } = useQuery({
    queryKey: ["modifier-groups"],
    queryFn: () => getModifierGroups({ data: {} }),
  });

  const createMutation = useMutation({
    mutationFn: createRecipe,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setModalOpen(false);
      toast.success("Menu berhasil ditambahkan");
    },
    onError: (err) => {
      toast.error("Gagal menambah menu", { description: err.message });
    },
  });

  const recalcMutation = useMutation({
    mutationFn: recalculateAllRecipeCosts,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
  });

  const displayRows = useMemo(() => {
    if (!search.trim()) return filteredRecipes;
    const q = search.toLowerCase();
    return filteredRecipes.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.categoryName ?? "").toLowerCase().includes(q),
    );
  }, [filteredRecipes, search]);
  const totalPages = Math.ceil(displayRows.length / 15) || 1;
  const pagedRows = useMemo(
    () => displayRows.slice(page * 15, (page + 1) * 15),
    [displayRows, page],
  );
  const hasActiveFilters = !!(search.trim() || statusFilter !== "All" || categoryFilter !== "all");

  usePageTitle("Menu / Resep", "Kelola master menu, BOM, dan bundling");

  const columns: ColumnDef<RecipeRow>[] = [
    {
      accessorKey: "image",
      header: "",
      width: "w-9",
      align: "center",
      cellClassName: "!p-0 !min-w-0",
      cell: ({ row }) =>
        row.original.imageUrl ? (
          <img
            src={row.original.imageUrl}
            alt={row.original.name}
            loading="lazy"
            decoding="async"
            className="h-8 w-8 rounded-lg border bg-muted object-cover"
          />
        ) : (
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg border bg-muted">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          </div>
        ),
    },
    { accessorKey: "code", header: "Kode", width: "w-24", enableSorting: true },
    { accessorKey: "name", header: "Nama Menu", enableSorting: true },
    {
      accessorKey: "categoryName",
      header: "Kategori",
      enableSorting: true,
      cell: ({ row }) => <Badge variant="secondary">{row.original.categoryName ?? "—"}</Badge>,
    },
    {
      accessorKey: "type",
      header: "Tipe",
      width: "w-28",
      cell: ({ row }) => (
        <div className="flex gap-1">
          {row.original.isBOGO && (
            <Badge variant="warning" className="text-xs gap-0.5">
              <Zap className="h-3 w-3" /> BOGO
            </Badge>
          )}
          {row.original.hasChildren && (
            <Badge
              variant="outline"
              className="text-xs gap-0.5 border-info text-info-foreground bg-info/10"
            >
              <Package className="h-3 w-3" /> Paket
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: "basePrice",
      header: "Harga Dasar",
      align: "right",
      enableSorting: true,
      cell: ({ row }) => `Rp ${row.original.basePrice.toLocaleString("id-ID")}`,
    },
    {
      accessorKey: "totalCogs",
      header: "HPP Total",
      align: "right",
      enableSorting: true,
      cell: ({ row }) => {
        const pct =
          row.original.totalCogs > 0 && row.original.basePrice > 0
            ? (row.original.totalCogs / row.original.basePrice) * 100
            : 0;
        return (
          <div className="flex items-center gap-1.5 justify-end">
            <span>Rp {row.original.totalCogs.toLocaleString("id-ID")}</span>
            {pct > 40 && (
              <Badge variant="destructive" className="text-xs">
                &gt;40%
              </Badge>
            )}
          </div>
        );
      },
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
      accessorKey: "id",
      header: "",
      width: "w-12",
      cell: ({ row }) => (
        <Link
          to="/recipes/$recipeId"
          params={{ recipeId: row.original.id }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowRight className="h-4 w-4" />
        </Link>
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      {/* ── Toolbar: search + actions (mobile-first) ── */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-[380px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              aria-label="Cari menu"
              placeholder="Cari kode, nama menu…"
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
          <div className="flex gap-2 sm:ml-auto w-full sm:w-auto">
            <Button
              onClick={() => setModalOpen(true)}
              className="flex-1 sm:flex-none h-11 sm:h-9 rounded-xl sm:rounded-md shadow-sm"
            >
              <Plus className="h-4 w-4" />
              Tambah Menu
            </Button>
            {user?.role === "super_admin" && (
              <Button
                variant="outline"
                onClick={() => recalcMutation.mutateAsync({})}
                disabled={recalcMutation.isPending}
                className="flex-1 sm:flex-none h-11 sm:h-9 rounded-xl sm:rounded-md shadow-xs"
              >
                <RefreshCw
                  className={"h-4 w-4 " + (recalcMutation.isPending ? "animate-spin" : "")}
                />
                {recalcMutation.isPending ? "Menghitung..." : "Hitung Ulang"}
              </Button>
            )}
          </div>
        </div>
        {/* Filter pills — edge bleed on mobile */}
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 snap-x snap-mandatory">
          <div className="flex items-center gap-1.5 shrink-0 snap-start">
            {(["All", "Active", "Inactive"] as const).map((s) => {
              const active = statusFilter === s;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  aria-pressed={active}
                  className={`shrink-0 snap-start inline-flex items-center gap-1 h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${active ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
                >
                  {s === "All" ? "Semua" : s === "Active" ? "Aktif" : "Nonaktif"}
                </button>
              );
            })}
          </div>
          <div className="h-5 w-px bg-border shrink-0 hidden sm:block" />
          <div className="flex items-center gap-1.5 shrink-0 snap-start">
            <button
              onClick={() => setCategoryFilter("all")}
              aria-pressed={categoryFilter === "all"}
              className={`shrink-0 snap-start inline-flex items-center gap-1 h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${categoryFilter === "all" ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
            >
              <Layers className="h-3 w-3" />
              Semua Kategori
            </button>
            {(categories ?? []).map((c) => {
              const active = categoryFilter === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setCategoryFilter(c.id)}
                  aria-pressed={active}
                  className={`shrink-0 snap-start inline-flex items-center h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap max-w-[160px] truncate ${active ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between sm:hidden text-xs">
          <span className="text-muted-foreground tabular-nums">
            {displayRows.length} menu • Hal {page + 1}/{totalPages}
          </span>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("All");
                setCategoryFilter("all");
                setPage(0);
              }}
              className="font-medium text-primary hover:underline underline-offset-4"
            >
              Reset filter
            </button>
          )}
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2.5 -mx-4 px-4">
        {pagedRows.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Tag className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium">
              {hasActiveFilters ? "Tidak ada hasil" : "Belum ada menu"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {hasActiveFilters
                ? `Tidak ada menu untuk "${search}" atau filter terpilih.`
                : "Tambah menu pertama untuk memulai."}
            </p>
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("All");
                  setCategoryFilter("all");
                  setPage(0);
                }}
              >
                Reset filter
              </Button>
            )}
          </div>
        ) : (
          pagedRows.map((r) => {
            const pct = r.totalCogs > 0 && r.basePrice > 0 ? (r.totalCogs / r.basePrice) * 100 : 0;
            return (
              <Link
                key={r.id}
                to="/recipes/$recipeId"
                params={{ recipeId: r.id }}
                className="block rounded-xl border bg-card p-3.5 shadow-xs active:scale-[0.99] transition-transform"
              >
                <div className="flex gap-3">
                  {r.imageUrl ? (
                    <img
                      src={r.imageUrl}
                      alt={r.name}
                      loading="lazy"
                      className="h-12 w-12 rounded-xl border bg-muted object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-xl border bg-muted flex items-center justify-center shrink-0">
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-muted-foreground truncate">
                          {r.code}
                        </div>
                        <div className="font-medium text-sm leading-tight truncate">{r.name}</div>
                      </div>
                      <Badge
                        variant={r.status === "Active" ? "success" : "secondary"}
                        className="shrink-0 rounded-full text-[11px] px-2 py-0 h-5"
                      >
                        {r.status === "Active" ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                      <Badge
                        variant="secondary"
                        className="text-[11px] px-2 py-0 h-5 max-w-[120px] truncate"
                      >
                        {r.categoryName ?? "—"}
                      </Badge>
                      {r.isBOGO && (
                        <Badge variant="warning" className="text-[11px] px-1.5 py-0 h-5 gap-1">
                          <Zap className="h-3 w-3" />
                          BOGO
                        </Badge>
                      )}
                      {r.hasChildren && (
                        <Badge
                          variant="outline"
                          className="text-[11px] px-1.5 py-0 h-5 gap-1 border-info text-info-foreground bg-info/10"
                        >
                          <Package className="h-3 w-3" />
                          Paket
                        </Badge>
                      )}
                      {pct > 40 && (
                        <Badge variant="destructive" className="text-[11px] px-1.5 py-0 h-5">
                          HPP &gt;40%
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/40 px-2.5 py-2">
                    <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                      Harga Dasar
                    </div>
                    <div className="font-mono text-sm font-semibold tabular-nums">
                      Rp {r.basePrice.toLocaleString("id-ID")}
                    </div>
                  </div>
                  <div
                    className={`rounded-lg px-2.5 py-2 ${pct > 40 ? "bg-destructive/10 border border-destructive/20" : "bg-muted/40"}`}
                  >
                    <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                      HPP Total
                    </div>
                    <div className="font-mono text-sm font-semibold tabular-nums">
                      Rp {r.totalCogs.toLocaleString("id-ID")}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <span className="inline-flex items-center gap-1 text-primary text-xs font-medium">
                    Detail <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </Link>
            );
          })
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
          onSortChange={setSort}
        />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Tambah Menu" size="3xl">
        <RecipeWizard
          brands={brands}
          branches={branches}
          modifierGroups={allModifierGroups ?? []}
          recipes={recipes ?? []}
          onSubmit={async (data) => {
            await createMutation.mutateAsync({ data });
            void queryClient.invalidateQueries({ queryKey: ["recipes"] });
          }}
          onCancel={() => setModalOpen(false)}
          isPending={createMutation.isPending}
          submitLabel="Tambah"
        />
      </Modal>
    </RoleGuard>
  );
}
