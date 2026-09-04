// ============================================================
// History Date Filter — range picker for the POS history list
// ============================================================

/** Local (not UTC) "YYYY-MM-DD" for a date `days` days before today. */
export function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

export const HISTORY_PRESETS = {
  "7d": { label: "7 hari", daysAgo: 6 },
  "30d": { label: "30 hari", daysAgo: 29 },
} as const;

export type HistoryPresetKey = keyof typeof HISTORY_PRESETS | "all";

interface HistoryDateFilterProps {
  /** "YYYY-MM-DD" (or "" = unbounded) — same values sent to getOrders. */
  dateFrom: string;
  dateTo: string;
  onChange: (dateFrom: string, dateTo: string) => void;
}

export default function HistoryDateFilter({ dateFrom, dateTo, onChange }: HistoryDateFilterProps) {
  function applyPreset(preset: HistoryPresetKey) {
    if (preset === "all") {
      onChange("", "");
    } else {
      onChange(isoDateDaysAgo(HISTORY_PRESETS[preset].daysAgo), "");
    }
  }

  function isPresetActive(preset: HistoryPresetKey): boolean {
    if (preset === "all") return !dateFrom && !dateTo;
    return dateTo === "" && dateFrom === isoDateDaysAgo(HISTORY_PRESETS[preset].daysAgo);
  }

  const presetButtons: HistoryPresetKey[] = ["7d", "30d", "all"];

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 flex-wrap min-w-0">
      {/* Preset chips */}
      <div className="flex items-center gap-1 flex-wrap">
        {presetButtons.map(function (key) {
          const active = isPresetActive(key);
          return (
            <button
              key={key}
              onClick={function () {
                applyPreset(key);
              }}
              className={
                "h-6 px-2.5 rounded-full border text-[10px] font-medium transition-colors " +
                (active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground hover:bg-accent")
              }
            >
              {key === "all" ? "Semua" : HISTORY_PRESETS[key].label}
            </button>
          );
        })}
      </div>
      {/* From / To date inputs */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0 flex-wrap">
        <label htmlFor="pos-history-from" className="shrink-0">
          Dari
        </label>
        <input
          id="pos-history-from"
          type="date"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={function (e) {
            onChange(e.target.value, dateTo);
          }}
          className="h-7 w-[124px] rounded-md border border-input bg-background px-1.5 text-[11px] text-foreground"
        />
        <label htmlFor="pos-history-to" className="shrink-0">
          Sampai
        </label>
        <input
          id="pos-history-to"
          type="date"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={function (e) {
            onChange(dateFrom, e.target.value);
          }}
          className="h-7 w-[124px] rounded-md border border-input bg-background px-1.5 text-[11px] text-foreground"
        />
        {(dateFrom || dateTo) && (
          <button
            onClick={function () {
              onChange("", "");
            }}
            aria-label="Hapus filter tanggal"
            title="Hapus filter tanggal"
            className="ml-auto h-6 px-2 rounded-full border text-[10px] text-muted-foreground hover:bg-accent shrink-0"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
