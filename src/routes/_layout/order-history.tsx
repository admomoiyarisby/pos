import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import {
  getOrders,
  getOrderWithItems,
  updateOrderStatus,
} from "#/lib/server/pos";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Printer, Pencil } from "lucide-react";
import { printReceipt } from "#/lib/pos-print";

interface OrderRow {
  id: string;
  branchId: string;
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
    key: "channel",
    header: "Channel",
    sortable: true,
    render: (r) => <Badge variant="outline">{channelLabels[r.channel] ?? r.channel}</Badge>,
  },
  {
    key: "orderCode",
    header: "Kode",
    sortable: true,
    render: (r) => r.orderCode ?? r.customerName ?? "-",
  },
  {
    key: "totalAmount",
    header: "Total",
    align: "right",
    sortable: true,
    render: (r) => `Rp ${r.totalAmount.toLocaleString("id-ID")}`,
  },
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
            | "secondary"
        }
      >
        {r.status || "-"}
      </Badge>
    ),
  },
];

const allowedStatusLabels: Record<string, string> = {
  New: "New",
  Processing: "Processing",
  "In Delivery": "In Delivery",
  Completed: "Completed",
};

export const Route = createFileRoute("/_layout/order-history")({
  component: OrderHistoryPage,
  loader: async () => {
    const orders = await getOrders({ data: {} });
    return { orders };
  },
});

function OrderHistoryPage() {
  const { orders: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);

  const [statusModalOrder, setStatusModalOrder] = useState<OrderRow | null>(null);
  const [targetStatus, setTargetStatus] = useState<string>("");

  const { data: rawOrders } = useQuery({
    queryKey: ["orders"],
    queryFn: () => getOrders({ data: {} }),
    initialData: initial,
  });

  // Deduplicate by id — safeguard against duplicate rows in DB
  const orders = useMemo(() => {
    const seen = new Set<string>();
    return (rawOrders ?? []).filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }, [rawOrders]);

  const updateStatusMutation = useMutation({
    mutationFn: updateOrderStatus,
    onSuccess: function () {
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      setStatusModalOrder(null);
      setTargetStatus("");
    },
  });

  usePageTitle("Riwayat Pemesanan", "Daftar lengkap pesanan dari semua cabang");

  const handleCloseModal = () => {
    setSelectedOrder(null);
  };

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <DataTable
        columns={columns}
        data={orders}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => setSelectedOrder(r)}
      />

      <Modal open={!!selectedOrder} onClose={handleCloseModal} title="Detail Pesanan" size="lg">
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
                <div className="flex items-center gap-2 mt-0.5">
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
                  <button
                    onClick={function (e: any) {
                      e.stopPropagation();
                      setStatusModalOrder(selectedOrder);
                      setTargetStatus(selectedOrder.status);
                    }}
                    title="Ubah status"
                    className="h-5 w-5 inline-flex items-center justify-center rounded border text-muted-foreground hover:bg-accent"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>

                </div>
              </div>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground uppercase">Waktu</p>
              <p className="font-medium">
                {new Date(selectedOrder.createdAt).toLocaleString("id-ID")}
              </p>
            </div>

            <div className="border-t pt-4">
              <button
                onClick={async function () {
                  const orderData = await getOrderWithItems({ data: { id: selectedOrder.id } });
                  if (!orderData) return;
                  const cartItems = orderData.items.map((item: any) => ({
                    recipeId: item.recipeId,
                    brandId: undefined,
                    name: item.recipeName ?? item.recipeId,
                    price: item.price,
                    quantity: item.quantity,
                    modifiers: (item.modifiers ?? []).map((mName: string) => ({
                      groupId: "",
                      modifierId: "",
                      name: mName,
                      price: 0,
                      isExclusion: false,
                    })),
                    notes: item.notes ?? "",
                  }));
                  const printOrder = {
                    id: orderData.id,
                    branchId: orderData.branchId,
                    channel: orderData.channel,
                    subtotal: orderData.subtotal,
                    taxAmount: orderData.taxAmount ?? 0,
                    totalAmount: orderData.totalAmount,
                    totalCogs: orderData.totalCogs ?? 0,
                    orderCode: orderData.orderCode,
                    customerName: orderData.customerName,
                    paymentMethod: orderData.paymentMethod,
                    voucherCode: orderData.voucherCode,
                    voucherDiscount: orderData.voucherDiscount,
                    status: orderData.status,
                    voidReason: orderData.voidReason,
                    notes: orderData.notes,
                    shiftId: orderData.shiftId,
                    createdAt: orderData.createdAt,
                    completedAt: orderData.completedAt,
                  };
                  printReceipt({
                    order: printOrder as any,
                    cartItems,
                    branchName: "",
                  });
                }}
                className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2"
              >
                <Printer className="h-4 w-4" />
                Cetak Invoice
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Status Change Modal ── */}
      <Modal
        open={!!statusModalOrder}
        onClose={function () {
          setStatusModalOrder(null);
          setTargetStatus("");
        }}
        title="Ubah Status Pesanan"
        size="sm"
      >
        {statusModalOrder && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Pesanan: <span className="font-mono font-medium">#{statusModalOrder.id.slice(0, 8)}</span>
            </p>
            <div className="space-y-2">
              {Object.entries(allowedStatusLabels).map(function ([val, label]) {
                return (
                  <label
                    key={val}
                    className={
                      "flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors " +
                      (targetStatus === val
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50")
                    }
                  >
                    <input
                      type="radio"
                      name="order-status"
                      value={val}
                      checked={targetStatus === val}
                      onChange={function () {
                        setTargetStatus(val);
                      }}
                      className="text-primary"
                    />
                    <span className="text-sm font-medium">{label}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={function () {
                  setStatusModalOrder(null);
                  setTargetStatus("");
                }}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Batal
              </button>
              <button
                onClick={function () {
                  if (!targetStatus || targetStatus === statusModalOrder.status) return;
                  updateStatusMutation.mutate({
                    data: { orderId: statusModalOrder.id, newStatus: targetStatus as "New" | "Processing" | "In Delivery" | "Completed" },
                  });
                }}
                disabled={
                  !targetStatus ||
                  targetStatus === statusModalOrder.status ||
                  updateStatusMutation.isPending
                }
                className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
              >
                {updateStatusMutation.isPending ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </RoleGuard>
  );
}
