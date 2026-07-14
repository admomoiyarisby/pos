import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import { getInventory } from "#/lib/server/inventory";
import { getBranches } from "#/lib/server/branches";
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

const catColors: Record<string, "default" | "destructive" | "secondary"> = {
  Fresh: "destructive",
  Dry: "secondary",
  Packaging: "default",
};

const skuLabels: Record<string, string> = { RM: "RM", SFG: "SFG", FG: "FG" };

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
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"Fresh" | "Dry" | "Packaging" | "">("");
  const [branchId, setBranchId] = useState("");
  const [locationType, setLocationType] = useState<"" | "Central" | "Outlet">("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const pageSize = 25;

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ data: {} }),
  });

  const canFilterBranches =
    user?.role === "super_admin" || user?.role === "admin_pusat" || user?.role === "area_manager";

  const { negative: negativeParam } = Route.useSearch() as { negative?: string };
  const negativeFilter = negativeParam === "true";

  const { data: result } = useQuery({
    queryKey: ["inventory", search, category, branchId, locationType, page, negativeFilter, sort],
    queryFn: () =>
      getInventory({
        data: {
          search: search || undefined,
          category: category || null,
          branchId: branchId || undefined,
          locationType: locationType || null,
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
      render: (r) => <Badge variant="outline">{skuLabels[r.ingredientSkuType ?? ""] ?? "-"}</Badge>,
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
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
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
                  setLocationType(loc);
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
              onClick={() => setCategory(cat)}
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
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="h-7 px-2 rounded border disabled:opacity-30 hover:bg-muted"
            >
              Sebelumnya
            </button>
            <span>
              Halaman {page + 1} dari {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="h-7 px-2 rounded border disabled:opacity-30 hover:bg-muted"
            >
              Selanjutnya
            </button>
          </div>
        </div>
      )}
    </RoleGuard>
  );
}
