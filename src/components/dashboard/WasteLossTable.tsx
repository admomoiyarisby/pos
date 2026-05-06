interface WasteEntry {
  id: string;
  ingredientId: string;
  quantity: number;
}

interface Ingredient {
  id: string;
  name: string;
  averageCost: number;
  conversionFactor: number;
}

export function computeWasteLoss(wasteEntries: WasteEntry[], ingredients: Ingredient[]) {
  return wasteEntries
    .map((w) => {
      const ing = ingredients.find((i) => i.id === w.ingredientId);
      const costPerUnit = ing ? ing.averageCost / ing.conversionFactor : 0;
      const lossAmount = w.quantity * costPerUnit;
      return {
        ...w,
        ingredientName: ing?.name ?? w.ingredientId,
        lossAmount,
      };
    })
    .sort((a, b) => b.lossAmount - a.lossAmount)
    .slice(0, 10);
}

export function WasteLossTable({
  data,
}: {
  data: { ingredientName: string; quantity: number; lossAmount: number }[];
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">Waste Loss Report (COGS Loss)</h3>
        <p className="text-sm text-muted-foreground">
          Detail kerugian finansial akibat waste bahan baku
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
                Qty Waste
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold uppercase text-muted-foreground">
                Estimasi Rugi
              </th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="sticky left-0 bg-background z-10 border-r border-border whitespace-nowrap py-8 text-center italic text-muted-foreground"
                >
                  Belum ada data waste.
                </td>
              </tr>
            ) : (
              data.map((item, idx) => (
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
    </div>
  );
}
