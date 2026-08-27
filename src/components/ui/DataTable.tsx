import { useMemo, useState } from "react";
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
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { ColumnDef, FilterFn, RowData, SortingFn, TableOptions } from "@tanstack/react-table";
import { compareItems, rankItem } from "@tanstack/match-sorter-utils";
import type { RankingInfo } from "@tanstack/match-sorter-utils";

declare module "@tanstack/react-table" {
  interface FilterFns {
    fuzzy: FilterFn<unknown>;
  }
  interface FilterMeta {
    itemRank: RankingInfo;
  }
}

const fuzzyFilter: FilterFn<unknown> = (row, columnId, value, addMeta) => {
  // SAFETY: global/column filter value is a string search term; rankItem handles non-string via String(value) internally.
  const itemRank = rankItem(row.getValue(columnId), value as string);
  addMeta({ itemRank });
  return itemRank.passed;
};

const fuzzySort: SortingFn<unknown> = (rowA, rowB, columnId) => {
  let dir = 0;
  if (rowA.columnFiltersMeta[columnId]) {
    dir = compareItems(
      // SAFETY: fuzzyFilter stores itemRank via addMeta; when present it contains RankingInfo.
      rowA.columnFiltersMeta[columnId]!.itemRank,
      // SAFETY: same invariant as above for rowB.
      rowB.columnFiltersMeta[columnId]!.itemRank,
    );
  }
  return dir === 0 ? sortFns.alphanumeric(rowA, rowB, columnId) : dir;
};

// SAFETY: feature prerequisites are satisfied — columnFilteringFeature before filteredRowModel/filterFns/globalFilteringFeature,
// rowSortingFeature before sortedRowModel/sortFns, rowPaginationFeature before paginatedRowModel.
const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: {
    fuzzy: fuzzyFilter,
  },
  sortFns: {
    fuzzy: fuzzySort,
  },
});

export type Column<T extends RowData> = ColumnDef<unknown, T, unknown> & {
  key: string;
  header: React.ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
  cellClassName?: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
};

export type DataTableColumn<T extends RowData> = Column<T>;

export interface DataTableFeatureOptions {
  filtering?: boolean;
  sorting?: boolean;
  pagination?: boolean;
}

interface DataTableProps<T extends RowData> {
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
  search?: string;
  onSearchChange?: (value: string) => void;
  page?: number;
  onPageChange?: (page: number) => void;
  tableOptions?: Omit<Partial<TableOptions<unknown, T>>, "data" | "columns" | "state">;
  features?: DataTableFeatureOptions;
}

export default function DataTable<T extends RowData>({
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
  page: externalPage,
  onPageChange,
  rowClassName,
  loading = false,
  loadingRows = 5,
  tableOptions,
  features = { filtering: true, sorting: true, pagination: true },
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [internalPage, setInternalPage] = useState(0);
  const [internalSort, setInternalSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    defaultSort ?? null,
  );
  const page = externalPage ?? internalPage;
  const sort = externalSort !== undefined ? externalSort : internalSort;
  const searchValue = externalSearch ?? search;
  const changePage = (next: number) =>
    onPageChange ? onPageChange(Math.max(0, next)) : setInternalPage(Math.max(0, next));

  type SortableCellValue = Date | string | number | boolean | null | undefined;
  const safeStr = (value: SortableCellValue) =>
    value == null ? "" : value instanceof Date ? value.toISOString() : String(value);

  const deduped = useMemo(() => {
    const seen = new Set<string>();
    return data.filter((row) => {
      const key = keyExtractor(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data, keyExtractor]);

  const sorting = useMemo(
    () => (sort ? [{ id: sort.key, desc: sort.dir === "desc" }] : []),
    [sort],
  );
  const paginationState = useMemo(() => ({ pageIndex: page, pageSize }), [page, pageSize]);

  const tableColumns = useMemo(
    () =>
      columns.map((column) => {
        // SAFETY: columns may define `key` (legacy), `accessorKey`, or `id`; resolve to a single data key for filtering/rendering.
        const dataKey =
          (column as { accessorKey?: string }).accessorKey ??
          column.key ??
          (column as { id?: string }).id ??
          "";
        // SAFETY: searchKeys are keys of T; string comparison is safe for dataKey membership test.
        const enableGlobalFilter = searchable
          ? searchKeys
            ? (searchKeys as string[]).includes(dataKey)
            : true
          : false;
        return {
          ...column,
          // SAFETY: ensure both `key` and `accessorKey` are populated so TanStack and the fallback renderer agree.
          key: dataKey,
          // SAFETY: same dataKey invariant — preserve existing accessorKey if present.
          accessorKey: (column as { accessorKey?: string }).accessorKey ?? dataKey,
          header: column.header,
          enableSorting: column.enableSorting ?? column.sortable ?? false,
          enableGlobalFilter,
          // SAFETY: fuzzy filter is registered in filterFns; per-column filterFn uses the same ranking logic.
          filterFn: "fuzzy" as const,
          // SAFETY: fuzzy sort falls back to alphanumeric when no rank meta is present.
          sortingFn: fuzzySort as SortingFn<unknown>,
          cell:
            column.cell ??
            (({ row }: { row: { original: T } }) => {
              // SAFETY: app columns use string keys for primitive display values; dataKey covers `key`/`accessorKey`/`id`.
              const value =
                column.render?.(row.original) ??
                (safeStr((row.original as Record<string, SortableCellValue>)[dataKey]) || "-");
              return value;
            }),
        };
      }),
    [columns, searchable, searchKeys],
  );

  // SAFETY: TableOptions shape is satisfied by registered features + state.
  const table = useTable({
    ...tableOptions,
    features: dataTableFeatures,
    data: deduped,
    // SAFETY: tableColumns are built from validated Column<T> definitions and satisfy ColumnDef.
    columns: tableColumns as ColumnDef<unknown, T, unknown>[],
    state: {
      globalFilter: searchable && features.filtering ? searchValue : "",
      sorting: features.sorting ? sorting : [],
      pagination: features.pagination ? paginationState : { pageIndex: 0, pageSize },
      ...tableOptions?.state,
    },
    globalFilterFn: searchable && features.filtering ? "fuzzy" : undefined,
  } as TableOptions<unknown, T>);

  const headerGroups = table.getHeaderGroups();
  const leafHeaderCount = headerGroups[0]?.headers.length ?? columns.length;
  const rows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();
  const canPrevious = table.getCanPreviousPage();
  const canNext = table.getCanNextPage();
  const currentPageIndex = table.state.pagination.pageIndex ?? page;

  const isUrlControlled = externalSort !== undefined && externalPage !== undefined;
  const handleSort = (key: string) => {
    const next =
      sort?.key === key
        ? sort.dir === "asc"
          ? { key, dir: "desc" as const }
          : null
        : { key, dir: "asc" as const };
    if (onSortChange) {
      onSortChange(next);
      if (!isUrlControlled) changePage(0);
    } else {
      setInternalSort(next);
      changePage(0);
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
                if (onSearchChange) onSearchChange(next);
                else setSearch(next);
                if (!onPageChange) changePage(0);
              }}
              aria-label="Cari data"
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <span className="text-xs text-muted-foreground">{filteredCount} item</span>
        </div>
      )}
      <div className="rounded-md border overflow-x-auto relative">
        <table className="w-full caption-bottom text-sm min-w-[640px]">
          <thead className="[&_tr]:border-b">
            {headerGroups.map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
              >
                {headerGroup.headers.map((header, colIdx) => {
                  // SAFETY: tableColumns are created directly from the legacy Column<T> definitions above.
                  const col = header.column.columnDef as Column<T>;
                  const colKey = col.key ?? header.column.id;
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      className={
                        "h-10 px-3 text-left align-middle font-medium whitespace-nowrap min-w-[80px] " +
                        (col.width ?? "") +
                        (col.sortable ? "cursor-pointer select-none " : "") +
                        (colIdx === 0 ? stickyClass : "") +
                        " " +
                        (col.cellClassName ?? "") +
                        " " +
                        (col.sortable && sort?.key === colKey
                          ? "text-foreground"
                          : "text-muted-foreground")
                      }
                      style={{ textAlign: col.align ?? "left" }}
                      onClick={() => col.sortable && handleSort(colKey)}
                    >
                      {header.isPlaceholder ? null : (
                        <div className="flex items-center gap-1.5">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {col.sortable &&
                            (sort?.key === colKey ? (
                              sort.dir === "asc" ? (
                                <ArrowUp className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
                            ))}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {loading ? (
              Array.from({ length: loadingRows }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-b">
                  {Array.from({ length: leafHeaderCount }).map((_, colIdx) => (
                    <td
                      key={`skeleton-${i}-${colIdx}`}
                      className={"p-3 align-middle " + (colIdx === 0 ? stickyClass : "")}
                    >
                      <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={leafHeaderCount} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => {
                    // SAFETY: deduped rows are keyed by keyExtractor; row.original is the source T.
                    const original = row.original as T;
                    onRowClick?.(original);
                  }}
                  // SAFETY: row.original is the source T for rowClassName.
                  className={`border-b transition-colors hover:bg-muted/50 ${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(row.original as T) ?? ""} max-md:min-h-[44px]`}
                >
                  {row.getVisibleCells().map((cell, colIdx) => (
                    <td
                      key={cell.id}
                      // SAFETY: tableColumns preserve Column<T> metadata in columnDef.
                      className={
                        "p-3 align-middle whitespace-nowrap min-w-[80px] max-w-[300px] " +
                        (colIdx === 0 ? stickyClass : "") +
                        ((cell.column.columnDef as Column<T>).cellClassName ?? "")
                      }
                      // SAFETY: same Column<T> metadata invariant.
                      style={{ textAlign: (cell.column.columnDef as Column<T>).align ?? "left" }}
                    >
                      <div className="truncate min-w-0">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination && pageCount > 1 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            Halaman {currentPageIndex + 1} dari {pageCount}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => changePage(0)}
              disabled={!canPrevious}
              aria-label="Halaman pertama"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-sm font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => changePage(currentPageIndex - 1)}
              disabled={!canPrevious}
              aria-label="Halaman sebelumnya"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-sm font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => changePage(currentPageIndex + 1)}
              disabled={!canNext}
              aria-label="Halaman selanjutnya"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-sm font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => changePage(pageCount - 1)}
              disabled={!canNext}
              aria-label="Halaman terakhir"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-sm font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
