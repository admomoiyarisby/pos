import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getDeliveryNotes, createDeliveryNote, shipDeliveryNote } from "#/lib/server/scm";
import { getBranches } from "#/lib/server/branches";
import { getIngredients } from "#/lib/server/ingredients";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Truck } from "lucide-react";

interface DNRow {
  id: string;
  code: string;
  fromBranchId: string;
  toBranchId: string;
  status: "Draft" | "Picking" | "In Transit" | "Received" | "Cancelled";
  driverName: string | null;
  createdAt: Date;
}

const statusColors: Record<
  string,
  "default" | "warning" | "success" | "destructive" | "secondary"
> = {
  Draft: "secondary",
  Picking: "default",
  "In Transit": "warning",
  Received: "success",
  Cancelled: "destructive",
};

export const Route = createFileRoute("/_layout/delivery-notes/")({
  component: DNPage,
  loader: async () => {
    const dns = await getDeliveryNotes({ data: {} });
    const branches = await getBranches({ data: {} });
    const ingredients = await getIngredients({ data: {} });
    return { dns, branches, ingredients };
  },
});

function DNPage() {
  const { user } = useAuth();
  const { dns: initial, branches, ingredients } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [dnItems, setDnItems] = useState<
    { ingredientId: string; quantity: number; readyQuantity: number }[]
  >([]);

  const { data: dns } = useQuery({
    queryKey: ["delivery-notes"],
    queryFn: () => getDeliveryNotes({ data: {} }),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createDeliveryNote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      setModalOpen(false);
      setDnItems([]);
    },
  });

  const shipMutation = useMutation({
    mutationFn: shipDeliveryNote,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] }),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      code: fd.get("code") as string,
      fromBranchId: fd.get("fromBranchId") as string,
      toBranchId: fd.get("toBranchId") as string,
      driverName: fd.get("driverName") as string,
      vehicleNumber: fd.get("vehicleNumber") as string,
      items: dnItems,
    };
    void createMutation.mutateAsync({ data });
  };

  const columns: Column<DNRow>[] = [
    { key: "code", header: "Kode SJ", width: "w-28", sortable: true },
    {
      key: "fromBranchId",
      header: "Dari",
      sortable: true,
      render: (r) =>
        branches.find((b) => b.id === r.fromBranchId)?.name ?? r.fromBranchId.slice(0, 8),
    },
    {
      key: "toBranchId",
      header: "Ke",
      sortable: true,
      render: (r) => branches.find((b) => b.id === r.toBranchId)?.name ?? r.toBranchId.slice(0, 8),
    },
    { key: "driverName", header: "Driver", sortable: true, render: (r) => r.driverName ?? "-" },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (r) => (
        <Badge
          variant={
            (statusColors[r.status] ?? "default") as
              | "default"
              | "success"
              | "warning"
              | "destructive"
              | "secondary"
          }
        >
          {r.status}
        </Badge>
      ),
    },
    {
      key: "id",
      header: "",
      width: "w-32",
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {["super_admin", "admin_pusat"].includes(user?.role ?? "") && r.status === "Picking" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void shipMutation.mutateAsync({ data: { dnId: r.id } });
              }}
              className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-[10px] font-medium"
            >
              <Truck className="h-3 w-3 inline mr-1" />
              Kirim
            </button>
          )}
          <Link
            to="/delivery-notes/$dnId"
            params={{ dnId: r.id }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
          >
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ),
    },
  ];
  usePageTitle("Surat Jalan", "Dokumen pengiriman barang");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <PageHeader action={{ label: "Buat SJ", onClick: () => setModalOpen(true) }} />

      <DataTable columns={columns} data={dns} keyExtractor={(r) => r.id} />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Buat Surat Jalan"
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Kode SJ</label>
              <input
                name="code"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Driver</label>
              <input
                name="driverName"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Dari Cabang</label>
              <select
                name="fromBranchId"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Ke Cabang</label>
              <select
                name="toBranchId"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">No. Kendaraan</label>
            <input
              name="vehicleNumber"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Item (Diorder | Ready)</label>
            <div className="flex gap-2">
              <select
                id="dn-ing"
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Pilih bahan...</option>
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <input
                id="dn-qty"
                type="number"
                min={1}
                placeholder="Order"
                className="h-9 w-20 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                id="dn-ready"
                type="number"
                min={0}
                placeholder="Ready"
                className="h-9 w-20 rounded-md border border-input bg-background px-3 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  const ing = (document.getElementById("dn-ing") as HTMLSelectElement).value;
                  const qty = (document.getElementById("dn-qty") as HTMLInputElement).value;
                  const ready = (document.getElementById("dn-ready") as HTMLInputElement).value;
                  if (ing && qty) {
                    setDnItems([
                      ...dnItems,
                      {
                        ingredientId: ing,
                        quantity: Number(qty),
                        readyQuantity: Number(ready || qty),
                      },
                    ]);
                  }
                }}
                className="h-9 px-3 rounded-md border text-sm"
              >
                +
              </button>
            </div>
            {dnItems.length > 0 && (
              <div className="rounded-md border divide-y text-sm">
                {dnItems.map((item, idx) => {
                  const ing = ingredients.find((i) => i.id === item.ingredientId);
                  return (
                    <div key={idx} className="flex items-center justify-between px-3 py-2">
                      <span>
                        {ing?.name} — Order: {item.quantity} | Ready: {item.readyQuantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDnItems(dnItems.filter((_, i) => i !== idx))}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
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
              disabled={dnItems.length === 0}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              Simpan
            </button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
