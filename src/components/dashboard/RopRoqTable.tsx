import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { RefreshCw } from "lucide-react";
import { Pagination } from "#/components/ui/Pagination";

interface Order {
  id: string;
  branchId: string;
  status: string;
  createdAt: Date;
  items: OrderItem[];
}

interface OrderItem {
  recipeId: string;
  quantity: number;
}

interface Recipe {
  id: string;
  ingredients: { ingredientId: string; quantity: number }[];
}

interface InventoryItem {
  branchId: string;
  ingredientId: string;
  quantity: number;
}

interface Ingredient {
  id: string;
  name: string;
  stockUnit: string;
}

const PAGE_SIZE = 15;

export function computeRopData(
  orders: Order[],
  recipes: Recipe[],
  inventory: InventoryItem[],
  ingredients: Ingredient[],
  branchId: string,
) {
  const last7Days = new Date(Date.now() - 7 * 86400000);
  const branchOrders = orders.filter(
    (o) => o.branchId === branchId && o.createdAt >= last7Days && o.status === "Completed",
  );

  const usageMap: Record<string, number> = {};
  branchOrders.forEach((order) => {
    order.items.forEach((item) => {
      const recipe = recipes.find((r) => r.id === item.recipeId);
      if (recipe) {
        recipe.ingredients.forEach((ri) => {
          usageMap[ri.ingredientId] =
            (usageMap[ri.ingredientId] || 0) + ri.quantity * item.quantity;
        });
      }
    });
  });

  return ingredients
    .map((ing) => {
      const totalUsed = usageMap[ing.id] || 0;
      const avgDailyUsage = totalUsed / 7;
      const rop = avgDailyUsage * 5;
      const invItem = inventory.find((i) => i.branchId === branchId && i.ingredientId === ing.id);
      const currentStock = invItem?.quantity || 0;
      const targetStock = avgDailyUsage * 10;
      const roq = currentStock < rop ? Math.max(0, targetStock - currentStock) : 0;

      return {
        ...ing,
        avgDailyUsage,
        rop,
        currentStock,
        roq,
        isLow: currentStock < rop && rop > 0,
      };
    })
    .filter((item) => item.rop > 0 || item.currentStock < 100);
}

export function RopRoqTable({ data }: { data: ReturnType<typeof computeRopData> }) {
  const [page, setPage] = useState(0);

  if (data.length === 0) return null;

  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = data.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">
          Rekomendasi Pengadaan Stok (ROP/ROQ)
        </h3>
        <p className="text-sm text-muted-foreground">
          Berdasarkan rata-rata pemakaian 7 hari terakhir (ROP = Usage x 5 hari)
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left min-w-[640px]">
          <thead>
            <tr className="border-b">
              <th className="whitespace-nowrap px-4 py-3 text-xs font-bold uppercase text-muted-foreground sticky left-0 bg-background z-10 border-r border-border">
                Bahan Baku
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold uppercase text-muted-foreground">
                Avg. Daily Usage
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold uppercase text-muted-foreground">
                Reorder Point (ROP)
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold uppercase text-muted-foreground">
                Stok Saat Ini
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold uppercase text-muted-foreground">
                Saran Order (ROQ)
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-xs font-bold uppercase text-muted-foreground">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((item) => (
              <tr key={item.id} className="border-b last:border-0 hover:bg-muted/50">
                <td className="sticky left-0 bg-background z-10 border-r border-border whitespace-nowrap px-4 py-3">
                  <div className="text-sm font-bold text-foreground">{item.name}</div>
                  <div className="text-[10px] text-muted-foreground">{item.stockUnit}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm">
                  {item.avgDailyUsage.toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm font-bold text-foreground">
                  {item.rop.toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm">
                  <span
                    className={item.isLow ? "font-bold text-rose-600" : "text-muted-foreground"}
                  >
                    {item.currentStock.toLocaleString("id-ID")}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm font-bold text-emerald-600">
                  {item.roq > 0 ? item.roq.toFixed(2) : "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {item.isLow ? (
                    <Badge variant="destructive">REORDER NOW</Badge>
                  ) : (
                    <Badge variant="success">SAFE</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
      <div className="mt-4 flex items-start rounded-xl bg-muted p-3">
        <RefreshCw className="mr-3 mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong>Algoritma ROP:</strong> Sistem menghitung rata-rata pemakaian harian selama 7 hari
          terakhir, lalu mengalikannya dengan 5 hari sebagai batas aman stok. Jika stok di bawah
          ROP, sistem menyarankan jumlah order (ROQ) untuk mencukupi kebutuhan 10 hari ke depan.
        </p>
      </div>
    </div>
  );
}
