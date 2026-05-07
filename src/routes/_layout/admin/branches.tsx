import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getBranches, createBranch, updateBranch } from "#/lib/server/branches";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";

interface BranchRow {
  id: string;
  code: string;
  name: string;
  location: string;
  type: "Central" | "Outlet";
  active: boolean;
  isOnline: boolean;
}

const columns: Column<BranchRow>[] = [
  { key: "code", header: "Kode", width: "w-24", sortable: true },
  { key: "name", header: "Nama Cabang", sortable: true },
  { key: "location", header: "Lokasi", sortable: true },
  {
    key: "type",
    header: "Tipe",
    width: "w-24",
    sortable: true,
    render: (r) => <Badge variant={r.type === "Central" ? "default" : "secondary"}>{r.type}</Badge>,
  },
  {
    key: "active",
    header: "Status",
    width: "w-20",
    sortable: true,
    render: (r) =>
      r.active ? (
        <Badge variant="success">Aktif</Badge>
      ) : (
        <Badge variant="secondary">Nonaktif</Badge>
      ),
  },
];

export const Route = createFileRoute("/_layout/admin/branches")({
  component: BranchesPage,
  loader: async () => {
    const branches = await getBranches({ data: {} });
    return { branches };
  },
});

function BranchesPage() {
  const { branches: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BranchRow | null>(null);

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ data: {} }),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createBranch,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["branches"] });
      setModalOpen(false);
      setEditing(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateBranch,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["branches"] });
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
      location: fd.get("location") as string,
      type: fd.get("type") as "Central" | "Outlet",
    };

    if (editing) {
      void updateMutation.mutateAsync({ data: { id: editing.id, ...data } });
    } else {
      void createMutation.mutateAsync({ data });
    }
  };
  usePageTitle("Manajemen Cabang", "Kelola cabang dan gudang pusat");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <PageHeader
        action={{
          label: "Tambah Cabang",
          onClick: () => {
            setEditing(null);
            setModalOpen(true);
          },
        }}
      />

      <DataTable
        columns={columns}
        data={branches}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => {
          setEditing(r);
          setModalOpen(true);
        }}
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit Cabang" : "Tambah Cabang"}
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
          <div className="space-y-2">
            <label className="text-sm font-medium">Lokasi</label>
            <input
              name="location"
              defaultValue={editing?.location ?? ""}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Tipe</label>
            <select
              name="type"
              defaultValue={editing?.type ?? "Outlet"}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="Central">Central</option>
              <option value="Outlet">Outlet</option>
            </select>
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
