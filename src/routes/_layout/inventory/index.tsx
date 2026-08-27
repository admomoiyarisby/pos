import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { UnknownRecord } from "#/lib/unknown-record";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { lookupLabel } from "#/lib/label-lookup";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import { getInventory } from "#/lib/server/inventory";
import { getBranches } from "#/lib/server/branches";
import { getIngredients } from "#/lib/server/ingredients";
import StockAdjustmentModal from "#/components/inventory/StockAdjustmentModal";
import CleanSlateModal from "#/components/inventory/CleanSlateModal";
import type { IngredientOption } from "#/components/inventory/StockAdjustmentModal";
import { useAuth } from "#/lib/auth-context";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "#/components/ui/badge";

interface InvRow {
  id: string;
  branchId: string;
  ingredientId: string;
  quantity: number;
  ingredientName: string | null;
  ingredientCode: string | null;
  ingredientCategory: "Fresh" | "Dry" | "Packaging" | null;
  ingredientSkuType: "RM" | "SFG" | "FG" | null;
  purchaseUnit: string | null;
  stockUnit: string | null;
  branchName: string | null;
}

const catColors = {
  Fresh: "destructive",
  Dry: "secondary",
  Packaging: "default",
} satisfies Record<string, "default" | "destructive" | "secondary">;

const skuLabels = { RM: "RM", SFG: "SFG", FG: "FG" } satisfies Record<string, string>;

export const Route = createFileRoute("/_layout/inventory/")({
  component: InventoryPage,
  validateSearch: (search: UnknownRecord) => ({
    search: z.string().optional().catch(undefined).parse(search.search),
    page: z.coerce.number().int().min(0).optional().catch(undefined).parse(search.page),
    sortKey: z.string().optional().catch(undefined).parse(search.sortKey),
    sortDir: z.enum(["asc", "desc"]).optional().catch(undefined).parse(search.sortDir),
    category: z
      .enum(["Fresh", "Dry", "Packaging"])
      .optional()
      .catch(undefined)
      .parse(search.category),
    branchId: z.string().optional().catch(undefined).parse(search.branchId),
    locationType: z
      .enum(["Central", "Outlet"])
      .optional()
      .catch(undefined)
      .parse(search.locationType),
    negative: z.string().optional().catch(undefined).parse(search.negative),
  }),
  loaderDeps: ({ search }) => ({
    search: search.search,
    page: search.page,
    sortKey: search.sortKey,
    sortDir: search.sortDir,
    category: search.category,
    branchId: search.branchId,
    locationType: search.locationType,
    negative: search.negative,
  }),
  loader: async ({ deps }) => {
    const result = await getInventory({
      data: {
        search: deps.search,
        page: deps.page ?? 0,
        limit: 25,
        // SAFETY: validateSearch restricts these to the declared literals.
        category: (deps.category as "Fresh" | "Dry" | "Packaging" | null) ?? null,
        branchId: deps.branchId,
        // SAFETY: validateSearch restricts to Central/Outlet.
        locationType: (deps.locationType as "Central" | "Outlet" | null) ?? null,
        negative: deps.negative === "true" ? true : undefined,
        sortBy: deps.sortKey,
        sortOrder: deps.sortDir,
      },
    });
    return { inventory: result.data, total: result.total };
  },
});

function InventoryPage() {
  const { user } = useAuth();
  const { inventory: initialInventory, total: initialTotal } = Route.useLoaderData();
  const [search, setSearch, committedSearch] = useTableSearch({ debounceMs: 250 });
  const {
    page,
    setPage,
    sort,
    setSort,
    filters: { category, branchId, locationType, negative },
    setFilter,
  } = useTableUrlState<{
    category?: string;
    branchId?: string;
    locationType?: string;
    negative?: string;
  }>(["category", "branchId", "locationType", "negative"]);
  const pageSize = 25;

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ data: {} }),
  });

  const canFilterBranches =
    user?.role === "super_admin" || user?.role === "admin_pusat" || user?.role === "area_manager";

  const negativeFilter = negative === "true";

  const { data: result } = useQuery({
    queryKey: [
      "inventory",
      committedSearch,
      category,
      branchId,
      locationType,
      page,
      negativeFilter,
      sort,
    ],
    queryFn: () =>
      getInventory({
        data: {
          search: committedSearch || undefined,
          // SAFETY: the category/location filter controls only offer the
          // declared literals.
          category: (category || null) as "Fresh" | "Dry" | "Packaging" | null,
          branchId: branchId || undefined,
          // SAFETY: the location filter only offers Central/Outlet.
          locationType: (locationType || null) as "Central" | "Outlet" | null,
          page,
          limit: pageSize,
          negative: negativeFilter || undefined,
          sortBy: sort?.key || undefined,
          sortOrder: sort?.dir || undefined,
        },
      }),
    initialData: { data: initialInventory, total: initialTotal },
    placeholderData: (previous) => previous,
  });

  const inventory = result?.data ?? [];
  const total = result?.total ?? 0;

  // Stock-adjustment support: the "Sesuaikan Stok" modal operates on the
  // currently-selected (or first) branch and needs the full branch stock map
  // plus the master ingredient list.
  const effectiveBranchId = branchId || branches?.[0]?.id || "";
  const branchName =
    branches?.find((b) => b.id === effectiveBranchId)?.name ?? (effectiveBranchId || "—");

  const { data: ingredients } = useQuery({
    queryKey: ["ingredients", "all"],
    queryFn: () => getIngredients({ data: { excludeNasi: true } }),
  });

  const { data: fullInventory } = useQuery({
    queryKey: ["inventory", "all-for-adjust", effectiveBranchId],
    queryFn: () =>
      getInventory({ data: { branchId: effectiveBranchId || undefined, limit: 1000 } }),
    enabled: !!effectiveBranchId,
  });

  const stockByIngredient = useMemo(() => {
    const m = new Map<string, number>();
    for (const inv of fullInventory?.data ?? []) {
      m.set(inv.ingredientId, inv.quantity);
    }
    return m;
  }, [fullInventory]);

  const ingredientOptions = useMemo<IngredientOption[]>(() => {
    return (ingredients ?? [])
      .map((i) => {
        const stockQty = stockByIngredient.get(i.id) ?? 0;
        const hasRow = stockByIngredient.has(i.id);
        return {
          id: i.id,
          name: i.name,
          code: i.code,
          stockUnit: i.stockUnit,
          category: i.category,
          label: `${i.name} (${i.stockUnit})`,
          stockQty,
          hasInventory: hasRow,
          keywords: [i.code ?? "", i.stockUnit],
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ingredients, stockByIngredient]);

  const [modalOpen, setModalOpen] = useState(false);
  const [cleanSlateOpen, setCleanSlateOpen] = useState(false);

  const totalPages = Math.ceil(total / pageSize) || 1;

  const showBranchColumn =
    user?.role === "super_admin" || user?.role === "area_manager" || user?.role === "admin_pusat";

  const columns: ColumnDef<InvRow>[] = [
    { accessorKey: "ingredientCode", header: "Kode", width: "w-20", enableSorting: true },
    { accessorKey: "ingredientName", header: "Nama Bahan", enableSorting: true },
    {
      accessorKey: "ingredientSkuType",
      header: "SKU",
      width: "w-16",
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline">
          {lookupLabel(skuLabels, row.original.ingredientSkuType ?? "") ?? "-"}
        </Badge>
      ),
    },
    {
      accessorKey: "ingredientCategory",
      header: "Kategori",
      width: "w-24",
      enableSorting: true,
      cell: ({ row }) =>
        row.original.ingredientCategory ? (
          <Badge variant={catColors[row.original.ingredientCategory]}>
            {row.original.ingredientCategory}
          </Badge>
        ) : (
          "-"
        ),
    },
    {
      accessorKey: "quantity",
      header: "Stok",
      align: "right",
      width: "w-24",
      enableSorting: true,
      cell: ({ row }) =>
        `${row.original.quantity.toLocaleString("id-ID")} ${row.original.stockUnit ?? ""}`,
    },
  ];

  if (showBranchColumn) {
    columns.splice(2, 0, {
      accessorKey: "branchName",
      header: "Cabang",
      width: "w-40",
      enableSorting: true,
    });
  }
  usePageTitle("Stok Saat Ini", "Real-time inventory per cabang");

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
      {/* ── Adaptive toolbar: mobile-first, search always visible ── */}
      <div className="mb-4 space-y-3">
        {/* Row 1 — Search (full-width on mobile, capped on desktop) + primary actions */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-[380px] sm:min-w-[240px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              aria-label="Cari bahan"
              placeholder="Cari bahan, kode, SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-9 text-[16px] shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring sm:h-9 sm:rounded-lg sm:text-sm"
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

          {user?.role === "super_admin" && (
            <div className="flex gap-2 sm:ml-auto">
              <button
                onClick={() => setModalOpen(true)}
                className="inline-flex flex-1 sm:flex-none items-center justify-center h-10 sm:h-9 px-4 rounded-xl sm:rounded-md bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:bg-primary/90 active:scale-[0.98] transition-all whitespace-nowrap"
              >
                Sesuaikan Stok
              </button>
              <button
                onClick={() => setCleanSlateOpen(true)}
                className="inline-flex flex-1 sm:flex-none items-center justify-center h-10 sm:h-9 px-4 rounded-xl sm:rounded-md border border-destructive/30 bg-background text-destructive text-sm font-medium hover:bg-destructive/10 active:scale-[0.98] transition-all whitespace-nowrap"
              >
                Clean Slate
              </button>
            </div>
          )}
        </div>

        {/* Row 2 — Filters: branch select + chip scrollers */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          {canFilterBranches && branches && (
            <select
              value={branchId ?? ""}
              onChange={(e) => {
                setFilter("branchId", e.target.value);
                setPage(0);
              }}
              aria-label="Filter cabang"
              className="h-11 w-full sm:h-9 sm:w-auto sm:min-w-[160px] rounded-xl sm:rounded-md border border-input bg-background px-3.5 pr-8 text-[16px] sm:text-sm font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Semua Cabang</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          {/* Scrollable chip groups — edge-to-edge on mobile */}
          <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0 pb-0.5 sm:pb-0 snap-x snap-mandatory flex-nowrap">
            {canFilterBranches && (
              <div className="flex items-center gap-1.5 shrink-0 snap-start pr-1 mr-1 border-r border-border/60 sm:border-r-0 sm:pr-0 sm:mr-0">
                {(["", "Central", "Outlet"] as const).map((loc) => {
                  const active = locationType === loc;
                  return (
                    <button
                      key={loc || "all-loc"}
                      onClick={() => {
                        setFilter("locationType", loc);
                        setPage(0);
                      }}
                      aria-pressed={active}
                      className={`shrink-0 snap-start inline-flex items-center h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${active ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
                    >
                      {loc === "" ? "Semua Lokasi" : loc === "Central" ? "Pusat" : "Cabang"}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-1.5 shrink-0 snap-start">
              {(["", "Fresh", "Dry", "Packaging"] as const).map((cat) => {
                const active = category === cat;
                return (
                  <button
                    key={cat || "all"}
                    onClick={() => {
                      setFilter("category", cat);
                      setPage(0);
                    }}
                    aria-pressed={active}
                    className={`shrink-0 snap-start inline-flex items-center h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${active ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
                  >
                    {cat || "Semua"}
                  </button>
                );
              })}
            </div>

            {negativeFilter && (
              <button
                onClick={() => setFilter("negative", "")}
                aria-label="Hapus filter stok negatif"
                className="shrink-0 snap-start inline-flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-full text-xs font-medium bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 transition-colors whitespace-nowrap"
              >
                Stok Negatif
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20">
                  <X className="h-3 w-3" />
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile meta — results hint */}
        <div className="flex items-center justify-between sm:hidden text-xs">
          <span className="text-muted-foreground tabular-nums">
            {total} bahan • Hal {page + 1} / {totalPages}
          </span>
          {(category || branchId || locationType || negativeFilter || search) && (
            <button
              onClick={() => {
                setFilter("category", "");
                setFilter("branchId", "");
                setFilter("locationType", "");
                setFilter("negative", "");
                setSearch("");
                setPage(0);
              }}
              className="font-medium text-primary hover:underline underline-offset-4"
            >
              Reset filter
            </button>
          )}
        </div>
      </div>

      {/* Table — bleeds to screen edge on mobile for max scroll width */}
      <div className="-mx-4 md:mx-0 px-0">
        <DataTable
          columns={columns}
          data={inventory}
          keyExtractor={(r) => r.id}
          searchable={false}
          pagination={false}
          pageSize={pageSize}
          features={{ filtering: false, sorting: false, pagination: false }}
          search={search}
          onSearchChange={setSearch}
          sort={sort}
          onSortChange={(newSort) => {
            setSort(newSort);
            setPage(0);
          }}
        />
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm sm:text-xs text-muted-foreground border-t pt-3 sm:border-0 sm:pt-0">
          <span className="hidden sm:inline tabular-nums">{total} item</span>
          <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="inline-flex items-center justify-center h-9 sm:h-7 px-3 sm:px-2 rounded-lg sm:rounded border bg-background text-sm sm:text-xs font-medium disabled:opacity-30 hover:bg-muted active:scale-[0.98] transition-all min-w-[96px] sm:min-w-0"
            >
              Sebelumnya
            </button>
            <span className="text-xs tabular-nums text-center px-2">
              Hal {page + 1} / {totalPages}
              <span className="hidden sm:inline">
                {" "}
                • Halaman {page + 1} dari {totalPages}
              </span>
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="inline-flex items-center justify-center h-9 sm:h-7 px-3 sm:px-2 rounded-lg sm:rounded border bg-background text-sm sm:text-xs font-medium disabled:opacity-30 hover:bg-muted active:scale-[0.98] transition-all min-w-[96px] sm:min-w-0"
            >
              Selanjutnya
            </button>
          </div>
        </div>
      )}

      <StockAdjustmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        branches={branches ?? []}
        defaultBranchId={effectiveBranchId}
        ingredientOptions={ingredientOptions}
        stockByIngredient={stockByIngredient}
      />

      <CleanSlateModal
        open={cleanSlateOpen}
        onClose={() => setCleanSlateOpen(false)}
        branchId={branchId ?? ""}
        branchName={branchId ? branchName : "SEMUA CABANG"}
      />
    </RoleGuard>
  );
}
