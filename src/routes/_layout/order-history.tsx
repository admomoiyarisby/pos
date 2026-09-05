import { createFileRoute } from "@tanstack/react-router";
import { lookupLabel } from "#/lib/label-lookup";
import { badgeVariant, searchStringParam } from "#/lib/utils";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable, { type Column } from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getOrders, getOrderWithItems, updateOrderStatus, voidOrder } from "#/lib/server/pos";
import OrderItemsTray from "#/components/pos/OrderItemsTray";
import HistoryDateFilter, { isoDateDaysAgo } from "#/components/pos/HistoryDateFilter";
import { Badge } from "#/components/ui/badge";
import { Printer, Pencil, Store, X } from "lucide-react";
import { toast } from "sonner";
import { printReceipt } from "#/lib/pos-print";
import { ORDER_CHANNEL_OPTIONS, channelLabel } from "#/lib/order-channels";

interface OrderRow {
  id: string;
  branchId: string;
  branchName: string | null;
  channel: string;
  orderCode: string | null;
  customerName: string | null;
  totalAmount: number;
  status: string;
  createdAt: Date;
}

const statusColors = {
  Completed: "success",
  New: "default",
  Processing: "warning",
  Void: "secondary",
  "Cancel Requested": "destructive",
} satisfies Record<string, string>;

const columns: Column<OrderRow>[] = [
  {
    accessorKey: "createdAt",
    header: "Waktu",
    width: "w-32",
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
    accessorKey: "channel",
    header: "Channel",
    enableSorting: true,
    cell: ({ row }) => <Badge variant="outline">{channelLabel(row.original.channel)}</Badge>,
  },
  {
    accessorKey: "branchName",
    header: "Cabang",
    width: "w-40",
    enableSorting: true,
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5 min-w-0">
        <Store className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="truncate">{row.original.branchName ?? "-"}</span>
      </span>
    ),
  },
  {
    accessorKey: "orderCode",
    header: "Kode",
    enableSorting: true,
    cell: ({ row }) => row.original.orderCode ?? row.original.customerName ?? "-",
  },
  {
    accessorKey: "totalAmount",
    header: "Total",
    align: "right",
    enableSorting: true,
    cell: ({ row }) => `Rp ${row.original.totalAmount.toLocaleString("id-ID")}`,
  },
  {
    accessorKey: "status",
    header: "Status",
    enableSorting: true,
    cell: ({ row }) => (
      <Badge variant={badgeVariant(lookupLabel(statusColors, row.original.status))}>
        {row.original.status || "-"}
      </Badge>
    ),
  },
];

const allowedStatusLabels = {
  New: "New",
  Processing: "Processing",
  "In Delivery": "In Delivery",
  Completed: "Completed",
} satisfies Record<string, string>;

export const Route = createFileRoute("/_layout/order-history")({
  component: OrderHistoryPage,
  loader: async () => {
    // Default to the trailing week (same as the POS history) so the table
    // isn't cluttered; the filter can widen it. Fetches up to 500 rows so
    // client-side search/sort/pagination have a useful dataset.
    const orders = await getOrders({ data: { dateFrom: isoDateDaysAgo(6), limit: 500 } });
    return { orders };
  },
});

function OrderHistoryPage() {
  const [search, setSearch] = useTableSearch();
  const { page, setPage, sort, setSort, filters, setFilter } = useTableUrlState(["channel"]);
  const { orders: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);
  const [dateFrom, setDateFrom] = useState(isoDateDaysAgo(6));
  const [dateTo, setDateTo] = useState("");

  const [statusModalOrder, setStatusModalOrder] = useState<OrderRow | null>(null);
  const [targetStatus, setTargetStatus] = useState<
    "" | "New" | "Processing" | "In Delivery" | "Completed"
  >("");
  const [voidModalOrder, setVoidModalOrder] = useState<OrderRow | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const { data: rawOrders, isFetching } = useQuery({
    queryKey: ["orders", dateFrom, dateTo],
    queryFn: () =>
      getOrders({
        data: {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          limit: 500,
        },
      }),
  });

  // Deduplicate by id — safeguard against duplicate rows in DB. Falls back to
  // the loader's rows (fetched with the default range) while a refetch runs.
  const orders = useMemo(() => {
    const seen = new Set<string>();
    return (rawOrders ?? initial).filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }, [rawOrders, initial]);

  const statusFilter = searchStringParam(Route.useSearch(), "status");
  const channelFilter = searchStringParam(filters, "channel");
  const filteredOrders = orders.filter((o) => {
    if (statusFilter && o.status !== statusFilter) return false;
    if (channelFilter && o.channel !== channelFilter) return false;
    return true;
  });

  const updateStatusMutation = useMutation({
    mutationFn: updateOrderStatus,
    onSuccess: function () {
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      setStatusModalOrder(null);
      setTargetStatus("");
    },
  });

  const voidMutation = useMutation({
    mutationFn: voidOrder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      setVoidModalOrder(null);
      setVoidReason("");
    },
    onError: (error: Error) => {
      toast.error("Gagal membatalkan pesanan", { description: error.message });
    },
  });

  usePageTitle("Riwayat Pemesanan", "Daftar lengkap pesanan dari semua cabang");

  const handleCloseModal = () => {
    setSelectedOrder(null);
  };

  return (
    <RoleGuard allowedRoles={["super_admin", "area_manager"]}>
      <div className="space-y-3">
        <div className="rounded-md border bg-card px-3 py-2.5">
          <div className="flex flex-col gap-2">
            <HistoryDateFilter
              dateFrom={dateFrom}
              dateTo={dateTo}
              onChange={function (from: string, to: string) {
                setDateFrom(from);
                setDateTo(to);
              }}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={channelFilter ?? ""}
                onChange={function (e) {
                  setFilter("channel", e.target.value || undefined);
                  setPage(0);
                }}
                aria-label="Filter channel"
                className="h-8 rounded-md border border-input bg-background px-2.5 text-xs font-medium"
              >
                <option value="">Semua Channel</option>
                {ORDER_CHANNEL_OPTIONS.map(function (c) {
                  return (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Menampilkan maks. 500 pesanan terbaru pada rentang tanggal</span>
              {isFetching && !rawOrders && <span>Memuat…</span>}
            </div>
          </div>
        </div>

        <DataTable
          columns={columns}
          data={filteredOrders}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => setSelectedOrder(r)}
          renderExpanded={(r) => <OrderItemsTray orderId={r.id} branchName={r.branchName} />}
          search={search}
          onSearchChange={setSearch}
          page={page}
          onPageChange={setPage}
          sort={sort}
          onSortChange={setSort}
        />
      </div>

      <Modal open={!!selectedOrder} onClose={handleCloseModal} title="Detail Pesanan" size="lg">
        {selectedOrder && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground uppercase">ID Pesanan</p>
                <p className="font-medium">{selectedOrder.id.slice(0, 8)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground uppercase">Cabang</p>
                <p className="font-medium">{selectedOrder.branchName ?? "-"}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground uppercase">Channel</p>
                <p className="font-medium">{channelLabel(selectedOrder.channel)}</p>
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
                  <Badge variant={badgeVariant(lookupLabel(statusColors, selectedOrder.status))}>
                    {selectedOrder.status}
                  </Badge>
                  <button
                    onClick={function (e: any) {
                      e.stopPropagation();
                      setStatusModalOrder(selectedOrder);
                      // SAFETY: only orders in one of the four mutable statuses
                      // open the change-status modal (allowedStatusLabels keys).
                      setTargetStatus(
                        selectedOrder.status as
                          | ""
                          | "New"
                          | "Processing"
                          | "In Delivery"
                          | "Completed",
                      );
                    }}
                    title="Ubah status"
                    className="h-5 w-5 inline-flex items-center justify-center rounded border text-muted-foreground hover:bg-accent"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground uppercase">Waktu</p>
                <p className="font-medium">
                  {new Date(selectedOrder.createdAt).toLocaleString("id-ID", {
                    timeZone: "Asia/Jakarta",
                  })}
                </p>
              </div>
            </div>

            <div className="border-t pt-4 space-y-2">
              {selectedOrder.status !== "Void" && (
                <button
                  onClick={function () {
                    setVoidModalOrder(selectedOrder);
                    setVoidReason("");
                  }}
                  className="w-full h-10 rounded-md border border-destructive/40 text-destructive text-sm font-medium flex items-center justify-center gap-2 hover:bg-destructive/5"
                >
                  <X className="h-4 w-4" />
                  Batalkan Pesanan
                </button>
              )}
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
                    modifiers: (item.modifiers ?? []).map((m: any) => ({
                      groupId: m.modifierGroupId ?? "",
                      modifierId: m.modifierId ?? "",
                      name: m.modifierName ?? "",
                      price: m.price ?? 0,
                      isExclusion: m.isExclusion ?? false,
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
                    order: printOrder,
                    cartItems,
                    branchName: selectedOrder.branchName ?? "",
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

      {/* ── Void (Cancel) Confirm Modal ── */}
      <Modal
        open={!!voidModalOrder}
        onClose={function () {
          setVoidModalOrder(null);
          setVoidReason("");
        }}
        title="Batalkan Pesanan"
        size="sm"
      >
        {voidModalOrder && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Apakah Anda yakin ingin membatalkan pesanan ini? Stok bahan baku akan dikembalikan.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Alasan Pembatalan</label>
              <input
                type="text"
                value={voidReason}
                onChange={function (e) {
                  setVoidReason(e.target.value);
                }}
                placeholder="Alasan pembatalan..."
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={function () {
                  setVoidModalOrder(null);
                  setVoidReason("");
                }}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={function () {
                  voidMutation.mutate({
                    data: { orderId: voidModalOrder.id, reason: voidReason },
                  });
                }}
                disabled={!voidReason.trim() || voidMutation.isPending}
                className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
              >
                {voidMutation.isPending ? "Memproses..." : "Batalkan Pesanan"}
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
              Pesanan:{" "}
              <span className="font-mono font-medium">#{statusModalOrder.id.slice(0, 8)}</span>
            </p>
            <div className="space-y-2">
              {Object.entries(allowedStatusLabels).map(function ([val, label]) {
                return (
                  <label
                    key={val}
                    className={
                      "flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors " +
                      (targetStatus === val ? "border-primary bg-primary/5" : "hover:bg-muted/50")
                    }
                  >
                    <input
                      type="radio"
                      name="order-status"
                      value={val}
                      checked={targetStatus === val}
                      onChange={function () {
                        // SAFETY: val iterates allowedStatusLabels keys, which
                        // are exactly the four mutable order statuses.
                        setTargetStatus(
                          val as "" | "New" | "Processing" | "In Delivery" | "Completed",
                        );
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
                    data: {
                      orderId: statusModalOrder.id,
                      newStatus: targetStatus,
                    },
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
