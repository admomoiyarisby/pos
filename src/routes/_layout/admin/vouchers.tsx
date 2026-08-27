import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { formText, formatJakartaDateTime } from "#/lib/utils";
import { voucherActionForStatus } from "#/lib/voucher-lifecycle";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import MoneyInput from "#/components/MoneyInput";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import { toast } from "sonner";
import { Trash2, AlertTriangle, Search, X, Plus, Ticket, Tag, Clock } from "lucide-react";
import {
  getVouchers,
  createVoucher,
  updateVoucher,
  deactivateVoucher,
  deleteVoucher,
} from "#/lib/server/vouchers";
import type { ColumnDef } from "@tanstack/react-table";

interface VoucherRow {
  id: string;
  code: string;
  description: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minOrder: number;
  validUntil: Date | string;
  status: "Active" | "Inactive" | "Deleted";
  createdAt: Date | string;
}

/** Convert a Date (or ISO string) to the value expected by <input type="datetime-local"> (local wall-clock). */
function toLocalInputValue(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Convert a datetime-local string (interpreted as local time) to an ISO-8601 UTC string for the server schema. */
function fromLocalInputValue(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error("Tanggal berlaku sampai tidak valid");
  return d.toISOString();
}

function formatDiscount(r: VoucherRow): string {
  return r.discountType === "percentage"
    ? `${r.discountValue}%`
    : `Rp ${r.discountValue.toLocaleString("id-ID")}`;
}

type VoucherStatusBadge = {
  label: string;
  variant: "success" | "warning" | "secondary" | "destructive";
};

function voucherStatus(r: VoucherRow): VoucherStatusBadge {
  if (r.status === "Inactive") return { label: "Nonaktif", variant: "secondary" };
  if (r.status === "Deleted") return { label: "Deleted", variant: "destructive" };
  if (new Date(r.validUntil).getTime() < Date.now())
    return { label: "Kadaluarsa", variant: "warning" };
  return { label: "Aktif", variant: "success" };
}

const columns: ColumnDef<VoucherRow>[] = [
  { accessorKey: "code", header: "Kode", width: "w-32", enableSorting: true },
  { accessorKey: "description", header: "Deskripsi", enableSorting: true },
  {
    accessorKey: "discountValue",
    header: "Diskon",
    width: "w-28",
    enableSorting: true,
    cell: ({ row }) => formatDiscount(row.original),
  },
  {
    accessorKey: "minOrder",
    header: "Min. Order",
    width: "w-32",
    align: "right",
    enableSorting: true,
    cell: ({ row }) =>
      row.original.minOrder > 0 ? `Rp ${row.original.minOrder.toLocaleString("id-ID")}` : "-",
  },
  {
    accessorKey: "validUntil",
    header: "Berlaku Sampai",
    width: "w-40",
    enableSorting: true,
    cell: ({ row }) => (
      <span className="tabular-nums">{formatJakartaDateTime(row.original.validUntil)}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    width: "w-24",
    enableSorting: true,
    cell: ({ row }) => {
      const s = voucherStatus(row.original);
      return <Badge variant={s.variant}>{s.label}</Badge>;
    },
  },
];

export const Route = createFileRoute("/_layout/admin/vouchers")({
  component: VouchersPage,
  loader: async () => {
    const vouchers = await getVouchers({ data: {} });
    // SAFETY: the server row type is assignable to VoucherRow (its timestamps
    // are Date, covered by the Date | string union here).
    return { vouchers: vouchers as VoucherRow[] };
  },
});

function VouchersPage() {
  const [search, setSearch, committedSearch] = useTableSearch({ debounceMs: 250 });
  const { page, setPage, sort, setSort } = useTableUrlState();
  const { vouchers: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<VoucherRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VoucherRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [discountType, setDiscountType] = useState<VoucherRow["discountType"]>("percentage");

  const { data: vouchers } = useQuery({
    queryKey: ["vouchers", committedSearch],
    // SAFETY: server rows are assignable to VoucherRow (Date timestamps are
    // covered by the Date | string union).
    queryFn: () =>
      getVouchers({ data: { search: committedSearch || undefined } }) as Promise<VoucherRow[]>,
    initialData: initial,
  });

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setDiscountType("percentage");
    setModalOpen(true);
  };

  const openEdit = (r: VoucherRow) => {
    setEditing(r);
    setFormError(null);
    setDiscountType(r.discountType);
    setModalOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: createVoucher,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      setModalOpen(false);
      toast.success("Voucher berhasil ditambahkan");
    },
    onError: (error: Error) => {
      setFormError(error.message);
      toast.error("Gagal menambah voucher", { description: error.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateVoucher,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      setModalOpen(false);
      toast.success("Voucher berhasil diperbarui");
    },
    onError: (error: Error) => {
      setFormError(error.message);
      toast.error("Gagal memperbarui voucher", { description: error.message });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivateVoucher,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      setDeleteTarget(null);
      toast.success("Voucher berhasil dinonaktifkan");
    },
    onError: (error: Error) => {
      toast.error("Gagal menonaktifkan voucher", { description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteVoucher,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      setDeleteTarget(null);
      toast.success("Voucher berhasil dihapus");
    },
    onError: (error: Error) => {
      toast.error("Gagal menghapus voucher", { description: error.message });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const fd = new FormData(e.currentTarget);
    const code = formText(fd, "code").trim().toUpperCase();
    const description = formText(fd, "description").trim();
    const discountType = z.enum(["percentage", "fixed"]).parse(formText(fd, "discountType"));
    const discountValue = Number(formText(fd, "discountValue"));
    const minOrder = Number(formText(fd, "minOrder") || 0);
    const validUntilRaw = formText(fd, "validUntil").trim();
    const isActive = fd.get("isActive") === "on";

    if (!code) return setFormError("Kode voucher wajib diisi");
    if (!description) return setFormError("Deskripsi wajib diisi");
    if (!validUntilRaw) return setFormError("Tanggal berlaku sampai wajib diisi");
    if (Number.isNaN(discountValue) || discountValue < 0)
      return setFormError("Nilai diskon harus berupa angka ≥ 0");
    if (discountType === "percentage" && discountValue > 100)
      return setFormError("Diskon persen maksimal 100");

    let validUntil: string;
    try {
      validUntil = fromLocalInputValue(validUntilRaw);
    } catch {
      return setFormError("Tanggal berlaku sampai tidak valid");
    }

    const payload = {
      code,
      description,
      discountType,
      discountValue,
      minOrder,
      validUntil,
      isActive,
    };

    if (editing) {
      void updateMutation.mutateAsync({ data: { id: editing.id, ...payload } });
    } else {
      void createMutation.mutateAsync({ data: payload });
    }
  };

  const [statusFilter, setStatusFilter] = useState<"all" | "Active" | "Inactive" | "expired">(
    "all",
  );
  const displayRows = useMemo(() => {
    const base = vouchers ?? [];
    if (statusFilter === "all") return base;
    if (statusFilter === "expired")
      return base.filter(
        (r) => new Date(r.validUntil).getTime() < Date.now() && r.status === "Active",
      );
    return base.filter((r) => r.status === statusFilter);
  }, [vouchers, statusFilter]);
  const totalPages = Math.ceil(displayRows.length / 15) || 1;
  const pagedRows = useMemo(
    () => displayRows.slice(page * 15, (page + 1) * 15),
    [displayRows, page],
  );
  const hasActiveFilters = !!search.trim() || statusFilter !== "all";

  usePageTitle("Manajemen Voucher", "Kelola kode promo dan diskon pesanan");

  const pending = createMutation.isPending || updateMutation.isPending;

  // SAFETY: tableColumns are validated VoucherRow ColumnDefs — action column augmentation.
  const tableColumns = [
    ...columns,
    {
      accessorKey: "actions",
      header: "",
      width: "w-12",
      // SAFETY: tableColumns are validated VoucherRow ColumnDefs — action column is a known augmentation.
      cell: ({ row }: { row: { original: VoucherRow } }) => {
        const action = voucherActionForStatus(row.original.status);
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(row.original);
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title={action === "deactivate" ? "Nonaktifkan" : "Hapus"}
            disabled={action === null}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        );
      },
    },

    // SAFETY: tableColumns are validated VoucherRow ColumnDefs — action column augmentation.
  ] as ColumnDef<VoucherRow>[];

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      {/* ── Toolbar: search + action (mobile-first) ── */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-[380px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              aria-label="Cari voucher"
              placeholder="Cari kode, deskripsi…"
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
          <Button
            onClick={openCreate}
            className="w-full sm:w-auto sm:ml-auto h-11 sm:h-9 rounded-xl sm:rounded-md shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Tambah Voucher
          </Button>
        </div>
        {/* Status pills — edge bleed on mobile */}
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 snap-x snap-mandatory">
          {(
            [
              ["all", "Semua"],
              ["Active", "Aktif"],
              ["Inactive", "Nonaktif"],
              ["expired", "Kadaluarsa"],
            ] as const
          ).map(([key, label]) => {
            const active = statusFilter === key;
            return (
              <button
                key={key}
                onClick={() => {
                  setStatusFilter(key);
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
            {displayRows.length} voucher • Hal {page + 1}/{totalPages}
          </span>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
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
              <Ticket className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium">
              {hasActiveFilters ? "Tidak ada hasil" : "Belum ada voucher"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {hasActiveFilters
                ? `Tidak ada voucher untuk "${search}".`
                : "Tambah voucher pertama."}
            </p>
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setPage(0);
                }}
              >
                Reset
              </Button>
            )}
          </div>
        ) : (
          pagedRows.map((r) => {
            const s = voucherStatus(r);
            const isExpired =
              new Date(r.validUntil).getTime() < Date.now() && r.status === "Active";
            return (
              <div
                key={r.id}
                onClick={() => openEdit(r)}
                className="rounded-xl border bg-card p-3.5 shadow-xs active:scale-[0.99] transition-transform cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm font-semibold tracking-tight truncate">
                      {r.code}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {r.description}
                    </div>
                  </div>
                  <Badge variant={s.variant} className="shrink-0 rounded-full text-[11px] h-5">
                    {s.label}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1.5 text-xs">
                  <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                    <div className="text-[10px] tracking-widest uppercase text-muted-foreground font-medium flex items-center justify-center gap-1">
                      <Tag className="h-3 w-3" />
                      Diskon
                    </div>
                    <div className="font-mono font-semibold mt-0.5">{formatDiscount(r)}</div>
                  </div>
                  <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                    <div className="text-[10px] tracking-widest uppercase text-muted-foreground font-medium">
                      Min Order
                    </div>
                    <div className="font-mono font-medium mt-0.5 truncate">
                      {r.minOrder > 0 ? `Rp ${r.minOrder.toLocaleString("id-ID")}` : "—"}
                    </div>
                  </div>
                  <div
                    className={`rounded-lg px-2 py-2 text-center ${isExpired ? "bg-warning/15 border border-warning/30" : "bg-muted/40"}`}
                  >
                    <div className="text-[10px] tracking-widest uppercase text-muted-foreground font-medium flex items-center justify-center gap-1">
                      <Clock className="h-3 w-3" />
                      Sampai
                    </div>
                    <div className="font-mono text-xs mt-0.5 tabular-nums truncate">
                      {formatJakartaDateTime(r.validUntil)}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {new Date(r.createdAt).toLocaleDateString("id-ID", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-primary font-medium">Edit</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(r);
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-destructive hover:bg-destructive/10 ml-1"
                      title={
                        voucherActionForStatus(r.status) === "deactivate" ? "Nonaktifkan" : "Hapus"
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
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
          columns={tableColumns}
          data={displayRows}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => openEdit(r)}
          searchable={false}
          page={page}
          onPageChange={setPage}
          sort={sort}
          onSortChange={setSort}
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit Voucher" : "Tambah Voucher"}
        size="md"
      >
        <form key={editing?.id ?? "new"} onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Kode <span className="text-destructive">*</span>
            </label>
            <input
              name="code"
              defaultValue={editing?.code ?? ""}
              required
              maxLength={50}
              placeholder="PROMO10"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono uppercase tracking-wide"
            />
            <p className="text-xs text-muted-foreground">Unik. Huruf besar otomatis.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Deskripsi <span className="text-destructive">*</span>
            </label>
            <input
              name="description"
              defaultValue={editing?.description ?? ""}
              required
              maxLength={200}
              placeholder="Diskon akhir pekan"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipe Diskon</label>
              <select
                name="discountType"
                value={discountType}
                onChange={(e) =>
                  setDiscountType(e.target.value === "fixed" ? "fixed" : "percentage")
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="percentage">Persen (%)</option>
                <option value="fixed">Nominal (Rp)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Nilai Diskon <span className="text-destructive">*</span>
              </label>
              {discountType === "fixed" ? (
                <MoneyInput
                  key={editing?.id ?? "new-discount"}
                  name="discountValue"
                  defaultValue={editing?.discountValue ?? 0}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              ) : (
                <input
                  key={editing?.id ?? "new-discount-num"}
                  name="discountValue"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={editing?.discountValue ?? 0}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Min. Order (Rp)</label>
            <MoneyInput
              key={editing?.id ? `${editing.id}-minOrder` : "new-minOrder"}
              name="minOrder"
              defaultValue={editing?.minOrder ?? 0}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Berlaku Sampai <span className="text-destructive">*</span>
            </label>
            <input
              name="validUntil"
              type="datetime-local"
              defaultValue={toLocalInputValue(editing?.validUntil)}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={editing ? editing.status === "Active" : true}
              className="h-4 w-4 rounded border-input"
            />
            Voucher aktif
          </label>

          {formError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Menyimpan..." : editing ? "Simpan" : "Tambah"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget?.status === "Active" ? "Nonaktifkan Voucher" : "Hapus Voucher"}
        size="sm"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  {deleteTarget.status === "Active"
                    ? `Nonaktifkan voucher "${deleteTarget.code}"?`
                    : `Hapus voucher "${deleteTarget.code}"?`}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {deleteTarget.status === "Active"
                    ? "Voucher yang dinonaktifkan tidak dapat digunakan pada pesanan baru, namun masih dapat diaktifkan kembali."
                    : "Voucher akan dihapus dari daftar dan POS. Riwayat voucher tetap tersimpan untuk audit."}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
                Batal
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  deleteTarget.status === "Active"
                    ? void deactivateMutation.mutateAsync({ data: { id: deleteTarget.id } })
                    : void deleteMutation.mutateAsync({ data: { id: deleteTarget.id } })
                }
                disabled={deactivateMutation.isPending || deleteMutation.isPending}
              >
                {deactivateMutation.isPending || deleteMutation.isPending
                  ? "Memproses..."
                  : deleteTarget.status === "Active"
                    ? "Nonaktifkan"
                    : "Hapus"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </RoleGuard>
  );
}
