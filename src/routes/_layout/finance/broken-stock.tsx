import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { getBrokenStock } from "#/lib/server/waste";
import { Badge } from "#/components/ui/badge";

function formatRupiah(value: number): string {
  return `Rp${value.toLocaleString("id-ID")}`;
}

export const Route = createFileRoute("/_layout/finance/broken-stock")({
  component: BrokenStockPage,
  loader: async () => {
    const entries = await getBrokenStock({ data: {} });
    return { entries };
  },
});

function BrokenStockPage() {
  const { entries: initial } = Route.useLoaderData();

  const { data: entries } = useQuery({
    queryKey: ["broken-stock"],
    queryFn: () => getBrokenStock({ data: {} }),
    initialData: initial,
  });
  usePageTitle("Barang Rusak", "Audit visual waste kategori Biaya Operasional");

  const summaryData = useMemo(() => {
    const map = new Map<
      string,
      {
        total: number;
        valuation: number;
        stockStatus: "Stok Habis" | "Stok Berkurang";
        remainingQty: number;
        expenseAmount: number | null;
        expenseDate: string | null;
      }
    >();
    for (const e of entries) {
      const key = e.ingredientName ?? "Unknown";
      const existing = map.get(key);
      const invQty = e.currentInventoryQty ?? 0;
      const stockStatus = invQty === 0 ? "Stok Habis" : "Stok Berkurang";
      if (existing) {
        existing.total += e.quantity;
        existing.valuation += e.valuation ?? 0;
        if (invQty < existing.remainingQty) {
          existing.remainingQty = invQty;
          existing.stockStatus = invQty === 0 ? "Stok Habis" : "Stok Berkurang";
        }
        if (e.operationalExpenseAmount) {
          existing.expenseAmount = e.operationalExpenseAmount;
          existing.expenseDate = e.operationalExpenseDate;
        }
      } else {
        map.set(key, {
          total: e.quantity,
          valuation: e.valuation ?? 0,
          stockStatus,
          remainingQty: invQty,
          expenseAmount: e.operationalExpenseAmount,
          expenseDate: e.operationalExpenseDate,
        });
      }
    }
    return Array.from(map.entries());
  }, [entries]);

  const totalValuation = useMemo(() => {
    return entries.reduce((sum, e) => sum + (e.valuation ?? 0), 0);
  }, [entries]);

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <div className="mb-4 rounded-md border bg-card p-3">
        <div className="text-xs text-muted-foreground">Total Kerugian Broken Stock</div>
        <div className="text-lg font-semibold">{formatRupiah(totalValuation)}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Broken Stock List */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">
            Daftar Broken Stock
          </h2>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Waktu</th>
                  <th className="px-3 py-2 text-left font-medium">Bahan</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Nilai</th>
                  <th className="px-3 py-2 text-left font-medium">Ket</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b">
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleDateString("id-ID")}
                    </td>
                    <td className="px-3 py-2">{e.ingredientName}</td>
                    <td className="px-3 py-2 text-right font-medium">{e.quantity}</td>
                    <td className="px-3 py-2 text-right text-xs">
                      {formatRupiah(e.valuation ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{e.notes ?? "-"}</td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="h-24 text-center text-muted-foreground">
                      Tidak ada data
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Stock Out Summary */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">
            Ringkasan Barang Keluar
          </h2>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Bahan</th>
                  <th className="px-3 py-2 text-right font-medium">Total Keluar</th>
                  <th className="px-3 py-2 text-right font-medium">Sisa Stok</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Link Biaya</th>
                </tr>
              </thead>
              <tbody>
                {summaryData.map(([name, data]) => (
                  <tr key={name} className="border-b">
                    <td className="px-3 py-2">{name}</td>
                    <td className="px-3 py-2 text-right font-medium">{data.total}</td>
                    <td className="px-3 py-2 text-right">{data.remainingQty}</td>
                    <td className="px-3 py-2">
                      {data.stockStatus === "Stok Habis" ? (
                        <Badge variant="destructive" className="text-[10px]">
                          Stok Habis
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="text-[10px]">
                          Stok Berkurang
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {data.expenseAmount ? (
                        <div className="space-y-0.5">
                          <div>{formatRupiah(data.expenseAmount)}</div>
                          {data.expenseDate && (
                            <div className="text-muted-foreground">{data.expenseDate}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {summaryData.length === 0 && (
                  <tr>
                    <td colSpan={5} className="h-24 text-center text-muted-foreground">
                      Tidak ada data
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </RoleGuard>
  );
}
