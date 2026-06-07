import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { Button } from "#/components/ui/button";
import { getVouchers, createVoucher, updateVoucher, deleteVoucher } from "#/lib/server/vouchers";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Trash2, AlertTriangle } from "lucide-react";

interface VoucherRow {
  id: string;
  code: string;
  description: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minOrder: number;
  validUntil: Date;
  isActive: boolean;
}

const columns: Column<VoucherRow>[] = [
  { key: "code", header: "Kode", sortable: true },
  { key: "description", header: "Deskripsi", sortable: true },
  {
    key: "discountType",
    header: "Tipe",
    sortable: true,
    render: (r) => <Badge variant="outline">{r.discountType === "percentage" ? "%" : "Rp"}</Badge>,
  },
  {
    key: "discountValue",
    header: "Nilai",
    align: "right",
    sortable: true,
    render: (r) =>
      r.discountType === "percentage"
        ? `${r.discountValue}%`
        : `Rp ${r.discountValue.toLocaleString("id-ID")}`,
  },
  {
    key: "minOrder",
    header: "Min. Order",
    align: "right",
    sortable: true,
    render: (r) => `Rp ${r.minOrder.toLocaleString("id-ID")}`,
  },
  {
    key: "isActive",
    header: "Status",
    sortable: true,
    render: (r) => (
      <Badge variant={r.isActive ? "success" : "secondary"}>
        {r.isActive ? "Aktif" : "Nonaktif"}
      </Badge>
    ),
  },
];

export const Route = createFileRoute("/_layout/admin/vouchers")({
  component: VouchersPage,
  loader: async () => {
    const vouchers = await getVouchers({ data: {} });
    return { vouchers };
  },
});

function VouchersPage() {
  const { vouchers: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<VoucherRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VoucherRow | null>(null);

  const { data: vouchers } = useQuery({
    queryKey: ["vouchers"],
    queryFn: () => getVouchers({ data: {} }),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createVoucher,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      setModalOpen(false);
      setEditing(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateVoucher,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      setModalOpen(false);
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteVoucher,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      setDeleteTarget(null);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const validUntil = fd.get("validUntil") as string;
    const rawCode = fd.get("code");
    const data = {
      code: rawCode ? (rawCode as string).toUpperCase() : (editing?.code ?? ""),
      description: fd.get("description") as string,
      discountType: fd.get("discountType") as "percentage" | "fixed",
      discountValue: Number(fd.get("discountValue")),
      minOrder: Number(fd.get("minOrder")),
      validUntil: new Date(validUntil).toISOString(),
    };
    if (editing) {
      void updateMutation.mutateAsync({ data: { id: editing.id, ...data } });
    } else {
      void createMutation.mutateAsync({ data });
    }
  };
  usePageTitle("Manajemen Voucher", "Buat & kelola voucher promo untuk semua cabang");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <PageHeader action={{ label: "Tambah Voucher", onClick: () => setModalOpen(true) }} />

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
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                title="Nonaktifkan"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ),
          },
        ]}
        data={vouchers}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => {
          setEditing(r);
          setModalOpen(true);
        }}
      />

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        title={editing ? "Edit Voucher" : "Tambah Voucher"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Kode</label>
            <input
              name="code"
              defaultValue={editing?.code ?? ""}
              required={!editing}
              disabled={!!editing}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm uppercase disabled:opacity-50"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Deskripsi</label>
            <input
              name="description"
              defaultValue={editing?.description ?? ""}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipe Diskon</label>
              <select
                name="discountType"
                defaultValue={editing?.discountType ?? "percentage"}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="percentage">Persentase (%)</option>
                <option value="fixed">Nominal (Rp)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Nilai Diskon</label>
              <input
                name="discountValue"
                type="number"
                min={0}
                defaultValue={editing?.discountValue ?? ""}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Min. Order (Rp)</label>
              <input
                name="minOrder"
                type="number"
                min={0}
                defaultValue={editing?.minOrder ?? 0}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Berlaku Sampai</label>
              <input
                name="validUntil"
                type="datetime-local"
                defaultValue={editing ? new Date(editing.validUntil).toISOString().slice(0, 16) : ""}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setModalOpen(false);
                setEditing(null);
              }}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
            >
              {editing ? "Simpan" : "Tambah"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation modal */}
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
                  Voucher yang dinonaktifkan tidak dapat digunakan pada pesanan baru, tetapi data historis tetap tersimpan.
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
                  void deleteMutation.mutateAsync({ data: { id: deleteTarget.id } })
                }
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
