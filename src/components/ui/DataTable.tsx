import { useState } from "react";
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
  header: string;
  width?: string;
  align?: "left" | "right" | "center";
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  pageSize?: number;
  searchable?: boolean;
  searchKeys?: (keyof T)[];
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  rowClassName?: (row: T) => string;
}

export default function DataTable<T>({
  columns,
  data,
  keyExtractor,
  pageSize = 15,
  searchable = true,
  searchKeys,
  emptyMessage = "Tidak ada data",
  onRowClick,
  defaultSort,
  rowClassName,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    defaultSort ?? null,
  );

  const safeStr = (v: unknown) => {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return "";
  };

  // Deduplicate by keyExtractor to prevent duplicate-key React warnings
  const deduped = (() => {
    const seen = new Set<string>();
    return data.filter((row) => {
      const key = keyExtractor(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  const filtered =
    searchable && search.trim()
      ? deduped.filter((row) => {
          const keys = searchKeys ?? Object.keys(row as object);
          return keys.some((k) => {
            const val = (row as Record<string, unknown>)[k as string];
            return safeStr(val).toLowerCase().includes(search.toLowerCase());
          });
        })
      : deduped;

  const sorted = sort
    ? [...filtered].sort((a, b) => {
        const aVal = safeStr((a as Record<string, unknown>)[sort.key]);
        const bVal = safeStr((b as Record<string, unknown>)[sort.key]);
        const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
        return sort.dir === "asc" ? cmp : -cmp;
      })
    : filtered;

  const totalPages = Math.ceil(sorted.length / pageSize) || 1;
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const handleSort = (key: string) => {
    setSort((prev) => {
      if (prev?.key === key) {
        return prev.dir === "asc" ? { key, dir: "desc" } : null;
      }
      return { key, dir: "asc" };
    });
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
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
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
            {paginated.length === 0 ? (
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
                  className={`border-b transition-colors hover:bg-muted/50 ${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(row) ?? ""}`}
                >
                  {columns.map((col, colIdx) => (
                    <td
                      key={col.key}
                      className={
                        "p-3 align-middle whitespace-nowrap min-w-[80px] " +
                        (colIdx === 0 ? stickyClass : "")
                      }
                      style={{ textAlign: col.align ?? "left" }}
                    >
                      {col.render
                        ? col.render(row)
                        : safeStr((row as Record<string, unknown>)[col.key]) || "-"}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            Halaman {currentPage + 1} dari {totalPages}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setPage(0)}
              disabled={currentPage === 0}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={currentPage >= totalPages - 1}
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
