import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import {
  getOrders,
  requestReprint,
  getReprintRequestStatus,
  getOrderWithItems,
} from "#/lib/server/pos";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Printer, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { printReceipt } from "#/lib/pos-print";

type ReprintStatus = "idle" | "pending" | "already_pending" | "error";

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
  const [reprintStatus, setReprintStatus] = useState<ReprintStatus>("idle");

  const { data: orders } = useQuery({
    queryKey: ["orders"],
    queryFn: () => getOrders({ data: {} }),
    initialData: initial,
  });

  const reprintMutation = useMutation({
    mutationFn: requestReprint,
    onSuccess: (result) => {
      if ((result as any).alreadyPending) {
        setReprintStatus("already_pending");
      } else {
        setReprintStatus("pending");
      }
    },
    onError: () => {
      setReprintStatus("error");
    },
  });

  const { data: reprintStatusData } = useQuery({
    queryKey: ["reprint-status", selectedOrder?.id],
    queryFn: () => getReprintRequestStatus({ data: { orderId: selectedOrder!.id } }),
    enabled:
      (reprintStatus === "pending" || reprintStatus === "already_pending") && !!selectedOrder,
    refetchInterval: 5000,
  });

  const resolvedStatus =
    reprintStatusData?.status === "Approved"
      ? "approved"
      : reprintStatusData?.status === "Rejected"
        ? "rejected"
        : reprintStatus;

  usePageTitle("Riwayat Pemesanan", "Daftar lengkap pesanan dari semua cabang");

  const handleCloseModal = () => {
    setSelectedOrder(null);
    setReprintStatus("idle");
  };

  const handleReprint = () => {
    if (!selectedOrder) return;
    setReprintStatus("idle");
    reprintMutation.mutate({
      data: { orderId: selectedOrder.id, requestType: "reprint" },
    });
  };

  const printApprovedInvoice = async () => {
    if (!selectedOrder) return;
    const orderData = await getOrderWithItems({ data: { id: selectedOrder.id } });
    if (!orderData) return;

    let itemsHtml = "";
    for (const item of orderData.items) {
      let modLines = "";
      if (item.modifiers && item.modifiers.length > 0) {
        modLines =
          '<div style="font-size: 10px; color: #444; padding-left: 2mm;">' +
          item.modifiers.map((m: string | null) => "+ " + (m ?? "")).join("<br>") +
          "</div>";
      }
      let noteLine = item.notes
        ? '<div style="font-size: 10px; font-style: italic; color: #666; padding-left: 2mm;">Note: ' +
          item.notes +
          "</div>"
        : "";
      itemsHtml +=
        '<div style="margin-bottom: 3mm;">' +
        '<div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold;">' +
        '<div style="flex: 1;">' +
        (item.recipeName ?? item.recipeId) +
        "</div>" +
        '<div style="width: 10mm; text-align: center;">' +
        item.quantity +
        "</div>" +
        '<div style="width: 25mm; text-align: right;">' +
        (item.price * item.quantity).toLocaleString("id-ID") +
        "</div>" +
        "</div>" +
        modLines +
        noteLine +
        "</div>";
    }

    const idStr = selectedOrder.id.slice(0, 8).toUpperCase();
    const lines = [
      "<html><head>",
      "<title>Invoice - " + idStr + "</title>",
      "<style>",
      "@page { margin: 0; }",
      "body { font-family: 'Courier New', monospace; max-width: 80mm; margin: 5mm auto; padding: 5mm; font-size: 12px; position: relative; }",
      ".wm-wrap { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }",
      ".wm-wrap img { max-width: 60mm; opacity: 0.06; }",
      ".content { position: relative; z-index: 1; }",
      ".center { text-align: center; }",
      ".header { font-size: 16px; font-weight: bold; margin-bottom: 2mm; }",
      ".subheader { font-size: 11px; color: #444; margin-bottom: 4mm; }",
      ".divider { border-top: 1px dashed #000; margin: 3mm 0; }",
      ".row { display: flex; justify-content: space-between; }",
      ".total { font-size: 14px; font-weight: bold; margin-top: 2mm; }",
      ".footer { margin-top: 5mm; font-size: 10px; color: #444; text-align: center; }",
      "</style></head><body>",
      '<div class="wm-wrap"><img src="/logo-for-light-mode.png" alt="" /></div>',
      '<div class="content">',
      '<div class="center header">Omoiyari POS</div>',
      '<div class="center subheader">' + ((orderData as any).branchName ?? "") + "</div>",
      '<div class="center subheader">' + new Date().toLocaleString("id-ID") + "</div>",
      '<div class="divider"></div>',
      '<div class="row"><span>No. Order:</span><span>' + idStr + "</span></div>",
      '<div class="row"><span>Channel:</span><span>' + selectedOrder.channel + "</span></div>",
      '<div class="divider"></div>',
      itemsHtml,
      '<div class="divider"></div>',
      '<div class="row"><span>Subtotal</span><span>Rp ' +
        selectedOrder.totalAmount.toLocaleString("id-ID") +
        "</span></div>",
      '<div class="row total"><span>TOTAL</span><span>Rp ' +
        selectedOrder.totalAmount.toLocaleString("id-ID") +
        "</span></div>",
      '<div class="divider"></div>',
      '<div class="footer">Terima kasih telah berbelanja</div>',
      "</div>",
      "<script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>",
      "</body></html>",
    ];

    const pw = window.open("", "_blank");
    if (pw) {
      pw.document.write(lines.join("\n"));
      pw.document.close();
    }
  };

  const isCompleted = selectedOrder?.status === "Completed";

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

            {isCompleted && (
              <div className="border-t pt-4 space-y-3">
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

                <div className="border-t pt-3">
                  <button
                    onClick={handleReprint}
                    disabled={reprintMutation.isPending}
                    className="w-full h-10 rounded-md border border-dashed text-sm font-medium text-muted-foreground hover:bg-muted flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Printer className="h-4 w-4" />
                    {reprintMutation.isPending ? "Memproses..." : "Cetak Ulang (via Approval)"}
                  </button>

                  {reprintStatus === "pending" && (
                    <div className="mt-3 rounded-md bg-blue-500/10 px-3 py-2 text-xs text-blue-600 flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>Permintaan cetak ulang dikirim ke Area Manager untuk disetujui</span>
                    </div>
                  )}

                  {reprintStatus === "already_pending" && (
                    <div className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600 flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Permintaan cetak ulang sudah diajukan sebelumnya dan menunggu persetujuan
                      </span>
                    </div>
                  )}

                  {resolvedStatus === "approved" && (
                    <div className="mt-3 rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1">Permintaan cetak ulang telah disetujui</span>
                      <button
                        onClick={printApprovedInvoice}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-700"
                      >
                        <Printer className="h-3 w-3" />
                        Cetak
                      </button>
                    </div>
                  )}

                  {resolvedStatus === "rejected" && (
                    <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>Permintaan cetak ulang ditolak</span>
                    </div>
                  )}

                  {reprintStatus === "error" && (
                    <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>Gagal mengajukan permintaan cetak ulang</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </RoleGuard>
  );
}
