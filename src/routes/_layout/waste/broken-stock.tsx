import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { getBrokenStock } from "#/lib/server/waste";
import { Badge } from "#/components/ui/badge";

export const Route = createFileRoute("/_layout/waste/broken-stock")({
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

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager"]}>
      <PageHeader
        title="Broken Stock"
        description="Audit visual waste kategori Biaya Operasional"
      />

      <div className="grid grid-cols-2 gap-6">
        {/* Left: Broken Stock List */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">
            Daftar Broken Stock
          </h2>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Waktu</th>
                  <th className="px-3 py-2 text-left font-medium">Bahan</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
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
                    <td className="px-3 py-2 text-xs text-muted-foreground">{e.notes ?? "-"}</td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="h-24 text-center text-muted-foreground">
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
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Bahan</th>
                  <th className="px-3 py-2 text-right font-medium">Total Keluar</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(
                  entries.reduce<Record<string, number>>((acc, e) => {
                    const key = e.ingredientName ?? "Unknown";
                    acc[key] = (acc[key] ?? 0) + e.quantity;
                    return acc;
                  }, {}),
                ).map(([name, total]) => (
                  <tr key={name} className="border-b">
                    <td className="px-3 py-2">{name}</td>
                    <td className="px-3 py-2 text-right font-medium">{total}</td>
                    <td className="px-3 py-2">
                      <Badge variant="destructive" className="text-[10px]">
                        Stok Berkurang
                      </Badge>
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={3} className="h-24 text-center text-muted-foreground">
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
