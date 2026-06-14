/**
 * AuditLogTimeline — shows the state transition history of a procurement.
 * One row per transition or in-state item edit, newest first.
 *
 * Supports pagination via the `onLoadMore` callback. When the parent
 * provides the callback, a "Show older" button appears at the bottom.
 */

export interface AuditLogEntry {
  id: string;
  event: string;
  fromState: string | null;
  toState: string | null;
  itemId: string | null;
  actorRole: string;
  timestamp: Date | string;
  note: string | null;
}

const eventLabels: Record<string, string> = {
  create: "Dibuat",
  submit: "Disubmit",
  "open-review": "Review Dibuka",
  withdraw: "Ditarik Kembali",
  reject: "Ditolak",
  "accept-and-ship": "Disetujui & Dikirim",
  "mark-delivered": "Ditandai Sudah Dikirim",
  "open-receive": "Penerimaan Dibuka",
  "finish-receive": "Penerimaan Selesai",
  "mark-paid": "Pembayaran Diterima",
  cancel: "Dibatalkan",
  "item-update": "Item Diperbarui",
};

export interface AuditLogTimelineProps {
  entries: AuditLogEntry[];
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
}

export function AuditLogTimeline({ entries, hasMore, onLoadMore, isLoadingMore }: AuditLogTimelineProps) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada aktivitas.</p>;
  }

  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {entries.map((e) => {
          const label = eventLabels[e.event] ?? e.event;
          const from = e.fromState ? stateLabel(e.fromState) : null;
          const to = e.toState ? stateLabel(e.toState) : null;
          return (
            <li key={e.id} className="flex items-start gap-3 rounded-md border p-3">
              <div className="flex-1">
                <p className="text-sm font-medium">{label}</p>
                {from || to ? (
                  <p className="text-xs text-muted-foreground">
                    {from ?? "—"} → {to ?? "—"}
                  </p>
                ) : null}
                {e.note ? <p className="mt-1 text-xs text-muted-foreground">{e.note}</p> : null}
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>{new Date(e.timestamp).toLocaleString("id-ID")}</p>
                <p className="capitalize">{e.actorRole.replace("_", " ")}</p>
              </div>
            </li>
          );
        })}
      </ol>
      {hasMore ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            {isLoadingMore ? "Memuat..." : "Tampilkan lebih lama"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function stateLabel(s: string): string {
  return s
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}
