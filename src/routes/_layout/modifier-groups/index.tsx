import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getModifierGroups, createModifierGroup } from "#/lib/server/modifier-groups";
import type { Column } from "#/components/ui/DataTable";

interface MGRow {
  id: string;
  code: string;
  name: string;
  minSelection: number;
  maxSelection: number;
  modifiers: { id: string; name: string; price: number; isExclusion: boolean }[];
}

const columns: Column<MGRow>[] = [
  { key: "code", header: "Kode", width: "w-24" },
  { key: "name", header: "Nama Group" },
  { key: "minSelection", header: "Min", width: "w-16", align: "center" },
  { key: "maxSelection", header: "Max", width: "w-16", align: "center" },
  {
    key: "modifiers",
    header: "Jumlah Modifier",
    width: "w-28",
    align: "center",
    render: (r) => r.modifiers.length,
  },
];

export const Route = createFileRoute("/_layout/modifier-groups/")({
  component: ModifierGroupsPage,
  loader: async () => {
    const groups = await getModifierGroups({ data: {} });
    return { groups };
  },
});

function ModifierGroupsPage() {
  const { groups: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const { data: groups } = useQuery({
    queryKey: ["modifier-groups"],
    queryFn: () => getModifierGroups({ data: {} }),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createModifierGroup,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["modifier-groups"] });
      setModalOpen(false);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      code: fd.get("code") as string,
      name: fd.get("name") as string,
      minSelection: Number(fd.get("minSelection")),
      maxSelection: Number(fd.get("maxSelection")),
      modifiers: [
        {
          name: fd.get("modName") as string,
          price: Number(fd.get("modPrice")),
          isExclusion: false,
        },
      ],
    };
    void createMutation.mutateAsync({ data });
  };
  usePageTitle("Modifier Groups", "Kelola grup modifier & add-ons menu");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <PageHeader action={{ label: "Tambah Group", onClick: () => setModalOpen(true) }} />

      <DataTable columns={columns} data={groups} keyExtractor={(r) => r.id} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Tambah Modifier Group">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Kode</label>
              <input
                name="code"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Nama</label>
              <input
                name="name"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Min Pilihan</label>
              <input
                name="minSelection"
                type="number"
                min={0}
                defaultValue={0}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Max Pilihan</label>
              <input
                name="maxSelection"
                type="number"
                min={1}
                defaultValue={1}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-sm font-medium">Modifier Pertama</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Nama</label>
                <input
                  name="modName"
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Harga Tambahan</label>
                <input
                  name="modPrice"
                  type="number"
                  min={0}
                  defaultValue={0}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
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
