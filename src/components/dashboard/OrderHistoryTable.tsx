import { useState } from "react";
import { Search } from "lucide-react";
import { lookupLabel } from "#/lib/label-lookup";
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
  const [search, setSearch] = useState("");

  const filtered = orders.filter((o) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      o.id.toLowerCase().includes(q) ||
      (o.orderCode ?? "").toLowerCase().includes(q) ||
      o.channel.toLowerCase().includes(q) ||
      new Date(o.createdAt).toLocaleDateString("id-ID").includes(q) ||
      o.status.toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-foreground">Riwayat Pemesanan</h3>
          <p className="text-sm text-muted-foreground">
            {showBranch ? "Seluruh transaksi dari semua cabang" : "Transaksi di cabang terkait"}
          </p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Cari ID, channel, tanggal..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="h-9 w-full rounded-lg border border-border bg-transparent pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
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
                  {search.trim()
                    ? "Tidak ada pesanan yang cocok dengan pencarian."
                    : "Belum ada pesanan hari ini. Buka POS untuk memulai."}
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
                      <span className="inline-flex items-center gap-1.5">
                        <ChannelDot channel={order.channel} />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {order.channel}
                        </span>
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
                      <Badge variant={badgeVariant}>{order.status}</Badge>
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

// Small color dot beside the channel name — replaces the banned side-stripe border.
// Keeps the channel distinguishable without decorative color blocks.
function ChannelDot({ channel }: { channel: string }) {
  const colorByChannel = {
    Gofood: "bg-rose-500",
    Grabfood: "bg-emerald-500",
    ShopeeFood: "bg-orange-500",
    "Dine-in": "bg-blue-500",
    TikTok: "bg-gray-500",
    Perlengkapan: "bg-purple-500",
  };
  return (
    <span
      aria-hidden
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${lookupLabel(colorByChannel, channel) ?? "bg-slate-400"}`}
    />
  );
}
