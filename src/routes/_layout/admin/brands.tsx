import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getBrands, createBrand, updateBrand } from "#/lib/server/brands";
import type { Column } from "#/components/ui/DataTable";

interface BrandRow {
  id: string;
  code: string;
  name: string;
  logo: string | null;
}

const columns: Column<BrandRow>[] = [
  { key: "code", header: "Kode", width: "w-24", sortable: true },
  { key: "name", header: "Nama Brand", sortable: true },
];

export const Route = createFileRoute("/_layout/admin/brands")({
  component: BrandsPage,
  loader: async () => {
    const brands = await getBrands({ data: {} });
    return { brands };
  },
});

function BrandsPage() {
  const { brands: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BrandRow | null>(null);

  const { data: brands } = useQuery({
    queryKey: ["brands"],
    queryFn: () => getBrands({ data: {} }),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createBrand,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["brands"] });
      setModalOpen(false);
      setEditing(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateBrand,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["brands"] });
      setModalOpen(false);
      setEditing(null);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      code: fd.get("code") as string,
      name: fd.get("name") as string,
    };
    if (editing) {
      void updateMutation.mutateAsync({ data: { id: editing.id, ...data } });
    } else {
      void createMutation.mutateAsync({ data });
    }
  };
  usePageTitle("Manajemen Brand", "Kelola brand / merek menu");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <PageHeader
        action={{
          label: "Tambah Brand",
          onClick: () => {
            setEditing(null);
            setModalOpen(true);
          },
        }}
      />

      <DataTable
        columns={columns}
        data={brands}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => {
          setEditing(r);
          setModalOpen(true);
        }}
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit Brand" : "Tambah Brand"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Kode</label>
            <input
              name="code"
              defaultValue={editing?.code ?? ""}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Nama</label>
            <input
              name="name"
              defaultValue={editing?.name ?? ""}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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
              {editing ? "Simpan" : "Tambah"}
            </button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
