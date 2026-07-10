import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { getBranches } from "#/lib/server/branches";
import { getAuditInventory } from "#/lib/server/audit-inventory";

const CHANNELS = [
  { label: "Semua", value: "" },
  { label: "Offline (Dine-in)", value: "Dine-in" },
  { label: "Gojek (Gofood)", value: "Gofood" },
  { label: "Grab (Grabfood)", value: "Grabfood" },
  { label: "Shopee (ShopeeFood)", value: "ShopeeFood" },
  { label: "TikTok (TikTok)", value: "TikTok" },
];

function formatQty(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString("id-ID");
  return n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

export const Route = createFileRoute("/_layout/audit-inventory")({
  component: AuditInventoryPage,
  loader: async () => {
    const branches = await getBranches({ data: {} });
    return { branches };
  },
});

function AuditInventoryPage() {
  const { branches } = Route.useLoaderData();
  usePageTitle("Audit Inventory", "Konsumsi bahan per resep berdasarkan penjualan");

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [selectedChannel, setSelectedChannel] = useState<string>("");

  // Compute date range from month
  const { dateFrom, dateTo } = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      dateFrom: `${selectedMonth}-01`,
      dateTo: `${selectedMonth}-${String(lastDay).padStart(2, "0")}`,
    };
  }, [selectedMonth]);

  const { data: recipes, isLoading } = useQuery({
    queryKey: ["audit-inventory", dateFrom, dateTo, selectedBranchId, selectedChannel],
    queryFn: () =>
      getAuditInventory({
        data: {
          dateFrom,
          dateTo,
          branchId: selectedBranchId || undefined,
          channel: selectedChannel || undefined,
        },
      }),
  });

  // Aggregate ingredients across all recipes for grand totals
  const ingredientTotals = useMemo(() => {
    if (!recipes) return new Map<string, { name: string; unit: string; total: number }>();
    const map = new Map<string, { name: string; unit: string; total: number }>();
    for (const recipe of recipes) {
      for (const ing of recipe.ingredients) {
        const existing = map.get(ing.ingredientId);
        if (existing) {
          existing.total += ing.totalConsumed;
        } else {
          map.set(ing.ingredientId, {
            name: ing.ingredientName,
            unit: ing.unit,
            total: ing.totalConsumed,
          });
        }
      }
    }
    return map;
  }, [recipes]);

  const totalServings = useMemo(
    () => recipes?.reduce((s, r) => s + r.servingsSold, 0) ?? 0,
    [recipes],
  );

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-6 p-4 rounded-lg border">
        {/* Month picker */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Bulan</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
          />
        </div>

        {/* Branch */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Cabang</label>
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
          >
            <option value="">Semua Cabang</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {/* Channel */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Channel</label>
          <select
            value={selectedChannel}
            onChange={(e) => setSelectedChannel(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
          >
            {CHANNELS.map((c) => (
              <option key={c.label} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Summary stat */}
        <div className="ml-auto text-right">
          <div className="text-xs text-muted-foreground">Total Resep</div>
          <div className="text-lg font-semibold tabular-nums">{recipes?.length ?? 0}</div>
        </div>
      </div>

      {/* Consumption table */}
      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2.5 px-3 font-medium">Menu / Bahan</th>
                <th className="text-right py-2.5 px-3 font-medium w-28">Berat/Serving</th>
                <th className="text-left py-2.5 px-3 font-medium w-20">Satuan</th>
                <th className="text-right py-2.5 px-3 font-medium w-24">Porsi</th>
                <th className="text-right py-2.5 px-3 font-medium w-32">Total Terpakai</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-muted-foreground">
                    Memuat data audit inventory…
                  </td>
                </tr>
              ) : recipes && recipes.length > 0 ? (
                recipes.map((recipe) => <RecipeGroup key={recipe.recipeId} recipe={recipe} />)
              ) : (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-muted-foreground">
                    Tidak ada data penjualan untuk periode ini
                  </td>
                </tr>
              )}
            </tbody>
            {recipes && recipes.length > 0 && (
              <tfoot>
                <tr className="border-t-2 font-semibold bg-muted/40">
                  <td className="py-2.5 px-3">TOTAL BAHAN TERPAKAI</td>
                  <td className="py-2.5 px-3"></td>
                  <td className="py-2.5 px-3"></td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    {totalServings.toLocaleString("id-ID")}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">
                    {ingredientTotals.size} jenis bahan
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Bahan summary — aggregated consumption per ingredient across all recipes */}
      {ingredientTotals.size > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold mb-3">Rekap Konsumsi per Bahan</h3>
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2.5 px-3 font-medium">Bahan</th>
                    <th className="text-left py-2.5 px-3 font-medium w-20">Satuan</th>
                    <th className="text-right py-2.5 px-3 font-medium w-36">Total Terpakai</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(ingredientTotals.values())
                    .sort((a, b) => b.total - a.total)
                    .map((item) => (
                      <tr key={item.name} className="border-b">
                        <td className="py-2 px-3">{item.name}</td>
                        <td className="py-2 px-3 text-muted-foreground">{item.unit}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-medium">
                          {formatQty(item.total)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </RoleGuard>
  );
}

function RecipeGroup({
  recipe,
}: {
  recipe: {
    recipeId: string;
    recipeName: string;
    servingsSold: number;
    ingredients: Array<{
      ingredientId: string;
      ingredientName: string;
      quantityPerServing: number;
      unit: string;
      totalConsumed: number;
    }>;
  };
}) {
  return (
    <>
      {/* Recipe header row */}
      <tr className="border-b bg-muted/30">
        <td className="py-2 px-3 font-semibold">{recipe.recipeName}</td>
        <td className="py-2 px-3"></td>
        <td className="py-2 px-3"></td>
        <td className="py-2 px-3 text-right tabular-nums font-medium">
          {recipe.servingsSold.toLocaleString("id-ID")}
        </td>
        <td className="py-2 px-3"></td>
      </tr>
      {/* Ingredient rows */}
      {recipe.ingredients.map((ing) => (
        <tr key={ing.ingredientId} className="border-b">
          <td className="py-1.5 pl-6 pr-3 text-muted-foreground">{ing.ingredientName}</td>
          <td className="py-1.5 px-3 text-right tabular-nums">
            {formatQty(ing.quantityPerServing)}
          </td>
          <td className="py-1.5 px-3 text-muted-foreground">{ing.unit}</td>
          <td className="py-1.5 px-3"></td>
          <td className="py-1.5 px-3 text-right tabular-nums">{formatQty(ing.totalConsumed)}</td>
        </tr>
      ))}
    </>
  );
}
