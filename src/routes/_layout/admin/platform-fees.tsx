import { createFileRoute } from "@tanstack/react-router";
import { lookupLabel } from "#/lib/label-lookup";
import { useTableSearch } from "#/hooks/useTableSearch";
import { useTableUrlState } from "#/hooks/useTableUrlState";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { Button } from "#/components/ui/button";
import MoneyInput from "#/components/MoneyInput";
import { getPlatformFees, updatePlatformFee } from "#/lib/server/platform-fees";
import type { ColumnDef } from "@tanstack/react-table";
import { Trash2, Info } from "lucide-react";

interface FeeRow {
  id: string;
  channel: string;
  feePercentage: number;
  fixedFee: number;
}

const channelLabels = {
  Gofood: "Gofood",
  Grabfood: "Grabfood",
  ShopeeFood: "ShopeeFood",
  "Dine-in": "Dine-in / Offline",
  TikTok: "TikTok",
  Perlengkapan: "Perlengkapan",
} satisfies Record<string, string>;

const columns: ColumnDef<FeeRow>[] = [
  {
    accessorKey: "channel",
    header: "Channel",
    enableSorting: true,
    cell: ({ row }) => lookupLabel(channelLabels, row.original.channel) ?? row.original.channel,
  },
  {
    accessorKey: "feePercentage",
    header: "MDR (%)",
    align: "right",
    enableSorting: true,
    cell: ({ row }) => `${row.original.feePercentage}%`,
  },
  {
    accessorKey: "fixedFee",
    header: "Biaya Tetap (Rp)",
    align: "right",
    enableSorting: true,
    cell: ({ row }) => `Rp ${row.original.fixedFee.toLocaleString("id-ID")}`,
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
  const [search, setSearch] = useTableSearch();
  const { page, setPage, sort, setSort } = useTableUrlState();
  const { fees: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<FeeRow | null>(null);
  const [deleteInfoTarget, setDeleteInfoTarget] = useState<string | null>(null);

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
        columns={[
          ...columns,
          {
            accessorKey: "actions",
            header: "",
            width: "w-12",
            cell: () => (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // SAFETY: the action button is rendered inside a table row; closest("tr")
                  // therefore returns the row carrying the platform-fee data attributes.
                  setDeleteInfoTarget(
                    (e.currentTarget.closest("tr") as HTMLTableRowElement | null)?.dataset
                      .channel ?? "",
                  );
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground/40 cursor-not-allowed"
                title="Biaya platform tidak dapat dihapus"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ),
          },
        ]}
        data={fees}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => setEditing(r)}
        search={search}
        onSearchChange={setSearch}
        page={page}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
      />

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit ${editing ? (lookupLabel(channelLabels, editing.channel) ?? editing.channel) : ""}`}
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
              <MoneyInput
                name="fixedFee"
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

      {/* Info modal for delete-not-allowed */}
      <Modal
        open={!!deleteInfoTarget}
        onClose={() => setDeleteInfoTarget(null)}
        title="Tidak Dapat Dihapus"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Biaya platform tidak dapat dihapus.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Setiap channel ({deleteInfoTarget}) membutuhkan konfigurasi biaya platform agar
                perhitungan pendapatan berjalan dengan benar. Anda dapat mengubah nilai MDR dan
                biaya tetap melalui edit.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => setDeleteInfoTarget(null)}>
              Tutup
            </Button>
          </div>
        </div>
      </Modal>
    </RoleGuard>
  );
}
