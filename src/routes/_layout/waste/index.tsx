import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getWasteEntries, createWasteEntry } from "#/lib/server/waste";
import { getIngredients } from "#/lib/server/ingredients";
import { getBranches } from "#/lib/server/branches";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";

interface WasteRow {
  id: string;
  createdAt: Date;
  ingredientName: string | null;
  ingredientCode: string | null;
  quantity: number;
  category: "Beban Makan" | "Biaya Operasional" | "Spoiled";
  notes: string | null;
  branchName: string | null;
}

const catColors: Record<string, "default" | "warning" | "destructive"> = {
  "Beban Makan": "default",
  "Biaya Operasional": "warning",
  Spoiled: "destructive",
};

const columns: Column<WasteRow>[] = [
  {
    key: "createdAt",
    header: "Waktu",
    width: "w-36",
    render: (r) =>
      new Date(r.createdAt).toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
  },
  { key: "ingredientName", header: "Bahan" },
  {
    key: "category",
    header: "Kategori",
    render: (r) => <Badge variant={catColors[r.category]}>{r.category}</Badge>,
  },
  {
    key: "quantity",
    header: "Qty",
    align: "right",
    width: "w-20",
    render: (r) => r.quantity.toLocaleString("id-ID"),
  },
  { key: "notes", header: "Keterangan", render: (r) => r.notes ?? "-" },
];

export const Route = createFileRoute("/_layout/waste/")({
  component: WastePage,
  loader: async () => {
    const entries = await getWasteEntries({ data: {} });
    const ingredients = await getIngredients({ data: {} });
    const branches = await getBranches({ data: {} });
    return { entries, ingredients, branches };
  },
});

function WastePage() {
  const { user } = useAuth();
  const { entries: initial, ingredients, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const { data: entries } = useQuery({
    queryKey: ["waste-entries"],
    queryFn: () => getWasteEntries({ data: {} }),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createWasteEntry,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["waste-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setModalOpen(false);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      branchId: fd.get("branchId") as string,
      ingredientId: fd.get("ingredientId") as string,
      quantity: Number(fd.get("quantity")),
      category: fd.get("category") as "Beban Makan" | "Biaya Operasional" | "Spoiled",
      notes: (fd.get("notes") as string) || undefined,
    };
    void createMutation.mutateAsync({ data });
  };
  usePageTitle("Waste", "Pencatatan barang rusak, jatah makan, dan spoiled");

  return (
    <RoleGuard
      allowedRoles={[
        "super_admin",
        "admin_pusat",
        "area_manager",
        "branch_admin",
        "central_kitchen",
      ]}
    >
      <PageHeader action={{ label: "Input Waste", onClick: () => setModalOpen(true) }} />

      <DataTable columns={columns} data={entries} keyExtractor={(r) => r.id} pageSize={15} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Input Waste" size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Cabang</label>
            <select
              name="branchId"
              defaultValue={user?.branchId ?? ""}
              disabled={!!user?.branchId}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Bahan</label>
            <select
              name="ingredientId"
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Pilih bahan...</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.stockUnit})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Kategori</label>
              <select
                name="category"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Beban Makan">Beban Makan (Jatah karyawan)</option>
                <option value="Biaya Operasional">Biaya Operasional</option>
                <option value="Spoiled">Spoiled (Basi/Hancur)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Jumlah</label>
              <input
                name="quantity"
                type="number"
                min={1}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Keterangan</label>
            <textarea
              name="notes"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none"
            />
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
              Simpan
            </button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
