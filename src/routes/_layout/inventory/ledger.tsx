import { createFileRoute } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import { getStockLedger } from "#/lib/server/inventory";
import { getBranches } from "#/lib/server/branches";
import { useAuth } from "#/lib/auth-context";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Factory } from "lucide-react";

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
  const [search, setSearch] = useTableSearch();
  const { ledger: initial } = Route.useLoaderData();
  const user = useAuth().user;
  const { page, setPage, sort, setSort, filters, setFilter } = useTableUrlState<{
    branchId?: string;
  }>(["branchId"]);
  const branchId = filters.branchId ?? "";

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ data: {} }),
  });

  const canFilterBranches =
    user?.role === "super_admin" || user?.role === "area_manager" || user?.role === "admin_pusat";

  const { data: ledger } = useQuery({
    queryKey: ["stock-ledger", page, branchId],
    queryFn: () => getStockLedger({ data: { page, limit: 15, branchId: branchId || undefined } }),
    initialData: initial,
  });

  const columns: Column<LedgerRow>[] = [
    {
      key: "createdAt",
      header: "Waktu",
      width: "w-36",
      sortable: true,
      render: (r) =>
        new Date(r.createdAt).toLocaleString("id-ID", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
    },
    {
      key: "ingredientName",
      header: "Bahan/Resep",
      sortable: true,
      render: (r) => {
        // Show recipe name for recipe-linked entries, ingredient name otherwise
        if (r.recipeName) {
          return (
            <span className="flex items-center gap-1">
              <Factory className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium">{r.recipeName}</span>
            </span>
          );
        }
        return r.ingredientName ?? "-";
      },
    },
    {
      key: "type",
      header: "Tipe",
      width: "w-16",
      sortable: true,
      render: (r) => <Badge variant={r.type === "IN" ? "success" : "destructive"}>{r.type}</Badge>,
    },
    {
      key: "quantity",
      header: "Qty",
      align: "right",
      width: "w-20",
      sortable: true,
      render: (r) => (
        <span>
          {r.quantity.toLocaleString("id-ID")}
          {r.stockUnit && <span className="text-muted-foreground ml-0.5">{r.stockUnit}</span>}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Saldo",
      align: "right",
      width: "w-20",
      sortable: true,
      render: (r) => (
        <span>
          {r.balance.toLocaleString("id-ID")}
          {r.stockUnit && <span className="text-muted-foreground ml-0.5">{r.stockUnit}</span>}
        </span>
      ),
    },
    {
      key: "reference",
      header: "Referensi",
      width: "w-28",
      render: (r) => <span className="font-mono text-xs">{r.reference.slice(0, 8)}</span>,
    },
    { key: "notes", header: "Keterangan", render: (r) => r.notes ?? "-" },
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
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
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
