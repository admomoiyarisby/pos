import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getOrders } from "#/lib/server/pos";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";

interface OrderRow {
  id: string;
  channel: string;
  orderCode: string | null;
  customerName: string | null;
  totalAmount: number;
  status: string;
  createdAt: Date;
}

const channelLabels: Record<string, string> = {
  Gofood: "Gofood",
  Grabfood: "Grabfood",
  ShopeeFood: "ShopeeFood",
  "Dine-in": "Dine-in",
};

const statusColors: Record<string, string> = {
  Completed: "success",
  New: "default",
  Processing: "warning",
  Void: "secondary",
  "Cancel Requested": "destructive",
};

const columns: Column<OrderRow>[] = [
  {
    key: "createdAt",
    header: "Waktu",
    width: "w-32",
    render: (r) =>
      new Date(r.createdAt).toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
  },
  {
    key: "channel",
    header: "Channel",
    render: (r) => <Badge variant="outline">{channelLabels[r.channel] ?? r.channel}</Badge>,
  },
  { key: "orderCode", header: "Kode", render: (r) => r.orderCode ?? r.customerName ?? "-" },
  {
    key: "totalAmount",
    header: "Total",
    align: "right",
    render: (r) => `Rp ${r.totalAmount.toLocaleString("id-ID")}`,
  },
  {
    key: "status",
    header: "Status",
    render: (r) => (
      <Badge
        variant={
          (statusColors[r.status] ?? "default") as
            | "default"
            | "success"
            | "warning"
            | "destructive"
            | "secondary"
        }
      >
        {r.status}
      </Badge>
    ),
  },
];

export const Route = createFileRoute("/_layout/order-history")({
  component: OrderHistoryPage,
  loader: async () => {
    const orders = await getOrders({ data: {} });
    return { orders };
  },
});

function OrderHistoryPage() {
  const { orders: initial } = Route.useLoaderData();
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);

  const { data: orders } = useQuery({
    queryKey: ["orders"],
    queryFn: () => getOrders({ data: {} }),
    initialData: initial,
  });
  usePageTitle("Riwayat Pemesanan", "Daftar lengkap pesanan dari semua cabang");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <DataTable
        columns={columns}
        data={orders}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => setSelectedOrder(r)}
      />

      <Modal
        open={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        title="Detail Pesanan"
        size="lg"
      >
        {selectedOrder && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground uppercase">ID Pesanan</p>
                <p className="font-medium">{selectedOrder.id.slice(0, 8)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground uppercase">Channel</p>
                <p className="font-medium">
                  {channelLabels[selectedOrder.channel] ?? selectedOrder.channel}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground uppercase">Total</p>
                <p className="font-medium">
                  Rp {selectedOrder.totalAmount.toLocaleString("id-ID")}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground uppercase">Status</p>
                <Badge
                  variant={
                    (statusColors[selectedOrder.status] ?? "default") as
                      | "default"
                      | "success"
                      | "warning"
                      | "destructive"
                      | "secondary"
                  }
                >
                  {selectedOrder.status}
                </Badge>
              </div>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground uppercase">Waktu</p>
              <p className="font-medium">
                {new Date(selectedOrder.createdAt).toLocaleString("id-ID")}
              </p>
            </div>
          </div>
        )}
      </Modal>
    </RoleGuard>
  );
}
