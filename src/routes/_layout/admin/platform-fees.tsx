import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getPlatformFees, updatePlatformFee } from "#/lib/server/platform-fees";
import type { Column } from "#/components/ui/DataTable";

interface FeeRow {
  id: string;
  channel: string;
  feePercentage: number;
  fixedFee: number;
}

const channelLabels: Record<string, string> = {
  Gofood: "Gofood",
  Grabfood: "Grabfood",
  ShopeeFood: "ShopeeFood",
  "Dine-in": "Dine-in / Offline",
};

const columns: Column<FeeRow>[] = [
  {
    key: "channel",
    header: "Channel",
    sortable: true,
    render: (r) => channelLabels[r.channel] ?? r.channel,
  },
  {
    key: "feePercentage",
    header: "MDR (%)",
    align: "right",
    sortable: true,
    render: (r) => `${r.feePercentage}%`,
  },
  {
    key: "fixedFee",
    header: "Biaya Tetap (Rp)",
    align: "right",
    sortable: true,
    render: (r) => `Rp ${r.fixedFee.toLocaleString("id-ID")}`,
  },
];

export const Route = createFileRoute("/_layout/admin/platform-fees")({
  component: PlatformFeesPage,
  loader: async () => {
    const fees = await getPlatformFees();
    return { fees };
  },
});

function PlatformFeesPage() {
  const { fees: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<FeeRow | null>(null);

  const { data: fees } = useQuery({
    queryKey: ["platform-fees"],
    queryFn: () => getPlatformFees(),
    initialData: initial,
  });

  const updateMutation = useMutation({
    mutationFn: updatePlatformFee,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["platform-fees"] });
      setEditing(null);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      id: editing!.id,
      feePercentage: Number(fd.get("feePercentage")),
      fixedFee: Number(fd.get("fixedFee")),
    };
    void updateMutation.mutateAsync({ data });
  };
  usePageTitle("Biaya Platform", "Atur MDR dan biaya tetap per channel");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <DataTable
        columns={columns}
        data={fees}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => setEditing(r)}
      />

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit ${editing ? (channelLabels[editing.channel] ?? editing.channel) : ""}`}
      >
        {editing && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">MDR (%)</label>
              <input
                name="feePercentage"
                type="number"
                min={0}
                max={100}
                defaultValue={editing.feePercentage}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Biaya Tetap (Rp)</label>
              <input
                name="fixedFee"
                type="number"
                min={0}
                defaultValue={editing.fixedFee}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
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
        )}
      </Modal>
    </RoleGuard>
  );
}
