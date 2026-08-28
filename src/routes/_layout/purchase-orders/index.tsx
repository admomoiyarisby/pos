import { createFileRoute } from "@tanstack/react-router";
import { badgeVariant } from "#/lib/utils";
import { lookupLabel } from "#/lib/label-lookup";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable, { type Column } from "#/components/ui/DataTable";
import { getPurchaseOrders } from "#/lib/server/scm";
import { Badge } from "#/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { ArrowRight } from "lucide-react";

interface PORow {
  id: string;
  code: string;
  fromBranchId: string;
  toBranchId: string;
  status: string;
  createdAt: Date;
}

const statusColors = {
  Draft: "secondary",
  Sent: "warning",
  Partial: "default",
  Completed: "success",
  Cancelled: "destructive",
} satisfies Record<string, "default" | "secondary" | "warning" | "success" | "destructive">;

export const Route = createFileRoute("/_layout/purchase-orders/")({
  component: POPage,
  loader: async () => {
    const pos = await getPurchaseOrders({ data: {} });
    return { pos };
  },
});

function POPage() {
  const [search, setSearch] = useTableSearch();
  const { page, setPage, sort, setSort } = useTableUrlState();
  const { pos: initial } = Route.useLoaderData();

  const { data: pos } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => getPurchaseOrders({ data: {} }),
    initialData: initial,
  });

  const columns: Column<PORow>[] = [
    { accessorKey: "code", header: "Kode PO", width: "w-28", enableSorting: true },
    {
      accessorKey: "fromBranchId",
      header: "Dari",
      enableSorting: true,
      cell: ({ row }) => row.original.fromBranchId.slice(0, 8),
    },
    {
      accessorKey: "toBranchId",
      header: "Ke",
      enableSorting: true,
      cell: ({ row }) => row.original.toBranchId.slice(0, 8),
    },
    {
      accessorKey: "status",
      header: "Status",
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={badgeVariant(lookupLabel(statusColors, row.original.status))}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Dibuat",
      enableSorting: true,
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString("id-ID"),
    },
    {
      accessorKey: "id",
      header: "",
      width: "w-12",
      cell: ({ row }) => (
        <Link
          to="/purchase-orders/$poId"
          params={{ poId: row.original.id }}
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
        page={page}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
      />
    </RoleGuard>
  );
}
