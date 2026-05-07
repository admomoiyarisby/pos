import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getVouchers, createVoucher } from "#/lib/server/vouchers";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";

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
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const validUntil = fd.get("validUntil") as string;
    const data = {
      code: (fd.get("code") as string).toUpperCase(),
      description: fd.get("description") as string,
      discountType: fd.get("discountType") as "percentage" | "fixed",
      discountValue: Number(fd.get("discountValue")),
      minOrder: Number(fd.get("minOrder")),
      validUntil: new Date(validUntil).toISOString(),
    };
    void createMutation.mutateAsync({ data });
  };
  usePageTitle("Manajemen Voucher", "Buat & kelola voucher promo untuk semua cabang");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <PageHeader action={{ label: "Tambah Voucher", onClick: () => setModalOpen(true) }} />

      <DataTable columns={columns} data={vouchers} keyExtractor={(r) => r.id} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Tambah Voucher">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Kode</label>
            <input
              name="code"
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm uppercase"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Deskripsi</label>
            <input
              name="description"
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipe Diskon</label>
              <select
                name="discountType"
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
                defaultValue={0}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Berlaku Sampai</label>
              <input
                name="validUntil"
                type="datetime-local"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
            >
              Tambah
            </button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
