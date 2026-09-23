import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable, { type Column } from "#/components/ui/DataTable";
import { Pagination } from "#/components/ui/Pagination";
import {
  STOCK_LEDGER_PAGE_SIZE,
  stockLedgerInputFromSearch,
  stockLedgerQuery,
  stockLedgerSearchSchema,
} from "#/lib/stock-ledger-query";
import type { UnknownRecord } from "#/lib/unknown-record";
import { isoDateDaysAgo } from "#/components/pos/HistoryDateFilter";
import { getBranches } from "#/lib/server/branches";
import { getRecipes } from "#/lib/server/recipes";
import { useAuth } from "#/lib/auth-context";
import { Badge } from "#/components/ui/badge";
import { ArrowDown, ArrowUp, Factory, ShoppingBag, X } from "lucide-react";

interface LedgerRow {
  id: string;
  createdAt: Date;
  ingredientName: string | null;
  recipeName: string | null;
  type: "IN" | "OUT";
  quantity: number;
  balance: number;
  reference: string;
  notes: string | null;
  branchName: string | null;
  stockUnit: string | null;
  /** Kode Order of the POS transaction behind this movement, if any. */
  orderCode: string | null;
  /** Channel of the POS transaction behind this movement, if any. */
  orderChannel: string | null;
}

export const Route = createFileRoute("/_layout/inventory/ledger")({
  component: LedgerPage,
  // Every search param the query key reads is validated here, so the loader's
  // `loaderDeps` and the component's hooks parse the URL exactly once and can
  // never disagree about which slice was requested.
  validateSearch: (search: UnknownRecord) => stockLedgerSearchSchema.parse(search),
  // The deps are the query key's inputs, and a route match's id includes the
  // deps hash — so any page/filter/sort/search change is a *new* match whose
  // loader re-runs (blocking the navigation) before the page renders.
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const { queryKey, queryFn } = stockLedgerQuery(stockLedgerInputFromSearch(deps));
    // Keyed hydration: only the slice THIS url asks for enters the query
    // cache, so no page can ever render another page's rows.
    // (The old loader fetched page 0 with limit 50 and handed that payload to
    // the page query as `initialData` — which React Query applies to any
    // not-yet-cached key — so "Halaman 5" first painted page 1's rows: the
    // same item appearing on page 5 and page 1.)
    await context.queryClient.ensureQueryData({ queryKey, queryFn });
  },
});

function LedgerPage() {
  const [search, setSearch, committedSearch] = useTableSearch({ debounceMs: 250 });
  const user = useAuth().user;
  const { page, setPage, sort, setSort, filters, setFilter } = useTableUrlState<{
    branchId?: string;
    reference?: string;
    bom?: string;
    bomRecipe?: string;
    dateFrom?: string;
    dateTo?: string;
  }>(["branchId", "reference", "bom", "bomRecipe", "dateFrom", "dateTo"]);

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ data: {} }),
  });

  // Branch Admin is always scoped by the server; hide the global branch picker
  // and avoid presenting a misleading "Semua Cabang" control.
  // Area managers can only filter among their assigned branches (the server
  // enforces the same scope); a stale URL branchId outside that set is ignored.
  const visibleBranches =
    user?.role === "area_manager"
      ? (branches ?? []).filter((b) => user.assignedBranches?.includes(b.id))
      : (branches ?? []);
  const branchId =
    user?.role === "branch_admin"
      ? ""
      : user?.role === "area_manager" &&
          branches &&
          filters.branchId &&
          !visibleBranches.some((b) => b.id === filters.branchId)
        ? ""
        : (filters.branchId ?? "");
  const reference = filters.reference ?? "";
  // Waste BOM filter (ADR 0013): review per-ingredient losses by recipe.
  const bomOnly = filters.bom === "true";
  const bomRecipe = filters.bomRecipe ?? "";
  // Date range (YYYY-MM-DD): shows only movements within the range.
  const dateFrom = filters.dateFrom ?? "";
  const dateTo = filters.dateTo ?? "";
  // Quick presets: chip is active only when the URL range matches it exactly
  // (same semantics as HISTORY_PRESETS in HistoryDateFilter).
  const DATE_PRESETS = [
    { key: "today", label: "Hari ini", from: isoDateDaysAgo(0), to: "" },
    { key: "7d", label: "7 hari", from: isoDateDaysAgo(6), to: "" },
    { key: "30d", label: "30 hari", from: isoDateDaysAgo(29), to: "" },
  ] as const;
  const setDateRange = (from: string, to: string) => {
    setFilter("dateFrom", from);
    setFilter("dateTo", to);
    setPage(0);
  };

  const canFilterBranches =
    user?.role === "super_admin" || user?.role === "area_manager" || user?.role === "admin_pusat";

  const { data: recipes } = useQuery({
    queryKey: ["recipes-filter-active"],
    queryFn: () => getRecipes({ data: { status: "Active" } }),
    enabled: bomOnly,
  });

  const { data: ledger, isPending } = useQuery(
    // Shared with the route loader (`stockLedgerQuery`): identical normalized
    // args → identical cache key, so the loader's pre-fetched slice is a
    // guaranteed hit, and a cache miss can only ever mean "fetch the right
    // rows" — never "show another page's rows".
    // The raw URL branchId is deliberate: the server never trusts it
    // (branch_admin is forced to their branch, area_manager's value is
    // validated against the assigned set), so it behaves exactly like the
    // role-derived `branchId` above while keeping loader and query keys equal.
    stockLedgerQuery({
      page,
      search: committedSearch,
      branchId: filters.branchId ?? "",
      reference,
      bomOnly,
      bomRecipeId: bomRecipe,
      dateFrom,
      dateTo,
      sort,
    }),
  );
  // Server returns { data, total }: total drives the real page count.
  const total = ledger?.total ?? 0;
  const rows = ledger?.data ?? [];
  const totalPages = Math.max(1, Math.ceil(total / STOCK_LEDGER_PAGE_SIZE));
  // Keep the URL page within range (e.g. after a filter shrinks the result set).
  useEffect(() => {
    if (page >= totalPages && page > 0) {
      setPage(totalPages - 1);
    }
  }, [page, totalPages, setPage]);

  // Branch Admin is always scoped to their own branch by the server, so the
  // branch column would be constant noise; everyone else (Area Manager, Admin
  // Pusat, Super Admin, Central Kitchen) can see multiple branches at once.
  const showBranchColumn = user?.role !== "branch_admin";

  // ── Shared cell renderers ──
  // Used by both the desktop DataTable columns and the mobile card list so
  // the two views can never drift (same reference deep-links, same badges).

  const renderName = (row: LedgerRow) => {
    // Show recipe name for recipe-linked entries, ingredient name otherwise
    if (row.recipeName) {
      return (
        <span className="flex items-center gap-1 min-w-0">
          <Factory className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="font-medium truncate min-w-0">{row.recipeName}</span>
        </span>
      );
    }
    // `block` so `truncate` (overflow-hidden + ellipsis) actually applies —
    // on an inline span long names overflow the mobile card header and run
    // under the IN/OUT badge instead of ellipsizing.
    return <span className="block truncate">{row.ingredientName ?? "-"}</span>;
  };

  const renderQty = (row: LedgerRow) => (
    <span className="tabular-nums whitespace-nowrap">
      {row.quantity.toLocaleString("id-ID")}
      {row.stockUnit && <span className="text-muted-foreground ml-0.5">{row.stockUnit}</span>}
    </span>
  );

  const renderBalance = (row: LedgerRow) => (
    <span className="tabular-nums whitespace-nowrap">
      {row.balance.toLocaleString("id-ID")}
      {row.stockUnit && <span className="text-muted-foreground ml-0.5">{row.stockUnit}</span>}
    </span>
  );

  const renderReference = (row: LedgerRow) => {
    const isYield = row.reference.startsWith("YIELD-");
    const display = reference ? row.reference : row.reference.slice(0, 8);
    // POS movements carry the order's Kode Order (ojol) + channel — show
    // both, with a channel badge to distinguish it from plain reference ids.
    if (row.orderChannel) {
      return (
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="font-mono text-xs">{display}</span>
          {row.orderCode ? (
            <span
              className="inline-flex items-center gap-1 w-fit max-w-full font-mono text-[10px] px-1 py-0.5 rounded border border-primary/20 bg-primary/5 text-primary font-medium"
              title={`Kode Order (${row.orderChannel})`}
            >
              <ShoppingBag className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{row.orderCode}</span>
            </span>
          ) : null}
          <span
            className="inline-flex items-center w-fit text-[9px] px-1 py-0.5 rounded bg-muted/70 text-muted-foreground font-medium"
            title={`Channel: ${row.orderChannel}`}
          >
            {row.orderChannel}
          </span>
        </span>
      );
    }
    if (isYield) {
      const yieldId = row.reference.replace("YIELD-", "");
      return (
        <a
          href={`/yield-tracking?highlight=${yieldId}`}
          title="Lihat Produksi di Yield Tracking"
          className="font-mono text-xs text-primary hover:underline underline-offset-2"
        >
          {display}
        </a>
      );
    }
    return <span className="font-mono text-xs">{display}</span>;
  };

  const columns: Column<LedgerRow>[] = [
    {
      accessorKey: "createdAt",
      header: "Waktu",
      width: "w-36",
      enableSorting: true,
      cell: ({ row }) =>
        new Date(row.original.createdAt).toLocaleString("id-ID", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          // Fixed app timezone (mirrors formatJakartaDateTime) so SSR and the
          // client render the identical wall-clock time — without it the server
          // (UTC) and browser (WIB) disagree and hydration fails.
          timeZone: "Asia/Jakarta",
        }),
    },
    {
      accessorKey: "ingredientName",
      header: "Bahan/Resep",
      enableSorting: true,
      cell: ({ row }) => renderName(row.original),
    },
    ...(showBranchColumn
      ? [
          // SAFETY: the object literal has the same accessorKey/header/cell
          // shape as the other LedgerRow columns; the annotation restores the
          // contextual typing that conditional-spread arrays lose.
          {
            accessorKey: "branchName",
            header: "Cabang",
            enableSorting: true,
            cell: ({ row }) => row.original.branchName ?? "-",
          } as Column<LedgerRow>,
        ]
      : []),
    {
      accessorKey: "type",
      header: "Tipe",
      width: "w-16",
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={row.original.type === "IN" ? "success" : "destructive"}>
          {row.original.type}
        </Badge>
      ),
    },
    {
      accessorKey: "quantity",
      header: "Qty",
      align: "right",
      width: "w-20",
      enableSorting: true,
      cell: ({ row }) => renderQty(row.original),
    },
    {
      accessorKey: "balance",
      header: "Saldo",
      align: "right",
      width: "w-20",
      enableSorting: true,
      cell: ({ row }) => renderBalance(row.original),
    },
    {
      accessorKey: "reference",
      header: "Referensi",
      width: "w-36",
      cell: ({ row }) => renderReference(row.original),
    },
    { accessorKey: "notes", header: "Keterangan", cell: ({ row }) => row.original.notes ?? "-" },
  ];
  usePageTitle("Kartu Stok", "Riwayat mutasi masuk dan keluar");

  return (
    <RoleGuard
      allowedRoles={[
        "super_admin",
        "admin_pusat",
        "area_manager",
        "branch_admin",
        "central_kitchen",
      ]}
    >
      {/* Filter bar adapts per device class (matches the Waste page language):
          mobile stacks controls in full-width 44px-tap-target rows — the date
          range stacks as two full-width label+input rows so native date inputs
          never squeeze side-by-side; sm+ is one compact inline row
          (Dari [date] — Sampai [date]). The select row uses `sm:contents` so
          each control joins the desktop flex flow; the date range stays a
          grouped unit (`sm:flex`) so the pair can never split across lines. */}
      <div className="mb-4 space-y-2.5 sm:space-y-0 sm:flex sm:items-center sm:flex-wrap sm:gap-3">
        {/* Row 1 (mobile) — branch + mutation type, side by side */}
        <div className="grid grid-cols-2 gap-2 sm:contents">
          {canFilterBranches && branches && (
            <select
              value={branchId}
              onChange={(e) => {
                setFilter("branchId", e.target.value);
                setPage(0);
              }}
              aria-label="Cabang"
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-[16px] font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-auto sm:rounded-md sm:text-sm sm:font-normal sm:shadow-none"
            >
              <option value="">Semua Cabang</option>
              {visibleBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          {/* Waste BOM filter (ADR 0013): review per-ingredient losses by recipe */}
          <select
            value={bomOnly ? "bom" : ""}
            onChange={(e) => {
              setFilter("bom", e.target.value === "bom" ? "true" : "");
              setFilter("bomRecipe", "");
              setPage(0);
            }}
            aria-label="Jenis mutasi"
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-[16px] font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-auto sm:rounded-md sm:text-sm sm:font-normal sm:shadow-none"
          >
            <option value="">Semua Mutasi</option>
            <option value="bom">Waste BOM</option>
          </select>
          {bomOnly && (
            <select
              value={bomRecipe}
              onChange={(e) => {
                setFilter("bomRecipe", e.target.value);
                setPage(0);
              }}
              aria-label="Resep (Waste BOM)"
              className="col-span-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-[16px] font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:col-span-1 sm:h-8 sm:w-auto sm:max-w-[220px] sm:rounded-md sm:text-sm sm:font-normal sm:shadow-none"
            >
              <option value="">Semua Resep</option>
              {(recipes ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {/* Row 2 (mobile) — date range: filter movements to the given
            (inclusive) dates. */}
        {/* Quick presets ("Semua" = no date filter) — one row edge-to-edge
            scrollable on mobile, inline with the inputs on sm+. Active only on
            an exact range match so hand-picked dates show no active chip. */}
        <div className="flex items-center gap-1.5 -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            onClick={() => setDateRange("", "")}
            aria-pressed={!dateFrom && !dateTo}
            className={`shrink-0 inline-flex items-center h-11 sm:h-7 px-3.5 sm:px-2.5 rounded-full border text-sm sm:text-xs font-medium whitespace-nowrap transition-colors ${
              !dateFrom && !dateTo
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-input hover:bg-muted hover:text-foreground"
            }`}
          >
            Semua
          </button>
          {DATE_PRESETS.map((p) => {
            const active = dateFrom === p.from && (!p.to || dateTo === p.to);
            return (
              <button
                key={p.key}
                onClick={() => setDateRange(p.from, p.to)}
                aria-pressed={active}
                className={`shrink-0 inline-flex items-center h-11 sm:h-7 px-3.5 sm:px-2.5 rounded-full border text-sm sm:text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-input hover:bg-muted hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:w-auto sm:items-center sm:gap-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <label
              htmlFor="ledger-date-from"
              className="w-14 shrink-0 text-sm text-muted-foreground sm:w-auto sm:text-xs"
            >
              Dari
            </label>
            <input
              id="ledger-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateRange(e.target.value, dateTo)}
              aria-label="Tanggal awal"
              max={dateTo || undefined}
              className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-[16px] font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-auto sm:min-w-[150px] sm:flex-none sm:rounded-md sm:px-2 sm:text-sm sm:font-normal sm:shadow-none"
            />
          </div>
          <span className="hidden sm:inline text-muted-foreground text-xs" aria-hidden="true">
            —
          </span>
          <div className="flex items-center gap-2 min-w-0">
            <label
              htmlFor="ledger-date-to"
              className="w-14 shrink-0 text-sm text-muted-foreground sm:w-auto sm:text-xs"
            >
              Sampai
            </label>
            <input
              id="ledger-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateRange(dateFrom, e.target.value)}
              aria-label="Tanggal akhir"
              min={dateFrom || undefined}
              className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-[16px] font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-auto sm:min-w-[150px] sm:flex-none sm:rounded-md sm:px-2 sm:text-sm sm:font-normal sm:shadow-none"
            />
          </div>
        </div>

        {reference && (
          <span className="inline-flex items-center gap-1 h-11 sm:h-auto rounded-xl sm:rounded-md border bg-muted px-3 sm:px-2 text-sm sm:text-xs font-mono w-full sm:w-auto justify-center sm:justify-start">
            <span className="truncate">{reference}</span>
            <button
              onClick={() => {
                setFilter("reference", "");
                setPage(0);
              }}
              className="text-muted-foreground hover:text-foreground shrink-0"
              title="Hapus filter referensi"
            >
              <X className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
            </button>
          </span>
        )}
      </div>

      {/* Desktop/tablet: full ledger table. */}
      <div className="hidden md:block">
        {/* Paging is server-side: data is already the current page's rows, so
            the client-side pagination feature must stay off or it would slice
            the 15 returned rows again (page 2+ would render empty).
            Client-side filtering must also stay off: search is server-side
            (fuzzySearch over ingredient/recipe/reference/notes/order_code), and
            re-filtering the 15 returned rows on column accessor values would
            drop POS rows whose Kode Order lives only in the joined orders row
            (not a column value). That made searching a Kode Order render an
            empty table. */}
        <DataTable
          columns={columns}
          data={rows}
          keyExtractor={(r) => r.id}
          pageSize={STOCK_LEDGER_PAGE_SIZE}
          pagination={false}
          features={{ filtering: false, sorting: true, pagination: false }}
          search={search}
          onSearchChange={setSearch}
          page={page}
          onPageChange={setPage}
          sort={sort}
          onSortChange={setSort}
          loading={isPending}
        />
      </div>

      {/* Mobile sort row (md:hidden): server-side sort via the same URL
          sortKey/sortDir pair the desktop table headers write. Tapping the
          active chip toggles asc/desc; taps reset to page 1. */}
      <div className="md:hidden flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 mb-2">
        <span className="shrink-0 text-xs text-muted-foreground">Urutkan</span>
        {(
          [
            { key: "createdAt", label: "Waktu" },
            { key: "type", label: "IN/OUT" },
          ] as const
        ).map(({ key, label }) => {
          const active = sort?.key === key;
          const dir = active ? (sort?.dir ?? "desc") : "desc";
          return (
            <button
              key={key}
              onClick={() =>
                setSort(active && dir === "desc" ? { key, dir: "asc" } : { key, dir: "desc" })
              }
              aria-pressed={active}
              className={`shrink-0 inline-flex items-center gap-1 h-11 px-3.5 rounded-full border text-sm font-medium whitespace-nowrap transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-input hover:bg-muted hover:text-foreground"
              }`}
            >
              {label}
              {active &&
                (dir === "desc" ? (
                  <ArrowDown className="h-3.5 w-3.5" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5" />
                ))}
            </button>
          );
        })}
      </div>

      {/* Mobile: stacked cards instead of a horizontally scrolling table.
          Same rows, same renderers — only the composition changes. */}
      <ul className="md:hidden space-y-2" aria-label="Riwayat mutasi stok">
        {rows.length === 0 ? (
          <li className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            {isPending ? "Memuat mutasi stok…" : "Tidak ada mutasi stok"}
          </li>
        ) : (
          rows.map((row) => {
            const isPos = !!row.orderChannel;
            return (
              <li key={row.id} className="rounded-xl border bg-card px-3.5 py-3 shadow-xs">
                {/* Header: name + IN/OUT badge, quantity emphasized on the right */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 text-sm font-medium">{renderName(row)}</div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isPos && (
                      <span
                        className="inline-flex items-center gap-1 font-mono text-[10px] px-1 py-0.5 rounded border border-primary/20 bg-primary/5 text-primary font-medium"
                        title={`Kode Order (${row.orderChannel})`}
                      >
                        <ShoppingBag className="h-2.5 w-2.5 shrink-0" />
                        <span className="max-w-[80px] truncate">{row.orderCode}</span>
                      </span>
                    )}
                    <Badge variant={row.type === "IN" ? "success" : "destructive"}>
                      {row.type}
                    </Badge>
                  </div>
                </div>
                {/* Qty + Saldo: signed movement emphasized, running balance muted */}
                <div className="mt-2 flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-1 min-w-0">
                    <span
                      className={`text-lg font-semibold tabular-nums leading-none ${
                        row.type === "IN" ? "text-emerald-600" : "text-destructive"
                      }`}
                    >
                      {row.type === "IN" ? "+" : "−"}
                      {row.quantity.toLocaleString("id-ID")}
                    </span>
                    {row.stockUnit && (
                      <span className="text-xs text-muted-foreground">{row.stockUnit}</span>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0 tabular-nums">
                    Saldo {row.balance.toLocaleString("id-ID")}
                    {row.stockUnit && ` ${row.stockUnit}`}
                  </div>
                </div>
                {/* Meta: time, branch, reference — the audit context */}
                <div className="mt-2 pt-2 border-t flex flex-col gap-1 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-3 min-w-0">
                    <span className="tabular-nums shrink-0">
                      {new Date(row.createdAt).toLocaleString("id-ID", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        // Fixed app timezone — same SSR/client hydration reason
                        // as the desktop Waktu column above.
                        timeZone: "Asia/Jakarta",
                      })}
                    </span>
                    {showBranchColumn && (
                      <span className="truncate" title={row.branchName ?? undefined}>
                        {row.branchName ?? "-"}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate">{renderReference(row)}</div>
                  </div>
                  {row.notes && <div className="truncate">{row.notes}</div>}
                </div>
              </li>
            );
          })
        )}
      </ul>

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </RoleGuard>
  );
}
