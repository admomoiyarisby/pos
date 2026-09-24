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
  today: { label: "Hari ini", daysAgo: 0 },
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
      // Fill both ends explicitly (Sampai = today) so the user can see the
      // end date is taken into account — an empty Sampai reads as unbounded
      // and confuses people.
      onChange(isoDateDaysAgo(HISTORY_PRESETS[preset].daysAgo), isoDateDaysAgo(0));
    }
  }

  function isPresetActive(preset: HistoryPresetKey): boolean {
    if (preset === "all") return !dateFrom && !dateTo;
    // Accept the legacy empty-Sampai state as active too, so ranges set
    // before the end date was filled still highlight the right chip.
    const today = isoDateDaysAgo(0);
    return (
      dateFrom === isoDateDaysAgo(HISTORY_PRESETS[preset].daysAgo) &&
      (dateTo === today || dateTo === "")
    );
  }

  const presetButtons: HistoryPresetKey[] = ["today", "7d", "30d", "all"];

  return (
    // Single column everywhere: this filter lives in narrow panels (the
    // 320–380px POS cart sidebar, mobile history tab). Two side-by-side date
    // inputs squeeze each field to ~140px, cropping the date text and pushing
    // the native calendar popup outside the panel where overflow-hidden
    // ancestors clip it. Stacked full-width fields never overflow.
    <div className="flex flex-col gap-2 min-w-0">
      {/* Preset chips — chips left, Reset right, spread across the row */}
      <div className="flex items-center justify-between gap-1 flex-wrap">
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
                  "                min-h-[28px] px-2.5 rounded-full border text-[11px] font-medium transition-colors " +
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
        {(dateFrom || dateTo) && (
          <button
            onClick={function () {
              onChange("", "");
            }}
            aria-label="Hapus filter tanggal"
            title="Hapus filter tanggal"
            className="min-h-[28px] px-2.5 rounded-full border text-[11px] font-medium transition-colors text-muted-foreground hover:bg-accent"
          >
            Reset
          </button>
        )}
      </div>
      {/* From / To — each field is an unbreakable label+input unit that fills
          the full row width. 16px input text prevents iOS Safari focus-zoom;
          stacked rows keep the native calendar popup inside the panel. */}
      <div className="flex items-center gap-1.5 min-w-0">
        <label htmlFor="pos-history-from" className="shrink-0 text-[11px] text-muted-foreground">
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
          className="h-9 min-w-0 w-full flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        />
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        <label htmlFor="pos-history-to" className="shrink-0 text-[11px] text-muted-foreground">
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
          className="h-9 min-w-0 w-full flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        />
      </div>
    </div>
  );
}
