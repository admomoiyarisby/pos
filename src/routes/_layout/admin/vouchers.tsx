import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { formText } from "#/lib/utils";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import MoneyInput from "#/components/MoneyInput";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import { toast } from "sonner";
import { Trash2, AlertTriangle } from "lucide-react";
import { getVouchers, createVoucher, updateVoucher, deleteVoucher } from "#/lib/server/vouchers";
import type { Column } from "#/components/ui/DataTable";

interface VoucherRow {
  id: string;
  code: string;
  description: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minOrder: number;
  validUntil: Date | string;
  isActive: boolean;
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
  variant: "success" | "warning" | "secondary";
};

function voucherStatus(r: VoucherRow): VoucherStatusBadge {
  if (!r.isActive) return { label: "Nonaktif", variant: "secondary" };
  if (new Date(r.validUntil).getTime() < Date.now())
    return { label: "Kadaluarsa", variant: "warning" };
  return { label: "Aktif", variant: "success" };
}

const columns: Column<VoucherRow>[] = [
  { key: "code", header: "Kode", width: "w-32", sortable: true },
  { key: "description", header: "Deskripsi", sortable: true },
  {
    key: "discountValue",
    header: "Diskon",
    width: "w-28",
    sortable: true,
    render: (r) => formatDiscount(r),
  },
  {
    key: "minOrder",
    header: "Min. Order",
    width: "w-32",
    align: "right",
    sortable: true,
    render: (r) => (r.minOrder > 0 ? `Rp ${r.minOrder.toLocaleString("id-ID")}` : "-"),
  },
  {
    key: "validUntil",
    header: "Berlaku Sampai",
    width: "w-40",
    sortable: true,
    render: (r) => (
      <span className="tabular-nums">
        {new Date(r.validUntil).toLocaleString("id-ID", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    width: "w-24",
    sortable: true,
    render: (r) => {
      const s = voucherStatus(r);
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
  const [search, setSearch] = useTableSearch();
  const { page, setPage, sort, setSort } = useTableUrlState();
  const { vouchers: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<VoucherRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VoucherRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [discountType, setDiscountType] = useState<VoucherRow["discountType"]>("percentage");

  const { data: vouchers } = useQuery({
    queryKey: ["vouchers"],
    // SAFETY: server rows are assignable to VoucherRow (Date timestamps are
    // covered by the Date | string union).
    queryFn: () => getVouchers({ data: {} }) as Promise<VoucherRow[]>,
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

  const deleteMutation = useMutation({
    mutationFn: deleteVoucher,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      setDeleteTarget(null);
      toast.success("Voucher berhasil dinonaktifkan");
    },
    onError: (error: Error) => {
      toast.error("Gagal menonaktifkan voucher", { description: error.message });
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

  usePageTitle("Manajemen Voucher", "Kelola kode promo dan diskon pesanan");

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <PageHeader action={{ label: "Tambah Voucher", onClick: openCreate }} />

      <DataTable
        columns={[
          ...columns,
          {
            key: "actions",
            header: "",
            width: "w-12",
            render: (r) => (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(r);
                }}
                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                title="Nonaktifkan"
                disabled={!r.isActive}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ),
          },
        ]}
        data={vouchers}
        keyExtractor={(r) => r.id}
        searchKeys={["code", "description"]}
        onRowClick={(r) => openEdit(r)}
        emptyMessage="Belum ada voucher"
        search={search}
        onSearchChange={setSearch}
        page={page}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
      />

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
              defaultChecked={editing ? editing.isActive : true}
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
        title="Nonaktifkan Voucher"
        size="sm"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Nonaktifkan voucher "{deleteTarget.code}"?</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Voucher yang dinonaktifkan tidak dapat digunakan pada pesanan baru, namun riwayat
                  tetap tersimpan.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
                Batal
              </Button>
              <Button
                variant="destructive"
                onClick={() => void deleteMutation.mutateAsync({ data: { id: deleteTarget.id } })}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Menonaktifkan..." : "Nonaktifkan"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </RoleGuard>
  );
}
