import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useCallback } from "react";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ORDER_CHANNEL_VALUES } from "#/db/schema";
import { lookupLabel } from "#/lib/label-lookup";
import { toast } from "sonner";
import { Trash2, Pencil, Plus, ChevronDown, ChevronRight, Search } from "lucide-react";
import RoleGuard from "#/components/RoleGuard";
import Modal from "#/components/ui/Modal";
import { usePageTitle } from "#/hooks/usePageTitle";
import { useAuth } from "#/lib/auth-context";
import { getBranches } from "#/lib/server/branches";
import { getRecipesWithHpp } from "#/lib/server/finance";
import MoneyInput from "#/components/MoneyInput";
import {
  getSalesData,
  getSalesOrderDetail,
  getSalesSummary,
  createSalesOrder,
  updateSalesOrder,
  deleteSalesOrder,
} from "#/lib/server/sales-data";
import { formatRp } from "#/lib/utils";

export const Route = createFileRoute("/_layout/data-penjualan")({
  component: DataPenjualanPage,
  loader: async () => {
    const branches = await getBranches({ data: {} });
    return { branches };
  },
});

const CHANNELS = [
  { value: "all", label: "Semua Channel" },
  { value: "Dine-in", label: "Offline (Dine-in)" },
  { value: "Gofood", label: "Gojek (Gofood)" },
  { value: "Grabfood", label: "Grab (Grabfood)" },
  { value: "ShopeeFood", label: "Shopee (ShopeeFood)" },
  { value: "TikTok", label: "TikTok" },
];

const CHANNEL_COLORS = {
  "Dine-in": "bg-blue-100 text-blue-700",
  Gofood: "bg-green-100 text-green-700",
  Grabfood: "bg-orange-100 text-orange-700",
  ShopeeFood: "bg-red-100 text-red-700",
  TikTok: "bg-gray-100 text-gray-700",
} satisfies Record<string, string>;

function DataPenjualanPage() {
  const { branches } = Route.useLoaderData();
  usePageTitle("Data Penjualan", "Kelola data penjualan semua channel");

  const { user } = useAuth();
  const queryClient = useQueryClient();
  const now = new Date();

  // URL-persisted filters (month/branch/channel/search) + page so the exact
  // list view survives reload and back-navigation. Defaults: current month,
  // all branches, all channels.
  const {
    page,
    setPage,
    filters: { month, branchId: branchIdFilter, channel, q },
    setFilter,
  } = useTableUrlState<{
    month?: string;
    branchId?: string;
    channel?: string;
    q?: string;
  }>(["month", "branchId", "channel", "q"]);
  const selectedMonth =
    month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const selectedBranchId = branchIdFilter ?? "";
  const selectedChannel = channel ?? "all";
  const searchQuery = q ?? "";
  const limit = 50;

  // Modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [deletingOrder, setDeletingOrder] = useState<any>(null);

  // Compute date range
  const { dateFrom, dateTo } = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      dateFrom: `${selectedMonth}-01`,
      dateTo: `${selectedMonth}-${String(lastDay).padStart(2, "0")}`,
    };
  }, [selectedMonth]);

  const branchId = selectedBranchId || undefined;

  // Fetch data
  const { data: salesData, isLoading } = useQuery({
    queryKey: ["sales-data", branchId, selectedChannel, dateFrom, dateTo, page],
    queryFn: () =>
      getSalesData({
        data: { branchId, channel: selectedChannel, dateFrom, dateTo, page, limit },
      }),
  });

  const { data: summary } = useQuery({
    queryKey: ["sales-summary", branchId, dateFrom, dateTo],
    queryFn: () => getSalesSummary({ data: { branchId, dateFrom, dateTo } }),
  });

  const { data: recipes } = useQuery({
    queryKey: ["recipes-hpp"],
    queryFn: () => getRecipesWithHpp({ data: {} }),
  });

  // Filter by search
  const filteredOrders = useMemo(() => {
    if (!salesData?.orders) return [];
    if (!searchQuery) return salesData.orders;
    const q = searchQuery.toLowerCase();
    return salesData.orders.filter(
      (o) =>
        o.orderCode?.toLowerCase().includes(q) ||
        o.customerName?.toLowerCase().includes(q) ||
        o.notes?.toLowerCase().includes(q),
    );
  }, [salesData, searchQuery]);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSalesOrder({ data: { id } }),
    onSuccess: () => {
      toast.success("Pesanan berhasil dihapus");
      setDeleteModalOpen(false);
      setDeletingOrder(null);
      void queryClient.invalidateQueries({ queryKey: ["sales-data"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-summary"] });
    },
    onError: (err: Error) => {
      toast.error("Gagal menghapus", { description: err.message });
    },
  });

  const handleDelete = useCallback(() => {
    if (deletingOrder) {
      deleteMutation.mutate(deletingOrder.id);
    }
  }, [deletingOrder, deleteMutation]);

  const canEdit = user?.role === "super_admin" || user?.role === "admin_pusat";

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-6 p-4 rounded-lg border">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Bulan</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => {
              setFilter("month", e.target.value);
              setPage(0);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Cabang</label>
          <select
            value={selectedBranchId}
            onChange={(e) => {
              setFilter("branchId", e.target.value);
              setPage(0);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
          >
            <option value="">Semua Cabang</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Channel</label>
          <select
            value={selectedChannel}
            onChange={(e) => {
              setFilter("channel", e.target.value);
              setPage(0);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm block"
          >
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px] space-y-1">
          <label className="text-xs text-muted-foreground">Cari</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Kode order, nama, catatan…"
              value={searchQuery}
              onChange={(e) => setFilter("q", e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm block"
            />
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6 py-3 px-4 rounded-lg border bg-muted/30">
        <SummaryItem label="Order" value={String(summary?.totals.orderCount ?? 0)} />
        <SummaryItem label="Omzet" value={formatRp(summary?.totals.totalAmount ?? 0)} />
        <SummaryItem label="HPP" value={formatRp(summary?.totals.totalCogs ?? 0)} />
        <SummaryItem
          label="Profit"
          value={formatRp((summary?.totals.totalAmount ?? 0) - (summary?.totals.totalCogs ?? 0))}
          positive={(summary?.totals.totalAmount ?? 0) - (summary?.totals.totalCogs ?? 0) >= 0}
        />
      </div>

      {/* Channel breakdown */}
      {summary?.byChannel && summary.byChannel.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {summary.byChannel.map((ch) => (
            <div
              key={ch.channel}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm"
            >
              <span
                className={`inline-block w-2 h-2 rounded-full ${lookupLabel(CHANNEL_COLORS, ch.channel) ?? "bg-gray-300"}`}
              />
              <span className="text-muted-foreground">{ch.channel}:</span>
              <span className="font-medium tabular-nums">{ch.orderCount} order</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-medium tabular-nums">{formatRp(ch.totalAmount ?? 0)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Data Table */}
      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2.5 px-3 font-medium w-8" />
                <th className="text-left py-2.5 px-3 font-medium">Tanggal</th>
                <th className="text-left py-2.5 px-3 font-medium">Channel</th>
                <th className="text-left py-2.5 px-3 font-medium">Cabang</th>
                <th className="text-left py-2.5 px-3 font-medium">Kode Order</th>
                <th className="text-right py-2.5 px-3 font-medium">Item</th>
                <th className="text-right py-2.5 px-3 font-medium">Omzet</th>
                <th className="text-right py-2.5 px-3 font-medium">HPP</th>
                <th className="text-right py-2.5 px-3 font-medium">Profit</th>
                <th className="text-right py-2.5 px-3 font-medium w-20">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-muted-foreground">
                    Memuat data…
                  </td>
                </tr>
              ) : filteredOrders.length > 0 ? (
                filteredOrders.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    branchName={branches.find((b) => b.id === order.branchId)?.name ?? "-"}
                    onEdit={() => {
                      setEditingOrder(order);
                      setEditModalOpen(true);
                    }}
                    onDelete={() => {
                      setDeletingOrder(order);
                      setDeleteModalOpen(true);
                    }}
                    canEdit={canEdit}
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-muted-foreground">
                    Tidak ada data penjualan
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {salesData && salesData.total > limit && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">
            Menampilkan {page * limit + 1}–{Math.min((page + 1) * limit, salesData.total)} dari{" "}
            {salesData.total}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="h-9 px-3 rounded-md border text-sm disabled:opacity-50"
            >
              Sebelumnya
            </button>
            <button
              type="button"
              onClick={() => setPage(page + 1)}
              disabled={(page + 1) * limit >= salesData.total}
              className="h-9 px-3 rounded-md border text-sm disabled:opacity-50"
            >
              Selanjutnya
            </button>
          </div>
        </div>
      )}

      {/* Edit/Create Modal */}
      {editModalOpen && (
        <OrderEditModal
          order={editingOrder}
          recipes={recipes ?? []}
          branches={branches}
          defaultDate={dateFrom}
          onClose={() => {
            setEditModalOpen(false);
            setEditingOrder(null);
          }}
          onSaved={() => {
            setEditModalOpen(false);
            setEditingOrder(null);
            void queryClient.invalidateQueries({ queryKey: ["sales-data"] });
            void queryClient.invalidateQueries({ queryKey: ["sales-summary"] });
          }}
        />
      )}

      {/* Delete Confirmation */}
      <Modal
        open={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setDeletingOrder(null);
        }}
        title="Hapus Pesanan"
      >
        <p className="text-sm text-muted-foreground mb-4">
          Yakin ingin menghapus pesanan{" "}
          <span className="font-medium text-foreground">{deletingOrder?.orderCode ?? "-"}</span>?
          Tindakan ini tidak dapat dibatalkan.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setDeleteModalOpen(false);
              setDeletingOrder(null);
            }}
            className="h-9 px-4 rounded-md border text-sm"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="h-9 px-4 rounded-md bg-destructive text-white text-sm disabled:opacity-50"
          >
            {deleteMutation.isPending ? "Menghapus…" : "Hapus"}
          </button>
        </div>
      </Modal>
    </RoleGuard>
  );
}

/* ─── Order Row ──────────────────────────────────────────────── */

function OrderRow({
  order,
  branchName,
  onEdit,
  onDelete,
  canEdit,
}: {
  order: any;
  branchName: string;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const profit = order.totalAmount - order.totalCogs;

  return (
    <>
      <tr className="border-b hover:bg-muted/30">
        <td className="py-2 px-3">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="p-1 hover:bg-muted rounded"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="py-2 px-3 text-muted-foreground">
          {order.createdAt
            ? new Date(order.createdAt).toLocaleDateString("id-ID", {
                day: "numeric",
                month: "short",
              })
            : "-"}
        </td>
        <td className="py-2 px-3">
          <span
            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${lookupLabel(CHANNEL_COLORS, order.channel) ?? "bg-gray-100"}`}
          >
            {order.channel}
          </span>
        </td>
        <td className="py-2 px-3">{branchName}</td>
        <td className="py-2 px-3 font-medium">{order.orderCode ?? "-"}</td>
        <td className="py-2 px-3 text-right tabular-nums">{order.itemCount}</td>
        <td className="py-2 px-3 text-right tabular-nums font-medium">
          {formatRp(order.totalAmount)}
        </td>
        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
          {formatRp(order.totalCogs)}
        </td>
        <td
          className={`py-2 px-3 text-right tabular-nums font-medium ${profit >= 0 ? "text-emerald-600" : "text-destructive"}`}
        >
          {formatRp(profit)}
        </td>
        <td className="py-2 px-3 text-right">
          {canEdit && (
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={onEdit}
                className="p-1.5 rounded hover:bg-muted"
                title="Edit"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
                title="Hapus"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/20">
          <td colSpan={10} className="px-6 py-3">
            <div className="text-xs text-muted-foreground space-y-1">
              {order.customerName && <p>Pelanggan: {order.customerName}</p>}
              {order.notes && <p>Catatan: {order.notes}</p>}
              <p>
                Subtotal: {formatRp(order.subtotal)} · Diskon:{" "}
                {formatRp(order.merchantDiscount + order.platformDiscount)} · Pajak:{" "}
                {formatRp(order.taxAmount)} · MDR: {formatRp(order.mdrFee)} · Net:{" "}
                {formatRp(order.netSales)}
              </p>
              <p className="text-muted-foreground/70">
                ID: {order.id.slice(0, 8)} · Dibuat:{" "}
                {order.createdAt ? new Date(order.createdAt).toLocaleString("id-ID") : "-"}
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── Summary Item (inline) ──────────────────────────────────── */

function SummaryItem({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-semibold tabular-nums ${
          positive === false ? "text-destructive" : positive ? "text-emerald-600" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/* ─── Order Edit Modal ───────────────────────────────────────── */

interface OrderItemInput {
  id?: string;
  recipeId: string;
  quantity: number;
  price: number;
  notes?: string;
}

function OrderEditModal({
  order,
  recipes,
  branches,
  defaultDate,
  onClose,
  onSaved,
}: {
  order: any;
  recipes: { id: string; name: string; totalCogs: number }[];
  branches: { id: string; name: string }[];
  defaultDate?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!order;

  const [branchId, setBranchId] = useState(order?.branchId ?? branches[0]?.id ?? "");
  const [channel, setChannel] = useState<(typeof ORDER_CHANNEL_VALUES)[number]>(
    order?.channel ?? "Gofood",
  );
  const [orderCode, setOrderCode] = useState(order?.orderCode ?? "");
  const [customerName, setCustomerName] = useState(order?.customerName ?? "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [date, setDate] = useState(() => {
    if (order?.createdAt) {
      return new Date(order.createdAt).toISOString().split("T")[0];
    }
    return defaultDate ?? new Date().toISOString().split("T")[0];
  });
  const [items, setItems] = useState<OrderItemInput[]>([]);

  // Fetch order details if editing
  const { data: orderDetail, isLoading: orderLoading } = useQuery({
    queryKey: ["sales-order-detail", order?.id],
    queryFn: () => getSalesOrderDetail({ data: { id: order!.id } }),
    enabled: isEdit && !!order?.id,
  });

  // Initialize items from order detail
  useMemo(() => {
    if (orderDetail?.items) {
      setItems(
        orderDetail.items.map((i: any) => ({
          id: i.id,
          recipeId: i.recipeId,
          quantity: i.quantity,
          price: i.price,
          notes: i.notes ?? "",
        })),
      );
    }
  }, [orderDetail]);

  // Add empty item row
  const addItem = useCallback(() => {
    setItems((prev) => [...prev, { recipeId: recipes[0]?.id ?? "", quantity: 1, price: 0 }]);
  }, [recipes]);

  // Remove item row
  const removeItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Update item
  const updateItem = useCallback((index: number, field: keyof OrderItemInput, value: any) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }, []);

  // Calculate totals
  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items],
  );

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        branchId,
        channel,
        orderCode: orderCode || undefined,
        customerName: customerName || undefined,
        notes: notes || undefined,
        date,
        items: items.filter((i) => i.recipeId && i.quantity > 0),
      };

      if (isEdit) {
        return updateSalesOrder({ data: { id: order.id, ...payload } });
      }
      return createSalesOrder({ data: payload });
    },
    onSuccess: () => {
      toast.success(isEdit ? "Pesanan berhasil diubah" : "Pesanan berhasil dibuat");
      onSaved();
    },
    onError: (err: Error) => {
      toast.error("Gagal menyimpan", { description: err.message });
    },
  });

  const isValid =
    branchId && channel && items.length > 0 && items.every((i) => i.recipeId && i.quantity > 0);

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit Pesanan" : "Tambah Pesanan"} size="xl">
      {isEdit && orderLoading ? (
        <div className="py-8 text-center text-muted-foreground">Memuat detail…</div>
      ) : (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Tanggal</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Channel</label>
              <select
                value={channel}
                onChange={(e) =>
                  // SAFETY: the channel select only offers the five literal
                  // channel options rendered below.
                  setChannel(e.target.value as (typeof ORDER_CHANNEL_VALUES)[number])
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {CHANNELS.filter((c) => c.value !== "all").map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Cabang</label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Kode Order</label>
              <input
                type="text"
                value={orderCode}
                onChange={(e) => setOrderCode(e.target.value)}
                placeholder="INV/xxx/..."
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Pelanggan</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nama pelanggan"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Catatan</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground font-medium">Item</label>
              <button
                type="button"
                onClick={addItem}
                className="h-7 px-2 rounded border text-xs flex items-center gap-1 hover:bg-muted"
              >
                <Plus className="h-3 w-3" /> Tambah Item
              </button>
            </div>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-3 font-medium text-xs">Menu</th>
                    <th className="text-right py-2 px-2 font-medium text-xs w-20">Qty</th>
                    <th className="text-right py-2 px-2 font-medium text-xs w-28">Harga</th>
                    <th className="text-right py-2 px-2 font-medium text-xs w-28">Subtotal</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    return (
                      <tr key={i} className="border-b last:border-b-0">
                        <td className="py-1.5 px-3">
                          <select
                            value={item.recipeId}
                            onChange={(e) => updateItem(i, "recipeId", e.target.value)}
                            className="h-8 w-full rounded border border-input bg-background px-2 text-sm"
                          >
                            <option value="">Pilih menu…</option>
                            {recipes.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) => updateItem(i, "quantity", Number(e.target.value) || 1)}
                            className="h-8 w-full rounded border border-input bg-background px-2 text-sm text-right tabular-nums"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <MoneyInput
                            value={item.price}
                            onChange={(raw) => updateItem(i, "price", raw ?? 0)}
                          />
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-sm">
                          {formatRp(item.price * item.quantity)}
                        </td>
                        <td className="py-1.5 px-1">
                          <button
                            type="button"
                            onClick={() => removeItem(i)}
                            className="p-1 rounded hover:bg-destructive/10 text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Total */}
          <div className="flex justify-between items-center py-2 border-t">
            <span className="text-sm font-medium">Total</span>
            <span className="text-lg font-semibold tabular-nums">{formatRp(subtotal)}</span>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-md border text-sm">
              Batal
            </button>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={!isValid || saveMutation.isPending}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {saveMutation.isPending ? "Menyimpan…" : isEdit ? "Simpan Perubahan" : "Buat Pesanan"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
