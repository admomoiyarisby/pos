import { createFileRoute } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable, { type Column } from "#/components/ui/DataTable";
import { getStockLedger } from "#/lib/server/inventory";
import { getBranches } from "#/lib/server/branches";
import { getRecipes } from "#/lib/server/recipes";
import { useAuth } from "#/lib/auth-context";
import { Badge } from "#/components/ui/badge";
import { Factory, X } from "lucide-react";

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
}

export const Route = createFileRoute("/_layout/inventory/ledger")({
  component: LedgerPage,
  loader: async () => {
    const ledger = await getStockLedger({ data: {} });
    return { ledger };
  },
});

function LedgerPage() {
  const [search, setSearch, committedSearch] = useTableSearch({ debounceMs: 250 });
  const { ledger: initial } = Route.useLoaderData();
  const user = useAuth().user;
  const { page, setPage, sort, setSort, filters, setFilter } = useTableUrlState<{
    branchId?: string;
    reference?: string;
    bom?: string;
    bomRecipe?: string;
  }>(["branchId", "reference", "bom", "bomRecipe"]);

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

  const canFilterBranches =
    user?.role === "super_admin" || user?.role === "area_manager" || user?.role === "admin_pusat";

  const { data: recipes } = useQuery({
    queryKey: ["recipes-filter-active"],
    queryFn: () => getRecipes({ data: { status: "Active" } }),
    enabled: bomOnly,
  });

  const { data: ledger } = useQuery({
    queryKey: ["stock-ledger", page, branchId, reference, committedSearch, bomOnly, bomRecipe],
    queryFn: () =>
      getStockLedger({
        data: {
          page,
          limit: 15,
          branchId: branchId || undefined,
          reference: reference || undefined,
          search: committedSearch || undefined,
          wasteBomOnly: bomOnly,
          wasteBomRecipeId: bomOnly && bomRecipe ? bomRecipe : undefined,
        },
      }),
    initialData: initial,
  });

  // Branch Admin is always scoped to their own branch by the server, so the
  // branch column would be constant noise; everyone else (Area Manager, Admin
  // Pusat, Super Admin, Central Kitchen) can see multiple branches at once.
  const showBranchColumn = user?.role !== "branch_admin";

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
        }),
    },
    {
      accessorKey: "ingredientName",
      header: "Bahan/Resep",
      enableSorting: true,
      cell: ({ row }) => {
        // Show recipe name for recipe-linked entries, ingredient name otherwise
        if (row.original.recipeName) {
          return (
            <span className="flex items-center gap-1">
              <Factory className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium">{row.original.recipeName}</span>
            </span>
          );
        }
        return row.original.ingredientName ?? "-";
      },
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
      cell: ({ row }) => (
        <span>
          {row.original.quantity.toLocaleString("id-ID")}
          {row.original.stockUnit && (
            <span className="text-muted-foreground ml-0.5">{row.original.stockUnit}</span>
          )}
        </span>
      ),
    },
    {
      accessorKey: "balance",
      header: "Saldo",
      align: "right",
      width: "w-20",
      enableSorting: true,
      cell: ({ row }) => (
        <span>
          {row.original.balance.toLocaleString("id-ID")}
          {row.original.stockUnit && (
            <span className="text-muted-foreground ml-0.5">{row.original.stockUnit}</span>
          )}
        </span>
      ),
    },
    {
      accessorKey: "reference",
      header: "Referensi",
      width: "w-36",
      cell: ({ row }) => {
        const isYield = row.original.reference.startsWith("YIELD-");
        const display = reference ? row.original.reference : row.original.reference.slice(0, 8);
        if (isYield) {
          const yieldId = row.original.reference.replace("YIELD-", "");
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
      },
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
      <div className="flex items-center gap-3 mb-4">
        {canFilterBranches && branches && (
          <select
            value={branchId}
            onChange={(e) => {
              setFilter("branchId", e.target.value);
              setPage(0);
            }}
            className="h-8 rounded-md border border-input bg-background px-3 text-sm"
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
          className="h-8 rounded-md border border-input bg-background px-3 text-sm"
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
            className="h-8 max-w-[220px] rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Semua Resep</option>
            {(recipes ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        {reference && (
          <span className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs font-mono">
            {reference}
            <button
              onClick={() => {
                setFilter("reference", "");
                setPage(0);
              }}
              className="text-muted-foreground hover:text-foreground"
              title="Hapus filter referensi"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>

      <DataTable
        columns={columns}
        data={ledger}
        keyExtractor={(r) => r.id}
        pageSize={15}
        pagination={false}
        search={search}
        onSearchChange={setSearch}
        page={page}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
      />

      <div className="flex items-center justify-between mt-4">
        <button
          onClick={() => setPage(Math.max(0, page - 1))}
          disabled={page === 0}
          className="h-9 px-4 rounded-md border text-sm disabled:opacity-50"
        >
          Sebelumnya
        </button>
        <span className="text-sm text-muted-foreground">Halaman {page + 1}</span>
        <button onClick={() => setPage(page + 1)} className="h-9 px-4 rounded-md border text-sm">
          Berikutnya
        </button>
      </div>
    </RoleGuard>
  );
}
