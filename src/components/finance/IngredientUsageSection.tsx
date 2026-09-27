import { ChevronRight } from "lucide-react";
import { formatRp } from "#/lib/utils";
import { USAGE_SOURCE_LABELS } from "#/lib/server/usage-source";
import type { DailyUsageRow } from "#/lib/server/finance";

/**
 * "Rincian Stok Keluar" — total physical ingredient usage (OUT) per bahan for
 * the selected period, aggregated from every ledger OUT source (POS, waste,
 * produksi, penyesuaian). Shared by the /finance Stok Keluar sub-tab and the
 * branch-scoped /stok-keluar page so both stay in sync.
 *
 * Each row carries a per-source split, because the total is NOT a sales figure:
 * production, waste and manual adjustments all draw raw ingredients with no sale
 * behind them, so a total above the sales report is expected rather than wrong.
 * Showing the split inline is what makes that checkable instead of arguable.
 */
export function IngredientUsageSection({
  rows,
  isLoading,
  expanded,
  onToggle,
}: {
  rows: DailyUsageRow[] | undefined;
  isLoading: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const list = rows ?? [];
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <span>
          <span className="block text-sm font-semibold">Rincian Stok Keluar</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Jumlah fisik bahan keluar per periode (ml/pack) — semua sumber OUT: POS, Data Penjualan,
            waste, produksi, Stock Opname. Bukan nilai HPP; lihat Ledger Harian untuk HPP per bahan.
          </span>
        </span>
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </button>
      {expanded &&
        (isLoading ? (
          <div className="space-y-2 border-t px-4 py-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
            Tidak ada stok keluar untuk periode ini.
          </div>
        ) : (
          <div className="border-t px-4 py-3">
            <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((r) => (
                <li key={r.ingredientId} className="border-b border-border/40 py-1 last:border-0">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">
                      {r.name}
                      <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                        ≈{formatRp(r.estimatedValue)}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {r.quantity.toLocaleString("id-ID")} {r.unit}
                    </span>
                  </div>
                  {r.sources.length > 1 && (
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {r.sources
                        .map(
                          (s) =>
                            `${USAGE_SOURCE_LABELS[s.source]} ${s.quantity.toLocaleString("id-ID")}`,
                        )
                        .join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Total mencakup semua sumber, bukan hanya penjualan — bahan bisa habis karena produksi,
              waste, atau Stock Opname. Baris dengan lebih dari satu sumber dipecah per sumber.
              Nilai ≈ estimasi dari harga rata-rata bahan saat ini, bukan HPP resmi. Detail per
              gerakan ada di Kartu Stok.
            </p>
          </div>
        ))}
    </div>
  );
}
