import { DollarSign, TrendingUp, ShoppingCart, XCircle } from "lucide-react";
import { Badge } from "#/components/ui/badge";

interface StatsCardsProps {
  totalSales: number;
  completedCount: number;
  voidCount: number;
}

export function StatsCards({ totalSales, completedCount, voidCount }: StatsCardsProps) {
  return (
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
  );
}
