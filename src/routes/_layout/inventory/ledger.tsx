import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import { getStockLedger } from "#/lib/server/inventory";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";

interface LedgerRow {
  id: string;
  createdAt: Date;
  ingredientName: string | null;
  type: "IN" | "OUT";
  quantity: number;
  balance: number;
  reference: string;
  notes: string | null;
  branchName: string | null;
}

export const Route = createFileRoute("/_layout/inventory/ledger")({
  component: LedgerPage,
  loader: async () => {
    const ledger = await getStockLedger({ data: {} });
    return { ledger };
  },
});

function LedgerPage() {
  const { ledger: initial } = Route.useLoaderData();
  const [page, setPage] = useState(0);

  const { data: ledger } = useQuery({
    queryKey: ["stock-ledger", page],
    queryFn: () => getStockLedger({ data: { page, limit: 15 } }),
    initialData: initial,
  });

  const columns: Column<LedgerRow>[] = [
    {
      key: "createdAt",
      header: "Waktu",
      width: "w-36",
      render: (r) =>
        new Date(r.createdAt).toLocaleString("id-ID", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
    },
    { key: "ingredientName", header: "Bahan" },
    {
      key: "type",
      header: "Tipe",
      width: "w-16",
      render: (r) => <Badge variant={r.type === "IN" ? "success" : "destructive"}>{r.type}</Badge>,
    },
    {
      key: "quantity",
      header: "Qty",
      align: "right",
      width: "w-20",
      render: (r) => r.quantity.toLocaleString("id-ID"),
    },
    {
      key: "balance",
      header: "Saldo",
      align: "right",
      width: "w-20",
      render: (r) => r.balance.toLocaleString("id-ID"),
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
      <DataTable columns={columns} data={ledger} keyExtractor={(r) => r.id} pageSize={15} />

      <div className="flex items-center justify-between mt-4">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          className="h-9 px-4 rounded-md border text-sm disabled:opacity-50"
        >
          Sebelumnya
        </button>
        <span className="text-sm text-muted-foreground">Halaman {page + 1}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          className="h-9 px-4 rounded-md border text-sm"
        >
          Berikutnya
        </button>
      </div>
    </RoleGuard>
  );
}
