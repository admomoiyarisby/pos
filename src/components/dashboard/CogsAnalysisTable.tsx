import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Pagination } from "#/components/ui/Pagination";

interface Recipe {
  id: string;
  name: string;
  basePrice: number;
  ingredients: { ingredientId: string; quantity: number }[];
}

interface Ingredient {
  id: string;
  averageCost: number;
  conversionFactor: number;
}

interface CogsItem {
  id: string;
  name: string;
  basePrice: number;
  cogs: number;
  margin: number;
  marginPercentage: number;
  cogsPercentage: number;
  alert: boolean;
}

const PAGE_SIZE = 15;

export function computeCogsData(recipes: Recipe[], ingredients: Ingredient[]): CogsItem[] {
  return recipes.map((r) => {
    const cogs = r.ingredients.reduce((acc, ri) => {
      const ing = ingredients.find((i) => i.id === ri.ingredientId);
      if (!ing) return acc;
      const costPerStockUnit = ing.averageCost / ing.conversionFactor;
      return acc + ri.quantity * costPerStockUnit;
    }, 0);

    const margin = r.basePrice - cogs;
    const marginPercentage = r.basePrice > 0 ? (margin / r.basePrice) * 100 : 0;
    const cogsPercentage = r.basePrice > 0 ? (cogs / r.basePrice) * 100 : 0;

    return {
      id: r.id,
      name: r.name,
      basePrice: r.basePrice,
      cogs,
      margin,
      marginPercentage,
      cogsPercentage,
      alert: cogsPercentage > 70,
    };
  });
}

export function CogsAnalysisTable({ data }: { data: CogsItem[] }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = data.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">Analisis COGS (Cost of Goods Sold)</h3>
        <p className="text-sm text-muted-foreground">
          Berdasarkan Weighted Average Cost bahan baku
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left min-w-[640px]">
          <thead>
            <tr className="border-b">
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground sticky left-0 bg-background z-10 border-r border-border">
                Menu Item
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Harga Jual
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                COGS Est.
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Margin
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Food Cost %
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="sticky left-0 bg-background z-10 border-r border-border whitespace-nowrap py-8 text-center italic text-muted-foreground"
                >
                  Tidak ada data.
                </td>
              </tr>
            ) : (
              paginated.map((item) => (
                <tr key={item.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="sticky left-0 bg-background z-10 border-r border-border whitespace-nowrap px-4 py-4 font-medium text-foreground">
                    {item.name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-right text-muted-foreground">
                    Rp {item.basePrice.toLocaleString("id-ID")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 font-mono text-right text-muted-foreground">
                    Rp {Math.round(item.cogs).toLocaleString("id-ID")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-right font-semibold text-emerald-600">
                    Rp {Math.round(item.margin).toLocaleString("id-ID")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${
                            item.cogsPercentage > 70
                              ? "bg-rose-500"
                              : item.cogsPercentage > 50
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                          }`}
                          style={{ width: `${Math.min(item.cogsPercentage, 100)}%` }}
                        />
                      </div>
                      <span
                        className={`text-xs font-bold ${
                          item.cogsPercentage > 70
                            ? "text-rose-600"
                            : item.cogsPercentage > 50
                              ? "text-amber-600"
                              : "text-emerald-600"
                        }`}
                      >
                        {item.cogsPercentage.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    {item.alert ? (
                      <div className="flex items-center text-xs font-bold text-rose-600">
                        <AlertTriangle className="mr-1 h-4 w-4" />
                        BIAYA TINGGI
                      </div>
                    ) : (
                      <div className="flex items-center text-xs font-bold text-emerald-600">
                        <CheckCircle2 className="mr-1 h-4 w-4" />
                        SEHAT
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
