import { DollarSign, TrendingUp, ShoppingCart, XCircle, AlertTriangle } from "lucide-react";
import { Badge } from "#/components/ui/badge";

interface StatsCardsProps {
  totalSales: number;
  completedCount: number;
  voidCount: number;
  anomalies: { type: string; message: string; severity: "error" | "warning" }[];
}

export function StatsCards({ totalSales, completedCount, voidCount, anomalies }: StatsCardsProps) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:gap-6 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <DollarSign className="h-6 w-6 text-muted-foreground/60" />
            <TrendingUp className="h-5 w-5 text-muted-foreground/60" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">Penjualan Hari Ini</p>
          <h3 className="text-2xl font-bold text-foreground">
            Rp {totalSales.toLocaleString("id-ID")}
          </h3>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <ShoppingCart className="h-6 w-6 text-muted-foreground/60" />
            {completedCount > 0 && <Badge variant="success">{completedCount} Pesanan</Badge>}
          </div>
          <p className="text-sm font-medium text-muted-foreground">Pesanan Selesai</p>
          <h3 className="text-2xl font-bold text-foreground">{completedCount}</h3>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <XCircle className="h-6 w-6 text-muted-foreground/60" />
            <Badge variant="destructive">{voidCount} Void</Badge>
          </div>
          <p className="text-sm font-medium text-muted-foreground">Pesanan Dibatalkan</p>
          <h3 className="text-2xl font-bold text-foreground">{voidCount}</h3>
        </div>
      </div>

      {anomalies.length > 0 && (
        <div className="mt-6 space-y-4">
          <h3 className="flex items-center text-lg font-bold text-foreground">
            <AlertTriangle className="mr-2 h-5 w-5 text-amber-500" />
            Deteksi Anomali & Alert
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {anomalies.map((a, i) => (
              <div
                key={i}
                className={`flex items-start rounded-xl border p-4 ${
                  a.severity === "error"
                    ? "border-rose-500/30 bg-rose-500/10"
                    : "border-amber-500/30 bg-amber-500/10"
                }`}
              >
                <div
                  className={`mr-4 rounded-lg p-2 ${
                    a.severity === "error"
                      ? "bg-rose-500/20 text-rose-500"
                      : "bg-amber-500/20 text-amber-500"
                  }`}
                >
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-bold text-foreground">{a.type}</p>
                  <p className="text-sm text-muted-foreground">{a.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
