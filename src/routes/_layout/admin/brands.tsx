import { createFileRoute } from "@tanstack/react-router";
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
import { Button } from "#/components/ui/button";
import { getBrands, createBrand, updateBrand, deleteBrand } from "#/lib/server/brands";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "#/components/ui/badge";
import { Trash2, AlertTriangle } from "lucide-react";

interface BrandRow {
  id: string;
  code: string;
  name: string;
  logo: string | null;
  status: string;
}

const columns: ColumnDef<BrandRow>[] = [
  { accessorKey: "code", header: "Kode", width: "w-24", enableSorting: true },
  { accessorKey: "name", header: "Nama Brand", enableSorting: true },
  {
    accessorKey: "status",
    header: "Status",
    width: "w-20",
    enableSorting: true,
    cell: (r) =>
      r.status === "Active" ? (
        <Badge variant="success">Aktif</Badge>
      ) : (
        <Badge variant="secondary">Nonaktif</Badge>
      ),
  },
];

export const Route = createFileRoute("/_layout/admin/brands")({
  component: BrandsPage,
  loader: async () => {
    const brands = await getBrands({ data: {} });
    return { brands };
  },
});

function BrandsPage() {
  const [search, setSearch, committedSearch] = useTableSearch({ debounceMs: 250 });
  const { page, setPage, sort, setSort } = useTableUrlState();
  const { brands: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BrandRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrandRow | null>(null);

  const { data: brands } = useQuery({
    queryKey: ["brands", committedSearch],
    queryFn: () => getBrands({ data: { search: committedSearch || undefined } }),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createBrand,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["brands"] });
      setModalOpen(false);
      setEditing(null);
      toast.success("Merek berhasil ditambahkan");
    },
    onError: (error: Error) => {
      toast.error("Gagal menambah merek", { description: error.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateBrand,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["brands"] });
      setModalOpen(false);
      setEditing(null);
      toast.success("Merek berhasil diperbarui");
    },
    onError: (error: Error) => {
      toast.error("Gagal memperbarui merek", { description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBrand,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["brands"] });
      setDeleteTarget(null);
      toast.success("Merek berhasil dinonaktifkan");
    },
    onError: (error: Error) => {
      toast.error("Gagal menonaktifkan merek", { description: error.message });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      code: formText(fd, "code"),
      name: formText(fd, "name"),
    };
    if (editing) {
      void updateMutation.mutateAsync({ data: { id: editing.id, ...data } });
    } else {
      void createMutation.mutateAsync({ data });
    }
  };
  usePageTitle("Manajemen Merek", "Kelola merek menu");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <PageHeader
        action={{
          label: "Tambah Merek",
          onClick: () => {
            setEditing(null);
            setModalOpen(true);
          },
        }}
      />

      <DataTable
        columns={[
          ...columns,
          {
            accessorKey: "actions",
            header: "",
            width: "w-12",
            cell: (r) => (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(r);
                }}
                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                title="Nonaktifkan"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ),
          },
        ]}
        data={brands}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => {
          setEditing(r);
          setModalOpen(true);
        }}
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
        title={editing ? "Edit Merek" : "Tambah Merek"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Kode</label>
            <input
              name="code"
              defaultValue={editing?.code ?? ""}
              required
              className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Nama</label>
            <input
              name="name"
              defaultValue={editing?.name ?? ""}
              required
              className="h-10 md:h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="h-10 md:h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              className="h-10 md:h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
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
        title="Nonaktifkan Merek"
        size="sm"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Nonaktifkan merek "{deleteTarget.name}"?</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Merek yang dinonaktifkan tidak akan muncul di menu, tetapi data historis tetap
                  tersimpan.
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
