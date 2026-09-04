// ============================================================
// History Pagination — compact prev/next pager for the POS
// history list (shared by the desktop sidebar and mobile tab)
// ============================================================

import { ChevronLeft, ChevronRight } from "lucide-react";

interface HistoryPaginationProps {
  /** Zero-based page index currently shown. */
  page: number;
  /** True when the server may have older rows beyond this page. */
  hasNext: boolean;
  onPageChange: (page: number) => void;
}

export default function HistoryPagination({ page, hasNext, onPageChange }: HistoryPaginationProps) {
  if (page === 0 && !hasNext) return null;

  return (
    <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-4 py-2 shrink-0">
      <span className="text-[10px] font-medium text-muted-foreground">Hal {page + 1}</span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={function () {
            onPageChange(page - 1);
          }}
          disabled={page === 0}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border text-[11px] font-medium disabled:opacity-40 disabled:cursor-not-allowed bg-background"
        >
          <ChevronLeft className="h-3 w-3" />
          Sebelumnya
        </button>
        <button
          onClick={function () {
            onPageChange(page + 1);
          }}
          disabled={!hasNext}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border text-[11px] font-medium disabled:opacity-40 disabled:cursor-not-allowed bg-background"
        >
          Berikutnya
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
