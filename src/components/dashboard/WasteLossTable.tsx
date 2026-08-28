import { useState } from "react";
import { Pagination } from "#/components/ui/Pagination";

interface WasteEntry {
  id: string;
  ingredientId: string | null;
  quantity: number;
}

interface Ingredient {
  id: string;
  name: string;
  averageCost: number;
}

const PAGE_SIZE = 15;

export function computeWasteLoss(wasteEntries: WasteEntry[], ingredients: Ingredient[]) {
  return wasteEntries
    .map((w) => {
      const ing = ingredients.find((i) => i.id === w.ingredientId);
      const costPerUnit = ing ? ing.averageCost : 0;
      const lossAmount = w.quantity * costPerUnit;
      return {
        ...w,
        ingredientName: ing?.name ?? w.ingredientId ?? "Bahan tidak ditemukan",
        lossAmount,
      };
    })
    .sort((a, b) => b.lossAmount - a.lossAmount);
}

export function WasteLossTable({
  data,
}: {
  data: { ingredientName: string; quantity: number; lossAmount: number }[];
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = data.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">Laporan Kerugian Waste (COGS)</h3>
        <p className="text-sm text-muted-foreground">
          Detail kerugian finansial akibat waste bahan baku
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left min-w-[800px]">
          <thead>
            <tr className="border-b">
              <th className="whitespace-nowrap px-4 py-3 text-xs font-bold uppercase text-muted-foreground sticky left-0 bg-background z-10 border-r border-border">
                Bahan Baku
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold uppercase text-muted-foreground">
                Jumlah Waste
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold uppercase text-muted-foreground">
                Estimasi Rugi
              </th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="sticky left-0 bg-background z-10 border-r border-border whitespace-nowrap py-8 text-center italic text-muted-foreground"
                >
                  Belum ada pencatatan waste. Catat waste bahan baku untuk melihat laporan kerugian.
                </td>
              </tr>
            ) : (
              paginated.map((item, idx) => (
                <tr key={idx} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="sticky left-0 bg-background z-10 border-r border-border whitespace-nowrap px-4 py-3 text-sm font-medium text-foreground">
                    {item.ingredientName}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-muted-foreground">
                    {item.quantity}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-right font-bold text-rose-600">
                    Rp {Math.round(item.lossAmount).toLocaleString("id-ID")}
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
