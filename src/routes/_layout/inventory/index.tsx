import { createFileRoute } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { lookupLabel } from "#/lib/label-lookup";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import type { Column } from "#/components/ui/DataTable";
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
  loader: async () => {
    const result = await getInventory({ data: {} });
    return { inventory: result.data, total: result.total };
  },
});

function InventoryPage() {
  const { user } = useAuth();
  const { inventory: initialData, total: initialTotal } = Route.useLoaderData();
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
    initialData: { data: initialData, total: initialTotal },
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

  const columns: Column<InvRow>[] = [
    { key: "ingredientCode", header: "Kode", width: "w-20", sortable: true },
    { key: "ingredientName", header: "Nama Bahan", sortable: true },
    {
      key: "ingredientSkuType",
      header: "SKU",
      width: "w-16",
      sortable: true,
      render: (r) => (
        <Badge variant="outline">{lookupLabel(skuLabels, r.ingredientSkuType ?? "") ?? "-"}</Badge>
      ),
    },
    {
      key: "ingredientCategory",
      header: "Kategori",
      width: "w-24",
      sortable: true,
      render: (r) =>
        r.ingredientCategory ? (
          <Badge variant={catColors[r.ingredientCategory]}>{r.ingredientCategory}</Badge>
        ) : (
          "-"
        ),
    },
    {
      key: "quantity",
      header: "Stok",
      align: "right",
      width: "w-24",
      sortable: true,
      render: (r) => `${r.quantity.toLocaleString("id-ID")} ${r.stockUnit ?? ""}`,
    },
  ];

  if (showBranchColumn) {
    columns.splice(2, 0, { key: "branchName", header: "Cabang", width: "w-40", sortable: true });
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
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {canFilterBranches && branches && (
          <select
            value={branchId ?? ""}
            onChange={(e) => {
              setFilter("branchId", e.target.value);
              setPage(0);
            }}
            className="h-8 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Semua Cabang</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        {canFilterBranches && (
          <div className="flex gap-1.5">
            {(["", "Central", "Outlet"] as const).map((loc) => (
              <button
                key={loc || "all-loc"}
                onClick={() => {
                  setFilter("locationType", loc);
                  setPage(0);
                }}
                className={`h-8 px-3 rounded-md text-xs font-medium transition-colors ${locationType === loc ? "bg-secondary text-secondary-foreground" : "border hover:bg-muted"}`}
              >
                {loc === "" ? "Semua Lokasi" : loc === "Central" ? "Pusat" : "Cabang"}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {(["", "Fresh", "Dry", "Packaging"] as const).map((cat) => (
            <button
              key={cat || "all"}
              onClick={() => {
                setFilter("category", cat);
                setPage(0);
              }}
              className={`h-8 px-3 rounded-md text-xs font-medium transition-colors ${category === cat ? "bg-secondary text-secondary-foreground" : "border hover:bg-muted"}`}
            >
              {cat || "Semua"}
            </button>
          ))}
          {negativeFilter && (
            <Badge variant="destructive" className="h-8 px-3 rounded-md text-xs">
              Stok Negatif
            </Badge>
          )}
        </div>
        <div className="relative flex-1 max-w-xs ml-auto">
          <input
            type="text"
            placeholder="Cari bahan..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        {user?.role === "super_admin" && (
          <>
            <button
              onClick={() => setModalOpen(true)}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              Sesuaikan Stok
            </button>
            <button
              onClick={() => setCleanSlateOpen(true)}
              className="h-8 px-3 rounded-md border border-destructive text-destructive text-sm font-medium hover:bg-destructive/10"
            >
              Clean Slate
            </button>
          </>
        )}
      </div>

      <DataTable
        columns={columns}
        data={inventory}
        keyExtractor={(r) => r.id}
        searchable={false}
        pagination={false}
        sort={sort}
        onSortChange={(newSort) => {
          setSort(newSort);
          setPage(0);
        }}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{total} item</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="h-7 px-2 rounded border disabled:opacity-30 hover:bg-muted"
            >
              Sebelumnya
            </button>
            <span>
              Halaman {page + 1} dari {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="h-7 px-2 rounded border disabled:opacity-30 hover:bg-muted"
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
