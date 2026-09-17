import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ShoppingCart,
  ArrowLeftRight,
  Calculator,
  HandCoins,
} from "lucide-react";
import { getShiftCashTransactions } from "#/lib/server/finance";
import { formatRp } from "#/lib/utils";

// Expandable detail for one shift's cash reconciliation: every cash movement
// in order — the opening float, each Cash sale (in), each mid-shift adjustment
// (±) — then the reconciliation summary the system computed (Perkiraan = what
// should be in the drawer) and what the kasir actually counted at close.
// Direction: in = down-left arrow, out = up-right; kind is carried by the icon
// (cart = sale, arrows = float adjustment), so the two dimensions stay readable
// independently. Shared by the finance page's Selisih Kas table (desktop row +
// mobile card) and the admin shift-sessions history table.
export function ShiftCashDetail({
  shiftId,
  cashFloat,
  expectedCash,
  actualCash,
}: {
  shiftId: string;
  cashFloat: number;
  expectedCash: number;
  actualCash: number;
}) {
  const { data: txs, isLoading } = useQuery({
    queryKey: ["shift-cash-tx", shiftId],
    queryFn: () => getShiftCashTransactions({ data: { shiftId } }),
  });
  const movements = txs ?? [];
  const variance = actualCash - expectedCash;

  return (
    <>
      <div className="text-xs font-medium text-muted-foreground mb-2">Rincian Kas Shift</div>
      <div className="rounded-md border bg-card divide-y">
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground">
            <ArrowDownLeft className="h-3.5 w-3.5 shrink-0" />
            Uang Kas Awal (modal)
          </span>
          <span className="tabular-nums font-medium">{formatRp(cashFloat)}</span>
        </div>
        {isLoading ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">Memuat rincian…</div>
        ) : (
          movements.map((tx, i) => {
            const isIn = tx.direction === "in";
            const meta = [
              new Date(tx.occurredAt).toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
              }),
              tx.label,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div key={i} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-start gap-2">
                  {isIn ? (
                    <ArrowDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  )}
                  <span className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {tx.type === "order" ? (
                        <ShoppingCart className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="truncate">
                        {tx.type === "order" ? "Penjualan tunai" : "Penyesuaian kas"}
                      </span>
                    </span>
                    {meta && (
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {meta}
                      </span>
                    )}
                  </span>
                </span>
                <span
                  className={`shrink-0 tabular-nums font-medium ${
                    isIn ? "text-emerald-600" : "text-amber-600"
                  }`}
                >
                  {isIn ? "+" : "−"}
                  {formatRp(tx.amount)}
                </span>
              </div>
            );
          })
        )}
        {movements.length === 0 && !isLoading && (
          <div className="px-3 py-3 text-sm text-muted-foreground">
            Tidak ada transaksi tunai pada shift ini.
          </div>
        )}
        {/* Reconciliation close-out: what the system expected vs what the
            kasir counted — the two numbers the Selisih compares. */}
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm bg-muted/40 border-t">
          <span className="flex items-center gap-2">
            <Calculator className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            Perkiraan (seharusnya)
          </span>
          <span className="tabular-nums font-semibold">{formatRp(expectedCash)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="flex items-center gap-2">
            <HandCoins className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            Kas Akhir diinput kasir
          </span>
          <span className="tabular-nums font-semibold">{formatRp(actualCash)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="font-medium">Selisih</span>
          <span
            className={`tabular-nums font-semibold ${
              variance === 0
                ? "text-emerald-600"
                : variance > 0
                  ? "text-amber-600"
                  : "text-destructive"
            }`}
          >
            {variance === 0 ? "Cocok" : `${variance > 0 ? "+" : ""}${formatRp(variance)}`}
          </span>
        </div>
      </div>
    </>
  );
}
