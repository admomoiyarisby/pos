import { ChevronRight } from "lucide-react";
import { formatRp } from "#/lib/utils";
import type { DailyUsageRow } from "#/lib/server/finance";

/**
 * "Rincian Stok Keluar" — total physical ingredient usage (OUT) per bahan for
 * the selected period, aggregated from every ledger OUT source (POS, waste,
 * produksi, penyesuaian). Shared by the /finance Stok Keluar sub-tab and the
 * branch-scoped /stok-keluar page so both stay in sync.
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
            Jumlah fisik bahan keluar per periode (ml/pack) — semua sumber OUT: POS, waste,
            produksi. Bukan nilai HPP; lihat Ledger Harian untuk HPP per bahan.
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
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((r) => (
                <li
                  key={r.ingredientId}
                  className="flex items-baseline justify-between gap-2 border-b border-border/40 py-1 text-sm last:border-0"
                >
                  <span className="truncate">
                    {r.name}
                    <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                      ≈{formatRp(r.estimatedValue)}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {r.quantity.toLocaleString("id-ID")} {r.unit}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Nilai ≈ estimasi dari harga rata-rata bahan saat ini, bukan HPP resmi. Detail per
              gerakan ada di Kartu Stok.
            </p>
          </div>
        ))}
    </div>
  );
}
