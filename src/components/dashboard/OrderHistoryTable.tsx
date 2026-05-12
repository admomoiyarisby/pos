import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Pagination } from "#/components/ui/Pagination";

interface Order {
  id: string;
  orderCode?: string | null;
  channel: string;
  status: string;
  totalAmount: number;
  branchId: string;
  createdAt: Date;
  items: { recipeId: string; quantity: number }[];
}

interface Recipe {
  id: string;
  name: string;
}

interface Branch {
  id: string;
  name: string;
}

const PAGE_SIZE = 15;

export function OrderHistoryTable({
  orders,
  recipes,
  branches,
  showBranch,
}: {
  orders: Order[];
  recipes: Recipe[];
  branches: Branch[];
  showBranch: boolean;
}) {
  const [page, setPage] = useState(0);
  const sorted = [...orders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const channelColors: Record<string, string> = {
    Gofood: "bg-rose-100 text-rose-600",
    Grabfood: "bg-emerald-100 text-emerald-600",
    ShopeeFood: "bg-orange-100 text-orange-600",
    "Dine-in": "bg-blue-100 text-blue-600",
  };

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">Riwayat Pemesanan</h3>
        <p className="text-sm text-muted-foreground">
          {showBranch ? "Seluruh transaksi dari semua cabang" : "Transaksi di cabang terkait"}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left min-w-[640px]">
          <thead>
            <tr className="border-b">
              <th className="whitespace-nowrap px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground sticky left-0 bg-background z-10 border-r border-border">
                ID Pesanan
              </th>
              <th className="whitespace-nowrap px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Waktu
              </th>
              {showBranch && (
                <th className="whitespace-nowrap px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cabang
                </th>
              )}
              <th className="whitespace-nowrap px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Channel
              </th>
              <th className="whitespace-nowrap px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Menu
              </th>
              <th className="whitespace-nowrap px-4 py-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total
              </th>
              <th className="whitespace-nowrap px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="sticky left-0 bg-background z-10 border-r border-border whitespace-nowrap py-8 text-center italic text-muted-foreground"
                >
                  Tidak ada data.
                </td>
              </tr>
            ) : (
              paginated.map((order) => {
                const branch = branches.find((b) => b.id === order.branchId);
                const badgeVariant =
                  order.status === "Completed"
                    ? "success"
                    : order.status === "Void"
                      ? "destructive"
                      : order.status === "Cancel Requested"
                        ? "warning"
                        : "default";

                return (
                  <tr key={order.id} className="border-b hover:bg-muted/50">
                    <td className="sticky left-0 bg-background z-10 border-r border-border whitespace-nowrap px-4 py-4 font-mono text-xs text-muted-foreground">
                      <div>{order.id.slice(0, 8)}...</div>
                      {order.orderCode && (
                        <div className="mt-1 font-bold text-emerald-600">
                          Code: {order.orderCode}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-muted-foreground">
                      {new Date(order.createdAt).toLocaleDateString("id-ID", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    {showBranch && (
                      <td className="whitespace-nowrap px-4 py-4 font-bold text-foreground">
                        {branch?.name ?? "Unknown"}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          channelColors[order.channel] ?? "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {order.channel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <div className="text-xs text-muted-foreground">
                        {order.items.map((item, idx) => {
                          const recipe = recipes.find((r) => r.id === item.recipeId);
                          return (
                            <div key={idx}>
                              {item.quantity}x {recipe?.name ?? "Unknown"}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-right font-mono font-bold text-foreground">
                      Rp {order.totalAmount.toLocaleString("id-ID")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-center">
                      <Badge
                        variant={badgeVariant as "success" | "destructive" | "warning" | "default"}
                      >
                        {order.status}
                      </Badge>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
