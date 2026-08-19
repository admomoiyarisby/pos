import { useMemo, useState } from "react";
import Fuse from "fuse.js";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
  /** Extra classes for the cell (<th>/<td>); use `!` important utilities to override defaults. */
  cellClassName?: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  pageSize?: number;
  pagination?: boolean;
  searchable?: boolean;
  searchKeys?: (keyof T)[];
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  sort?: { key: string; dir: "asc" | "desc" } | null;
  onSortChange?: (sort: { key: string; dir: "asc" | "desc" } | null) => void;
  rowClassName?: (row: T) => string;
  loading?: boolean;
  loadingRows?: number;
  /** External search value (controlled mode). When provided, the component will not manage its own search state. */
  search?: string;
  /** Called when the search input changes (controlled mode). */
  onSearchChange?: (value: string) => void;
}

export default function DataTable<T>({
  columns,
  data,
  keyExtractor,
  pageSize = 15,
  pagination = true,
  searchable = true,
  searchKeys,
  emptyMessage = "Tidak ada data",
  onRowClick,
  defaultSort,
  sort: externalSort,
  onSortChange,
  search: externalSearch,
  onSearchChange,
  rowClassName,
  loading = false,
  loadingRows = 5,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [internalSort, setInternalSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    defaultSort ?? null,
  );

  // Use external sort if provided, otherwise use internal sort
  const sort = externalSort !== undefined ? externalSort : internalSort;

  // Use external search if provided, otherwise use internal search
  const searchValue = externalSearch !== undefined ? externalSearch : search;

  // Sortable cells are display values: dates, primitives, or nothing. Anything
  // else (e.g. an object cell) sorts as "" for stability.
  type SortableCellValue = Date | string | number | boolean | null | undefined;
  const safeStr = (v: SortableCellValue): string => {
    if (v === null || v === undefined) return "";
    return v instanceof Date ? v.toISOString() : String(v);
  };

  // Deduplicate by keyExtractor to prevent duplicate-key React warnings
  const deduped = useMemo(() => {
    const seen = new Set<string>();
    return data.filter((row) => {
      const key = keyExtractor(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data, keyExtractor]);

  // Fuzzy (Fuse.js) search — ADR 0008: threshold 0.3, ignoreLocation (match
  // anywhere, like ILIKE), re-ranked by score. When a column sort is active the
  // downstream `sorted` overrides this order; otherwise results stay score-ranked.
  const searchKeysKey = searchKeys ? searchKeys.join(",") : "*";
  const fuse = useMemo(() => {
    const keys = searchKeys
      ? searchKeys.map((k) => String(k))
      : deduped[0]
        ? Object.keys(deduped[0] ?? {})
        : [];
    return new Fuse(deduped, {
      keys,
      threshold: 0.3,
      ignoreLocation: true,
      includeScore: true,
      minMatchCharLength: 1,
    });
  }, [deduped, searchKeysKey]);

  const filtered = useMemo(() => {
    if (!(searchable && searchValue.trim())) return deduped;
    return fuse.search(searchValue.trim()).map((r) => r.item);
  }, [searchable, searchValue, deduped, fuse]);

  const sorted = sort
    ? [...filtered].sort((a, b) => {
        // SAFETY: sorting only runs on columns declared `sortable`, whose cells
        // are display values (Date | string | number | boolean | null | undefined).
        // The Record index read is a widened view over the row object.
        const aVal = safeStr((a as Record<string, SortableCellValue>)[sort.key]);
        // SAFETY: same invariant as above — the sort key is a declared column.
        const bVal = safeStr((b as Record<string, SortableCellValue>)[sort.key]);
        const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
        return sort.dir === "asc" ? cmp : -cmp;
      })
    : filtered;

  const totalPages = Math.ceil(sorted.length / pageSize) || 1;
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const handleSort = (key: string) => {
    const newSort = (() => {
      if (sort?.key === key) {
        return sort.dir === "asc" ? { key, dir: "desc" as const } : null;
      }
      return { key, dir: "asc" as const };
    })();

    if (onSortChange) {
      onSortChange(newSort);
    } else {
      setInternalSort(newSort);
    }
  };

  const stickyClass = "sticky left-0 bg-background z-10 border-r border-border";

  return (
    <div className="space-y-3">
      {searchable && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Cari..."
              value={searchValue}
              onChange={(e) => {
                const next = e.target.value;
                if (onSearchChange) {
                  onSearchChange(next);
                } else {
                  setSearch(next);
                }
                setPage(0);
              }}
              aria-label="Cari data"
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <span className="text-xs text-muted-foreground">{filtered.length} item</span>
        </div>
      )}

      <div className="rounded-md border overflow-x-auto relative">
        <table className="w-full caption-bottom text-sm min-w-[640px]">
          <thead className="[&_tr]:border-b">
            <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
              {columns.map((col, colIdx) => (
                <th
                  key={col.key}
                  className={
                    "h-10 px-3 text-left align-middle font-medium whitespace-nowrap min-w-[80px] " +
                    (col.width ?? "") +
                    " " +
                    (col.sortable ? "cursor-pointer select-none " : " ") +
                    (colIdx === 0 ? stickyClass : "") +
                    " " +
                    (col.cellClassName ?? "") +
                    " " +
                    (col.sortable && sort?.key === col.key
                      ? "text-foreground"
                      : "text-muted-foreground")
                  }
                  style={{ textAlign: col.align ?? "left" }}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <div className="flex items-center gap-1.5">
                    {col.header}
                    {col.sortable &&
                      (sort?.key === col.key ? (
                        sort.dir === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
                      ))}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {loading ? (
              Array.from({ length: loadingRows ?? 5 }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-b">
                  {columns.map((col, colIdx) => (
                    <td
                      key={col.key}
                      className={"p-3 align-middle " + (colIdx === 0 ? stickyClass : "")}
                    >
                      <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : paginated.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginated.map((row) => (
                <tr
                  key={keyExtractor(row)}
                  onClick={() => onRowClick?.(row)}
                  className={`border-b transition-colors hover:bg-muted/50 ${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(row) ?? ""} max-md:min-h-[44px]`}
                >
                  {columns.map((col, colIdx) => (
                    <td
                      key={col.key}
                      className={
                        "p-3 align-middle whitespace-nowrap min-w-[80px] max-w-[300px] " +
                        (colIdx === 0 ? stickyClass : "") +
                        (col.cellClassName ?? "")
                      }
                      style={{ textAlign: col.align ?? "left" }}
                    >
                      <div className="truncate min-w-0">
                        {col.render
                          ? col.render(row)
                          : // SAFETY: non-rendered cells are display values
                            // (Date | string | number | boolean | null | undefined).
                            safeStr((row as Record<string, SortableCellValue>)[col.key]) || "-"}
                      </div>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && totalPages > 1 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            Halaman {currentPage + 1} dari {totalPages}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setPage(0)}
              disabled={currentPage === 0}
              aria-label="Halaman pertama"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              aria-label="Halaman sebelumnya"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              aria-label="Halaman selanjutnya"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={currentPage >= totalPages - 1}
              aria-label="Halaman terakhir"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
