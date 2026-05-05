import { Badge } from "#/components/ui/badge";

interface StockOpname {
  id: string;
  branchId: string;
  date: string;
  items: { ingredientId: string; variancePercentage?: number }[];
}

interface Ingredient {
  id: string;
  name: string;
}

interface Branch {
  id: string;
  name: string;
}

export function computeDiscrepancies(
  stockOpnames: StockOpname[],
  ingredients: Ingredient[],
  branches: Branch[],
) {
  const allItems: {
    ingredientName: string;
    branchName: string;
    date: string;
    variancePercentage: number;
  }[] = [];

  stockOpnames.forEach((so) => {
    so.items.forEach((item) => {
      const vp = item.variancePercentage ?? 0;
      if (Math.abs(vp) > 3) {
        allItems.push({
          ingredientName:
            ingredients.find((i) => i.id === item.ingredientId)?.name ?? item.ingredientId,
          branchName: branches.find((b) => b.id === so.branchId)?.name ?? "Unknown",
          date: so.date,
          variancePercentage: vp,
        });
      }
    });
  });

  return allItems
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10);
}

export function DiscrepancyTable({
  data,
}: {
  data: { ingredientName: string; branchName: string; variancePercentage: number }[];
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">Discrepancy Report (&gt; 3%)</h3>
        <p className="text-sm text-muted-foreground">
          Rekapitulasi selisih stok fisik vs sistem yang signifikan
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b">
              <th className="px-4 py-3 text-xs font-bold uppercase text-muted-foreground">
                Bahan Baku
              </th>
              <th className="px-4 py-3 text-xs font-bold uppercase text-muted-foreground">
                Cabang
              </th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase text-muted-foreground">
                Variance %
              </th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 text-center italic text-muted-foreground">
                  Tidak ada selisih stok signifikan.
                </td>
              </tr>
            ) : (
              data.map((item, idx) => (
                <tr key={idx} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3 text-sm font-medium text-foreground">
                    {item.ingredientName}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{item.branchName}</td>
                  <td className="px-4 py-3 text-right">
                    <Badge variant="destructive">{item.variancePercentage.toFixed(1)}%</Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
