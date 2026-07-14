import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import {
  getSalesRecords,
  createSalesRecord,
  updateSalesRecord,
  deleteSalesRecord,
  type SalesRow,
} from "#/lib/server/sales";
import { getBranches } from "#/lib/server/branches";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import MoneyInput from "#/components/MoneyInput";

export const Route = createFileRoute("/_layout/admin/sales")({
  component: SalesAdminPage,
});

const channelLabels: Record<string, string> = {
  Gofood: "Gofood",
  Grabfood: "Grabfood",
  ShopeeFood: "ShopeeFood",
  "Dine-in": "Dine-in",
  TikTok: "TikTok",
};

const statusColors: Record<string, "default" | "success" | "destructive" | "secondary"> = {
  Completed: "success",
  Processing: "default",
  Void: "destructive",
  "Cancel Requested": "secondary",
};

function formatRupiah(value: number): string {
  return `Rp${value.toLocaleString("id-ID")}`;
}

function SalesAdminPage() {
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [branchId, setBranchId] = useState("");
  const [channel, setChannel] = useState("");
  const [editModal, setEditModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<SalesRow | null>(null);
  const [editAmount, setEditAmount] = useState("");

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ data: {} }),
  });

  const { data: records } = useQuery({
    queryKey: ["sales-admin", dateFrom, dateTo, branchId, channel],
    queryFn: () =>
      getSalesRecords({
        data: {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          branchId: branchId || undefined,
          channel: channel || undefined,
          limit: 100,
        },
      }),
  });

  const updateMutation = useMutation({
    mutationFn: updateSalesRecord,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-admin"] });
      setEditModal(false);
      toast.success("Data penjualan berhasil diperbarui");
    },
    onError: (err) => {
      toast.error("Gagal memperbarui", { description: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSalesRecord,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-admin"] });
      setDeleteModal(false);
      toast.success("Data penjualan berhasil dihapus");
    },
    onError: (err) => {
      toast.error("Gagal menghapus", { description: err.message });
    },
  });

  // ID14: Create mutation
  const createMutation = useMutation({
    mutationFn: createSalesRecord,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-admin"] });
      setCreateModal(false);
      setNewOrder({
        branchId: "",
        channel: "Gofood",
        totalAmount: "",
        customerName: "",
        orderCode: "",
      });
      toast.success("Data penjualan berhasil ditambahkan");
    },
    onError: (err) => {
      toast.error("Gagal menambahkan", { description: err.message });
    },
  });

  // Create modal state
  const [createModal, setCreateModal] = useState(false);
  const [newOrder, setNewOrder] = useState({
    branchId: "",
    channel: "Gofood",
    totalAmount: "",
    customerName: "",
    orderCode: "",
  });

  usePageTitle("Data Penjualan", "Rekap dan kelola data penjualan");

  const columns: Column<SalesRow>[] = [
    {
      key: "createdAt",
      header: "Tanggal",
      sortable: true,
      width: "w-28",
      render: (r) =>
        new Date(r.createdAt).toLocaleDateString("id-ID", {
          day: "2-digit",
          month: "short",
        }),
    },
    { key: "branchName", header: "Cabang", sortable: true, width: "w-28" },
    { key: "orderCode", header: "Kode", width: "w-28" },
    {
      key: "channel",
      header: "Channel",
      width: "w-24",
      sortable: true,
      render: (r) => <Badge variant="outline">{channelLabels[r.channel] ?? r.channel}</Badge>,
    },
    {
      key: "customerName",
      header: "Pelanggan",
      render: (r) => r.customerName ?? "-",
      width: "w-28",
    },
    {
      key: "totalAmount",
      header: "Total",
      align: "right",
      width: "w-28",
      sortable: true,
      render: (r) => formatRupiah(r.totalAmount),
    },
    {
      key: "netSales",
      header: "Net Sales",
      align: "right",
      width: "w-28",
      render: (r) => formatRupiah(r.netSales),
    },
    {
      key: "status",
      header: "Status",
      width: "w-24",
      sortable: true,
      render: (r) => <Badge variant={statusColors[r.status] ?? "default"}>{r.status}</Badge>,
    },
    {
      key: "actions",
      header: "",
      width: "w-20",
      render: (r) => (
        <div className="flex gap-1">
          <button
            onClick={() => {
              setSelectedOrder(r);
              setEditAmount(String(r.totalAmount));
              setEditModal(true);
            }}
            className="h-7 px-2 rounded text-xs border hover:bg-muted transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => {
              setSelectedOrder(r);
              setDeleteModal(true);
            }}
            className="h-7 px-2 rounded text-xs border text-destructive hover:bg-destructive/10 transition-colors"
          >
            Hapus
          </button>
        </div>
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <div className="space-y-4">
        {/* Header with Add button */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Data Penjualan</h2>
          <button
            type="button"
            onClick={() => setCreateModal(true)}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            + Tambah Penjualan
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Dari</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Sampai</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Cabang</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Semua</option>
              {branches?.map((b: { id: string; name: string }) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Semua</option>
              {Object.entries(channelLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <DataTable
          columns={columns}
          data={records ?? []}
          keyExtractor={(r) => r.id}
          pageSize={25}
        />

        {/* Edit Modal */}
        <Modal
          open={editModal}
          onClose={() => setEditModal(false)}
          title="Edit Data Penjualan"
          size="sm"
        >
          <div className="space-y-4">
            {selectedOrder && (
              <>
                <div className="text-sm text-muted-foreground">
                  Order: {selectedOrder.orderCode ?? "-"} · {selectedOrder.branchName} ·{" "}
                  {channelLabels[selectedOrder.channel]}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Total Amount (Rp)</label>
                  <input
                    type="number"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setEditModal(false)}
                    className="h-9 px-4 rounded-md border text-sm"
                  >
                    Batal
                  </button>
                  <button
                    onClick={() => {
                      if (!selectedOrder || !editAmount) return;
                      void updateMutation.mutateAsync({
                        data: {
                          id: selectedOrder.id,
                          totalAmount: Number(editAmount),
                        },
                      });
                    }}
                    disabled={updateMutation.isPending}
                    className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                  >
                    {updateMutation.isPending ? "Menyimpan..." : "Simpan"}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>

        {/* Delete Confirmation Modal */}
        <Modal
          open={deleteModal}
          onClose={() => setDeleteModal(false)}
          title="Hapus Data Penjualan"
          size="sm"
        >
          <div className="space-y-4">
            {selectedOrder && (
              <>
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Order {selectedOrder.orderCode ?? "-"} ({selectedOrder.branchName}) akan
                    di-void.
                    {selectedOrder.totalAmount > 0 &&
                      ` Nilai: ${formatRupiah(selectedOrder.totalAmount)}`}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Area Manager dan Branch Admin cabang ini akan mendapat notifikasi.
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setDeleteModal(false)}
                    className="h-9 px-4 rounded-md border text-sm"
                  >
                    Batal
                  </button>
                  <button
                    onClick={() => {
                      if (!selectedOrder) return;
                      void deleteMutation.mutateAsync({ data: { id: selectedOrder.id } });
                    }}
                    disabled={deleteMutation.isPending}
                    className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
                  >
                    {deleteMutation.isPending ? "Menghapus..." : "Hapus"}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>

        {/* Create Modal */}
        <Modal
          open={createModal}
          onClose={() => setCreateModal(false)}
          title="Tambah Data Penjualan"
          size="sm"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cabang</label>
              <select
                value={newOrder.branchId}
                onChange={(e) => setNewOrder({ ...newOrder, branchId: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Pilih cabang</option>
                {branches?.map((b: { id: string; name: string }) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Channel</label>
              <select
                value={newOrder.channel}
                onChange={(e) => setNewOrder({ ...newOrder, channel: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {Object.entries(channelLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Total Amount (Rp)</label>
              <MoneyInput
                value={newOrder.totalAmount ? Number(newOrder.totalAmount) : null}
                onChange={(raw) =>
                  setNewOrder({ ...newOrder, totalAmount: raw === null ? "" : String(raw) })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Kode Order (opsional)</label>
              <input
                type="text"
                value={newOrder.orderCode}
                onChange={(e) => setNewOrder({ ...newOrder, orderCode: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Pelanggan (opsional)</label>
              <input
                type="text"
                value={newOrder.customerName}
                onChange={(e) => setNewOrder({ ...newOrder, customerName: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setCreateModal(false)}
                className="h-9 px-4 rounded-md border text-sm"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  if (!newOrder.branchId || !newOrder.totalAmount) return;
                  void createMutation.mutateAsync({
                    data: {
                      branchId: newOrder.branchId,
                      channel: newOrder.channel as
                        | "Gofood"
                        | "Grabfood"
                        | "ShopeeFood"
                        | "Dine-in"
                        | "TikTok",
                      totalAmount: Number(newOrder.totalAmount),
                      customerName: newOrder.customerName || undefined,
                      orderCode: newOrder.orderCode || undefined,
                    },
                  });
                }}
                disabled={createMutation.isPending || !newOrder.branchId || !newOrder.totalAmount}
                className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
              >
                {createMutation.isPending ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </RoleGuard>
  );
}
