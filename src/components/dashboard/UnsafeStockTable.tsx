import { Link } from "@tanstack/react-router";
import { AlertTriangle, FilePlus2 } from "lucide-react";
import { Badge } from "#/components/ui/badge";

export interface UnsafeStockItem {
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  rop: number;
  stockUnit?: string;
}

interface UnsafeStockTableProps {
  data: UnsafeStockItem[];
  /** Optional link target for "Buat PR". Falls back to the PR index. */
  prBasePath?: string;
}

const PAGE_SIZE = 10;

export function UnsafeStockTable({
  data,
  prBasePath = "/purchase-requisitions",
}: UnsafeStockTableProps) {
  // Always render exactly 10 rows; pad with placeholders if fewer.
  const rows = data.slice(0, PAGE_SIZE);
  const placeholders = Math.max(0, PAGE_SIZE - rows.length);

  const getStatus = (qty: number, rop: number) => {
    if (rop <= 0) return { label: "PERHATIAN", variant: "warning" as const };
    const ratio = qty / rop;
    if (ratio < 0.5) return { label: "KRITIS", variant: "destructive" as const };
    if (ratio < 1) return { label: "PERHATIAN", variant: "warning" as const };
    return { label: "AMAN", variant: "success" as const };
  };

  return (
    <section
      className="rounded-lg border bg-card p-6 shadow-sm"
      aria-labelledby="unsafe-stock-title"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600" />
            <h3 id="unsafe-stock-title" className="text-base font-bold text-foreground">
              Top 10 Bahan Baku Tidak Aman
            </h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Stok berada di bawah Reorder Point. Ambil tindakan sebelum produksi terganggu.
          </p>
        </div>
        <Link
          to={prBasePath}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          <FilePlus2 className="h-4 w-4" />
          Buat PR
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b">
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Bahan Baku
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Stok Saat Ini
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                ROP
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Selisih
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Satuan
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm italic text-muted-foreground">
                  Semua bahan baku berada di atas ROP. Tidak ada yang perlu di-reorder.
                </td>
              </tr>
            ) : (
              <>
                {rows.map((item) => {
                  const gap = item.rop - item.quantity;
                  const status = getStatus(item.quantity, item.rop);
                  return (
                    <tr
                      key={item.ingredientId}
                      className="border-b last:border-0 hover:bg-muted/50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-foreground">
                        {item.ingredientName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm">
                        <span
                          className={
                            status.variant === "destructive"
                              ? "font-bold text-rose-600"
                              : "text-foreground"
                          }
                        >
                          {item.quantity.toLocaleString("id-ID")}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm text-muted-foreground">
                        {item.rop.toLocaleString("id-ID")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm font-semibold text-rose-600">
                        {gap > 0 ? `−${gap.toLocaleString("id-ID")}` : "0"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {item.stockUnit ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
                {/* Pad to 10 rows so the table doesn't visually shrink when there are few unsafe items. */}
                {Array.from({ length: placeholders }).map((_, i) => (
                  <tr key={`pad-${i}`} className="border-b last:border-0">
                    <td colSpan={6} className="px-4 py-3 text-xs italic text-muted-foreground/50">
                      —
                    </td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
