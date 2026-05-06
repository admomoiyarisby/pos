import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import { getInventory } from "#/lib/server/inventory";
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
    const inventory = await getInventory({ data: {} });
    return { inventory };
  },
});

function InventoryPage() {
  const { user } = useAuth();
  const { inventory: initial } = Route.useLoaderData();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"Fresh" | "Dry" | "Packaging" | "">("");

  const { data: inventory } = useQuery({
    queryKey: ["inventory", search, category],
    queryFn: () =>
      getInventory({ data: { search: search || undefined, category: category || null } }),
    initialData: initial,
  });

  const showBranchColumn =
    user?.role === "super_admin" || user?.role === "area_manager" || user?.role === "admin_pusat";

  const columns: Column<InvRow>[] = [
    { key: "ingredientCode", header: "Kode", width: "w-20" },
    { key: "ingredientName", header: "Nama Bahan" },
    {
      key: "ingredientSkuType",
      header: "SKU",
      width: "w-16",
      render: (r) => <Badge variant="outline">{skuLabels[r.ingredientSkuType ?? ""] ?? "-"}</Badge>,
    },
    {
      key: "ingredientCategory",
      header: "Kategori",
      width: "w-24",
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
      render: (r) => `${r.quantity.toLocaleString("id-ID")} ${r.stockUnit ?? ""}`,
    },
  ];

  if (showBranchColumn) {
    columns.splice(2, 0, { key: "branchName", header: "Cabang", width: "w-40" });
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

      <DataTable columns={columns} data={inventory} keyExtractor={(r) => r.id} pageSize={15} />
    </RoleGuard>
  );
}
