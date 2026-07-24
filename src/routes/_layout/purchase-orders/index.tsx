import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import { getPurchaseOrders } from "#/lib/server/scm";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { ArrowRight } from "lucide-react";

interface PORow {
  id: string;
  code: string;
  fromBranchId: string;
  toBranchId: string;
  status: string;
  createdAt: Date;
}

const statusColors: Record<
  string,
  "default" | "secondary" | "warning" | "success" | "destructive"
> = {
  Draft: "secondary",
  Sent: "warning",
  Partial: "default",
  Completed: "success",
  Cancelled: "destructive",
};

export const Route = createFileRoute("/_layout/purchase-orders/")({
  component: POPage,
  loader: async () => {
    const pos = await getPurchaseOrders({ data: {} });
    return { pos };
  },
});

function POPage() {
  const [search, setSearch] = useTableSearch();
  const { pos: initial } = Route.useLoaderData();

  const { data: pos } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => getPurchaseOrders({ data: {} }),
    initialData: initial,
  });

  const columns: Column<PORow>[] = [
    { key: "code", header: "Kode PO", width: "w-28", sortable: true },
    {
      key: "fromBranchId",
      header: "Dari",
      sortable: true,
      render: (r) => r.fromBranchId.slice(0, 8),
    },
    { key: "toBranchId", header: "Ke", sortable: true, render: (r) => r.toBranchId.slice(0, 8) },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (r) => (
        <Badge
          variant={
            (statusColors[r.status] ?? "default") as
              | "default"
              | "success"
              | "warning"
              | "destructive"
          }
        >
          {r.status}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Dibuat",
      sortable: true,
      render: (r) => new Date(r.createdAt).toLocaleDateString("id-ID"),
    },
    {
      key: "id",
      header: "",
      width: "w-12",
      render: (r) => (
        <Link
          to="/purchase-orders/$poId"
          params={{ poId: r.id }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
        >
          <ArrowRight className="h-4 w-4" />
        </Link>
      ),
    },
  ];

  usePageTitle("Pemesanan Pembelian", "Order ke supplier / pusat");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <DataTable
        columns={columns}
        data={pos}
        keyExtractor={(r) => r.id}
        search={search}
        onSearchChange={setSearch}
      />
    </RoleGuard>
  );
}
