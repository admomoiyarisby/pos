import { createFileRoute } from "@tanstack/react-router";
import { lookupLabel } from "#/lib/label-lookup";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useState, useMemo } from "react";
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
import { ORDER_CHANNEL_VALUES } from "#/db/schema";
import { getBranches } from "#/lib/server/branches";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "#/components/ui/badge";
import { toast } from "sonner";
import { AlertCircle, Search, X, Plus, Building2, CalendarDays, Tag } from "lucide-react";
import MoneyInput from "#/components/MoneyInput";

export const Route = createFileRoute("/_layout/admin/sales")({
  component: SalesAdminPage,
});

const channelLabels = {
  Gofood: "Gofood",
  Grabfood: "Grabfood",
  ShopeeFood: "ShopeeFood",
  "Dine-in": "Dine-in",
  TikTok: "TikTok",
  Perlengkapan: "Perlengkapan",
} satisfies Record<string, string>;

const statusColors = {
  Completed: "success",
  Processing: "default",
  Void: "destructive",
  "Cancel Requested": "secondary",
} satisfies Record<string, "default" | "success" | "destructive" | "secondary">;

function formatRupiah(value: number): string {
  return `Rp${value.toLocaleString("id-ID")}`;
}

function SalesAdminPage() {
  const [search, setSearch] = useTableSearch();
  const {
    page,
    setPage,
    sort,
    setSort,
    filters: { dateFrom, dateTo, branchId, channel },
    setFilter,
  } = useTableUrlState<{
    dateFrom?: string;
    dateTo?: string;
    branchId?: string;
    channel?: string;
  }>(["dateFrom", "dateTo", "branchId", "channel"]);
  const queryClient = useQueryClient();
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
  const [newOrder, setNewOrder] = useState<{
    branchId: string;
    channel: (typeof ORDER_CHANNEL_VALUES)[number];
    totalAmount: string;
    customerName: string;
    orderCode: string;
  }>({
    branchId: "",
    channel: "Gofood",
    totalAmount: "",
    customerName: "",
    orderCode: "",
  });

  const displayRows = useMemo(() => {
    const base = records ?? [];
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(
      (r) =>
        (r.orderCode ?? "").toLowerCase().includes(q) ||
        (r.customerName ?? "").toLowerCase().includes(q) ||
        (r.branchName ?? "").toLowerCase().includes(q) ||
        r.channel.toLowerCase().includes(q),
    );
  }, [records, search]);
  const totalPages = Math.ceil(displayRows.length / 25) || 1;
  const pagedRows = useMemo(
    () => displayRows.slice(page * 25, (page + 1) * 25),
    [displayRows, page],
  );
  const hasActiveFilters = !!(search.trim() || dateFrom || dateTo || branchId || channel);

  usePageTitle("Data Penjualan", "Rekap dan kelola data penjualan");

  const columns: ColumnDef<SalesRow>[] = [
    {
      accessorKey: "createdAt",
      header: "Tanggal",
      enableSorting: true,
      width: "w-28",
      cell: ({ row }) =>
        new Date(row.original.createdAt).toLocaleDateString("id-ID", {
          day: "2-digit",
          month: "short",
        }),
    },
    { accessorKey: "branchName", header: "Cabang", enableSorting: true, width: "w-28" },
    { accessorKey: "orderCode", header: "Kode", width: "w-28" },
    {
      accessorKey: "channel",
      header: "Channel",
      width: "w-24",
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline">
          {lookupLabel(channelLabels, row.original.channel) ?? row.original.channel}
        </Badge>
      ),
    },
    {
      accessorKey: "customerName",
      header: "Pelanggan",
      cell: ({ row }) => row.original.customerName ?? "-",
      width: "w-28",
    },
    {
      accessorKey: "totalAmount",
      header: "Total",
      align: "right",
      width: "w-28",
      enableSorting: true,
      cell: ({ row }) => formatRupiah(row.original.totalAmount),
    },
    {
      accessorKey: "netSales",
      header: "Net Sales",
      align: "right",
      width: "w-28",
      cell: ({ row }) => formatRupiah(row.original.netSales),
    },
    {
      accessorKey: "status",
      header: "Status",
      width: "w-24",
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={lookupLabel(statusColors, row.original.status) ?? "default"}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: "actions",
      header: "",
      width: "w-20",
      cell: ({ row }) => (
        <div className="flex gap-1">
          <button
            onClick={() => {
              setSelectedOrder(row.original);
              setEditAmount(String(row.original.totalAmount));
              setEditModal(true);
            }}
            className="h-7 px-2 rounded text-xs border hover:bg-muted transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => {
              setSelectedOrder(row.original);
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
        {/* ── Toolbar: search + action (mobile-first) ── */}
        <div className="space-y-3">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="relative flex-1 sm:max-w-[380px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                inputMode="search"
                autoComplete="off"
                aria-label="Cari penjualan"
                placeholder="Cari kode, pelanggan, cabang…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-9 text-[16px] shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:rounded-lg sm:text-sm"
              />
              {search ? (
                <button
                  type="button"
                  aria-label="Hapus pencarian"
                  onClick={() => setSearch("")}
                  className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setCreateModal(true)}
              className="inline-flex items-center justify-center gap-1.5 h-11 sm:h-9 px-4 rounded-xl sm:rounded-md bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:bg-primary/90 active:scale-[0.98] transition-all sm:ml-auto w-full sm:w-auto shrink-0"
            >
              <Plus className="h-4 w-4" />
              Tambah Penjualan
            </button>
          </div>
          {/* Date range + branch */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end sm:flex sm:flex-wrap sm:items-end sm:gap-3">
            <div className="space-y-1 sm:space-y-0">
              <label className="hidden sm:block text-xs font-medium text-muted-foreground">
                Dari
              </label>
              <input
                type="date"
                value={dateFrom ?? ""}
                onChange={(e) => setFilter("dateFrom", e.target.value)}
                aria-label="Dari tanggal"
                className="h-11 sm:h-9 w-full rounded-xl sm:rounded-md border border-input bg-background px-3 text-[15px] sm:text-sm font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <span className="hidden sm:flex items-center justify-center text-muted-foreground text-sm pb-2">
              —
            </span>
            <span className="flex sm:hidden items-center justify-center text-muted-foreground text-sm pb-3">
              —
            </span>
            <div className="space-y-1 sm:space-y-0">
              <label className="hidden sm:block text-xs font-medium text-muted-foreground">
                Sampai
              </label>
              <input
                type="date"
                value={dateTo ?? ""}
                onChange={(e) => setFilter("dateTo", e.target.value)}
                aria-label="Sampai tanggal"
                className="h-11 sm:h-9 w-full rounded-xl sm:rounded-md border border-input bg-background px-3 text-[15px] sm:text-sm font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="hidden sm:block space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Cabang</label>
              <select
                value={branchId ?? ""}
                onChange={(e) => setFilter("branchId", e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[140px]"
              >
                <option value="">Semua Cabang</option>
                {branches?.map((b: { id: string; name: string }) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/* Branch (mobile full-width) + channel pills */}
          <div className="sm:hidden">
            <select
              value={branchId ?? ""}
              onChange={(e) => setFilter("branchId", e.target.value)}
              aria-label="Filter cabang"
              className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-[15px] font-medium shadow-xs"
            >
              <option value="">Semua Cabang</option>
              {branches?.map((b: { id: string; name: string }) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 snap-x snap-mandatory">
            <button
              onClick={() => {
                setFilter("channel", "");
                setPage(0);
              }}
              aria-pressed={!channel}
              className={`shrink-0 snap-start inline-flex items-center h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${!channel ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
            >
              Semua Channel
            </button>
            {Object.entries(channelLabels).map(([key, label]) => {
              const active = channel === key;
              return (
                <button
                  key={key}
                  onClick={() => {
                    setFilter("channel", active ? "" : key);
                    setPage(0);
                  }}
                  aria-pressed={active}
                  className={`shrink-0 snap-start inline-flex items-center h-8 px-3.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${active ? "bg-foreground text-background border-foreground shadow-sm" : "bg-background border-border hover:bg-muted text-foreground"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between sm:hidden text-xs">
            <span className="text-muted-foreground tabular-nums">
              {displayRows.length} transaksi • Hal {page + 1}/{totalPages}
            </span>
            {hasActiveFilters && (
              <button
                onClick={() => {
                  setSearch("");
                  setFilter("dateFrom", "");
                  setFilter("dateTo", "");
                  setFilter("branchId", "");
                  setFilter("channel", "");
                  setPage(0);
                }}
                className="font-medium text-primary hover:underline underline-offset-4"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-2.5 -mx-4 px-4">
          {pagedRows.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Tag className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm font-medium">
                {hasActiveFilters ? "Tidak ada hasil" : "Belum ada penjualan"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {hasActiveFilters
                  ? `Tidak ada penjualan untuk "${search}" atau filter.`
                  : "Tambah penjualan pertama."}
              </p>
              {hasActiveFilters && (
                <button
                  onClick={() => {
                    setSearch("");
                    setFilter("dateFrom", "");
                    setFilter("dateTo", "");
                    setFilter("branchId", "");
                    setFilter("channel", "");
                    setPage(0);
                  }}
                  className="mt-3 inline-flex h-9 px-3 rounded-lg border bg-background text-sm font-medium hover:bg-muted"
                >
                  Reset filter
                </button>
              )}
            </div>
          ) : (
            pagedRows.map((r) => (
              <div key={r.id} className="rounded-xl border bg-card p-3.5 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarDays className="h-3 w-3" />
                      {new Date(r.createdAt).toLocaleDateString("id-ID", {
                        day: "2-digit",
                        month: "short",
                      })}{" "}
                      • <span className="font-mono truncate">{r.orderCode || "—"}</span>
                    </div>
                    <div className="font-medium text-sm truncate mt-1">
                      {r.customerName || "Tanpa nama"}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="text-[11px] h-5">
                        {lookupLabel(channelLabels, r.channel) ?? r.channel}
                      </Badge>
                      <Badge
                        variant={lookupLabel(statusColors, r.status) ?? "default"}
                        className="text-[11px] h-5"
                      >
                        {r.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-sm font-semibold tabular-nums">
                      {formatRupiah(r.totalAmount)}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {formatRupiah(r.netSales)} net
                    </div>
                    <div className="mt-1 flex items-center gap-1 justify-end text-xs text-muted-foreground">
                      <Building2 className="h-3 w-3" />
                      {r.branchName ?? "—"}
                    </div>
                  </div>
                </div>
                <div className="mt-2.5 flex items-center justify-end gap-2 border-t pt-2.5">
                  <button
                    onClick={() => {
                      setSelectedOrder(r);
                      setEditAmount(String(r.totalAmount));
                      setEditModal(true);
                    }}
                    className="inline-flex h-8 px-3 rounded-full border bg-background text-xs font-medium hover:bg-muted"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      setSelectedOrder(r);
                      setDeleteModal(true);
                    }}
                    className="inline-flex h-8 px-3 rounded-full bg-destructive text-destructive-foreground text-xs font-medium hover:bg-destructive/90"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ))
          )}
          {totalPages > 1 && pagedRows.length > 0 && (
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="inline-flex items-center justify-center h-9 px-3 rounded-lg border bg-background text-sm font-medium disabled:opacity-30 hover:bg-muted min-w-[96px]"
              >
                Sebelumnya
              </button>
              <span className="text-xs tabular-nums text-muted-foreground">
                Hal {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="inline-flex items-center justify-center h-9 px-3 rounded-lg border bg-background text-sm font-medium disabled:opacity-30 hover:bg-muted min-w-[96px]"
              >
                Selanjutnya
              </button>
            </div>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block -mx-4 md:mx-0">
          <DataTable
            columns={columns}
            data={displayRows}
            keyExtractor={(r) => r.id}
            pageSize={25}
            searchable={false}
            page={page}
            onPageChange={setPage}
            sort={sort}
            onSortChange={setSort}
          />
        </div>

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
                  {lookupLabel(channelLabels, selectedOrder.channel)}
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
                onChange={(e) =>
                  setNewOrder({
                    ...newOrder,
                    // SAFETY: the channel select only offers the five literal
                    // channel options rendered below.
                    channel: e.target.value as (typeof ORDER_CHANNEL_VALUES)[number],
                  })
                }
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
                      channel: newOrder.channel,
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
